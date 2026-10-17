/**
 * backend/src/routes/availability.js – Free Now endpoints.
 *
 * Mounted at /api/v1/availability
 *
 * GET    /availability/me       – workers only, current window status
 * POST   /availability          – workers only, start window (2, 4, 8 hours)
 * POST   /availability/extend   – workers only, extend window (1, 2, 4 hours)
 * DELETE /availability          – workers only, stop window
 * GET    /availability/nearby   – customers only, nearby free workers
 */

import express from 'express';
import mongoose from 'mongoose';
import { formatSuccess, formatError, AppError } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { Availability } from '../models/Availability.js';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import {
  startFreeNowWindow,
  extendFreeNowWindow,
  stopFreeNowWindow,
  getWorkerFreeNowWindow
} from '../services/freeNowService.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { formatApproxDistance, encodeCursor, decodeCursor } from '../../../shared/jobRules.js';
import { VALID_SKILLS } from '../../../shared/profileRules.js';
import { getFairRateInfo } from './compass.js';

// In-memory sliding window rate limiter: 20 Free Now changes/hour/worker
const freeChangeHistory = new Map(); // workerId -> [timestamps]

/**
 * Checks sliding 1-hour change limit for a worker.
 *
 * @param {string} workerId
 * @returns {boolean} True if within limit, false if 20 changes reached
 */
function recordAndCheckFreeChange(workerId) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  let history = freeChangeHistory.get(workerId) || [];
  history = history.filter((t) => t > windowStart);

  if (history.length >= 20) {
    return false;
  }

  history.push(now);
  freeChangeHistory.set(workerId, history);
  return true;
}

export function createAvailabilityRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter for nearby: 120 per 10 minutes per user
  const nearbyLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 120,
    message: 'Too many requests for nearby workers'
  }, isRateLimitEnabled);

  // Middleware for checking Free Now change limit
  const requireChangeLimit = (req, res, next) => {
    if (!isRateLimitEnabled) return next();
    const workerId = req.user?._id?.toString();
    if (!workerId) return next();

    if (!recordAndCheckFreeChange(workerId)) {
      return res.status(429).json(formatError('FREE_LIMIT', 'Free Now change limit reached (20 changes per hour)'));
    }
    next();
  };

  /**
   * GET /availability/me
   * Workers only. Expired windows read as null.
   */
  router.get('/me', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const data = await getWorkerFreeNowWindow(req.user._id);
      return res.status(200).json(formatSuccess(data, 'Current Free Now status'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /availability
   * Workers only, profileComplete required.
   * Body { hours } where hours is exactly 2, 4 or 8. Unknown fields 400.
   */
  router.post('/', requireAuth, requireRole('worker'), requireChangeLimit, async (req, res, next) => {
    try {
      const bodyKeys = Object.keys(req.body);
      if (bodyKeys.length !== 1 || !bodyKeys.includes('hours')) {
        return next(new AppError('VALIDATION_ERROR', 'Request body must contain only { hours }', 400));
      }

      const { hours } = req.body;
      const result = await startFreeNowWindow({
        workerId: req.user._id,
        hours,
        user: req.user
      });

      return res.status(201).json(formatSuccess(result, 'Free Now window started'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /availability/extend
   * Workers only. Body { hours } with hours 1, 2 or 4. Unknown fields 400.
   */
  router.post('/extend', requireAuth, requireRole('worker'), requireChangeLimit, async (req, res, next) => {
    try {
      const bodyKeys = Object.keys(req.body);
      if (bodyKeys.length !== 1 || !bodyKeys.includes('hours')) {
        return next(new AppError('VALIDATION_ERROR', 'Request body must contain only { hours }', 400));
      }

      const { hours } = req.body;
      const result = await extendFreeNowWindow({
        workerId: req.user._id,
        hours
      });

      return res.status(200).json(formatSuccess(result, 'Free Now window extended'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /availability
   * Workers only. Stops the live window (safe to repeat, always success).
   */
  router.delete('/', requireAuth, requireRole('worker'), requireChangeLimit, async (req, res, next) => {
    try {
      const result = await stopFreeNowWindow(req.user._id);
      return res.status(200).json(formatSuccess(result, 'Free Now window stopped'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /availability/nearby
   * Customers only (workers get 403).
   * Query: radiusKm (1 to 5, default 3), skill (optional), limit (1 to 50, default 20), cursor.
   * Caller needs an area (400 SET_AREA).
   * Uses $geoNear on availability.location with active true and expiresAt > now.
   */
  router.get('/nearby', requireAuth, requireRole('customer'), nearbyLimiter, async (req, res, next) => {
    try {
      const user = req.user;

      // 1. Resolve customer origin point
      let originCoords = null;
      if (user.location?.coordinates && (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0)) {
        originCoords = user.location.coordinates;
      } else if (user.localityKey) {
        const loc = getLocalityByKey(user.localityKey);
        if (loc) originCoords = [loc.lng, loc.lat];
      }

      if (!originCoords) {
        return next(new AppError('SET_AREA', 'Set your locality before searching for nearby workers', 400));
      }

      // 2. Query parameters
      const { radiusKm: rawRadius, skill: rawSkill, limit: rawLimit, cursor: rawCursor } = req.query;

      let radiusKm = 3;
      if (rawRadius !== undefined && rawRadius !== null && rawRadius !== '') {
        const r = Number(rawRadius);
        if (Number.isNaN(r) || r < 1 || r > 5) {
          return next(new AppError('VALIDATION_ERROR', 'radiusKm must be a number between 1 and 5', 400));
        }
        radiusKm = r;
      }
      const maxDistanceMeters = radiusKm * 1000;

      let filterSkill = null;
      if (rawSkill) {
        const s = String(rawSkill).trim().toLowerCase();
        if (!VALID_SKILLS.includes(s)) {
          return next(new AppError('VALIDATION_ERROR', `skill '${rawSkill}' is not a recognized skill`, 400));
        }
        filterSkill = s;
      }

      let limit = 20;
      if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
        const l = Number(rawLimit);
        if (Number.isNaN(l) || !Number.isInteger(l) || l < 1 || l > 50) {
          return next(new AppError('VALIDATION_ERROR', 'limit must be an integer between 1 and 50', 400));
        }
        limit = l;
      }

      // 3. Cursor decoding
      let cursorData = null;
      if (rawCursor) {
        cursorData = decodeCursor(rawCursor);
        if (!cursorData || !mongoose.Types.ObjectId.isValid(cursorData.id)) {
          return next(new AppError('BAD_CURSOR', 'Cursor is invalid or tampered', 400));
        }
      }

      const now = clock.now();

      // 4. Fetch worker IDs with in_progress bookings to exclude them
      const inProgressWorkerIds = await Booking.find({ status: 'in_progress' }).distinct('workerId');

      // 5. Match criteria on Availability
      const matchCriteria = {
        active: true,
        expiresAt: { $gt: now },
        workerId: { $ne: user._id, $nin: inProgressWorkerIds }
      };

      if (filterSkill) {
        matchCriteria.skills = filterSkill;
      }

      // 6. Build geo aggregation pipeline
      const pipeline = [
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: originCoords
            },
            distanceField: 'calculatedDistance',
            maxDistance: maxDistanceMeters,
            spherical: true,
            key: 'location',
            query: matchCriteria
          }
        },
        {
          $sort: {
            calculatedDistance: 1,
            _id: 1
          }
        }
      ];

      // Cursor filtering
      if (cursorData) {
        const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);
        const cursorVal = cursorData.val ?? 0;
        pipeline.push({
          $match: {
            $or: [
              { calculatedDistance: { $gt: cursorVal } },
              { calculatedDistance: cursorVal, _id: { $gt: cursorObjId } }
            ]
          }
        });
      }

      // Fetch limit + 1
      pipeline.push({ $limit: limit + 1 });

      // Join worker User profile
      pipeline.push(
        {
          $lookup: {
            from: 'users',
            localField: 'workerId',
            foreignField: '_id',
            as: 'workerDoc'
          }
        },
        { $unwind: '$workerDoc' },
        {
          $match: {
            'workerDoc.isActive': true,
            'workerDoc.profileComplete': true
          }
        }
      );

      const docs = await Availability.aggregate(pipeline);

      const hasNext = docs.length > limit;
      const results = hasNext ? docs.slice(0, limit) : docs;

      // Batch Fair Rate lookups
      const workerItems = await Promise.all(
        results.map(async (item) => {
          const w = item.workerDoc;
          const mainSkill = w.mainSkill || item.skills[0] || 'other';
          const localityKey = item.localityKey || w.localityKey;
          const locDoc = getLocalityByKey(localityKey);

          const fairRate = await getFairRateInfo(mainSkill, localityKey, item.rateHourly);
          const minutesLeftVal = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now.getTime()) / 60000));

          return {
            workerId: item.workerId.toString(),
            name: w.name,
            photoUrl: w.photoUrl || null,
            mainSkill,
            skills: Array.isArray(item.skills) ? item.skills : [],
            rate: {
              hourly: item.rateHourly
            },
            rating: (w.passportStats?.jobs || 0) > 0 ? (w.passportStats?.avgRating || null) : null,
            jobsCount: w.passportStats?.jobs || 0,
            minutesLeft: minutesLeftVal,
            approxDistance: formatApproxDistance(item.calculatedDistance),
            localityName: locDoc ? locDoc.name : null,
            hasVerifiedHistory: (w.passportStats?.jobs || 0) > 0,
            isSample: Boolean(w.isSample),
            fairRate: {
              label: fairRate.label || 'fair',
              isSample: Boolean(fairRate.isSample)
            },
            canBookNow: minutesLeftVal > 30
          };
        })
      );

      // Construct nextCursor
      let nextCursor = null;
      if (hasNext && results.length > 0) {
        const lastItem = results[results.length - 1];
        nextCursor = encodeCursor({
          id: lastItem._id.toString(),
          val: lastItem.calculatedDistance
        });
      }

      return res.status(200).json(formatSuccess({
        workers: workerItems,
        nextCursor,
        serverTime: now.toISOString()
      }, 'Nearby free workers retrieved'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
