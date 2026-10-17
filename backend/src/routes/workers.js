import express from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { RateStats } from '../models/RateStats.js';
import { Follow } from '../models/Follow.js';
import { Booking } from '../models/Booking.js';
import { Endorsement } from '../models/Endorsement.js';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { VALID_SKILLS } from '../../../shared/profileRules.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { SAMPLE_BASELINES, fairLabel, pickSource } from '../../../shared/compassMath.js';
import { formatApproxDistance, encodeCursor, decodeCursor } from '../../../shared/jobRules.js';
import { getPublicPassport, verifyPassport } from '../services/passportService.js';
import { getCanEndorseSkills } from '../../../shared/endorsementEligibility.js';

export function createWorkersRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limit: 120 requests per 10 minutes per user for search & profile reads
  const workersLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 120,
    message: 'Too many search requests. Please try again later.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * GET /workers
   * Logged in (both roles).
   * Query:
   * - skill (optional)
   * - distanceKm (1 to 10, default 5)
   * - minRate, maxRate (per hour)
   * - minRating (0 to 5)
   * - sort (nearest | rating | price, default nearest)
   * - limit (1 to 50, default 20)
   * - cursor (opaque base64url string)
   */
  router.get('/', requireAuth, workersLimiter, async (req, res, next) => {
    try {
      const user = req.user;

      // Caller origin resolution: exact private location if set, else locality centroid
      let originCoords = null;
      if (user.location && Array.isArray(user.location.coordinates) && (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0)) {
        originCoords = user.location.coordinates; // [lng, lat]
      } else if (user.localityKey) {
        const loc = getLocalityByKey(user.localityKey);
        if (loc) {
          originCoords = [loc.lng, loc.lat];
        }
      }

      if (!originCoords) {
        return next(new AppError('SET_AREA', 'Please choose your area or share location to search nearby workers', 400));
      }

      const {
        skill,
        distanceKm: rawDistance,
        minRate: rawMinRate,
        maxRate: rawMaxRate,
        minRating: rawMinRating,
        sort: rawSort,
        limit: rawLimit,
        cursor: rawCursor
      } = req.query;

      // Distance
      let distanceKm = 5;
      if (rawDistance !== undefined && rawDistance !== null && rawDistance !== '') {
        const d = Number(rawDistance);
        if (Number.isNaN(d) || d < 1 || d > 10) {
          return next(new AppError('VALIDATION_ERROR', 'distanceKm must be a number between 1 and 10', 400));
        }
        distanceKm = d;
      }
      const maxDistanceMeters = distanceKm * 1000;

      // Skill
      let filterSkill = null;
      if (skill) {
        const s = String(skill).trim().toLowerCase();
        if (!VALID_SKILLS.includes(s)) {
          return next(new AppError('VALIDATION_ERROR', `skill '${skill}' is not a recognized skill`, 400));
        }
        filterSkill = s;
      }

      // Rates
      let minRate = null;
      if (rawMinRate !== undefined && rawMinRate !== null && rawMinRate !== '') {
        const r = Number(rawMinRate);
        if (Number.isNaN(r) || r < 0) {
          return next(new AppError('VALIDATION_ERROR', 'minRate must be a non-negative number', 400));
        }
        minRate = r;
      }

      let maxRate = null;
      if (rawMaxRate !== undefined && rawMaxRate !== null && rawMaxRate !== '') {
        const r = Number(rawMaxRate);
        if (Number.isNaN(r) || r < 0) {
          return next(new AppError('VALIDATION_ERROR', 'maxRate must be a non-negative number', 400));
        }
        maxRate = r;
      }

      // Rating
      let minRating = null;
      if (rawMinRating !== undefined && rawMinRating !== null && rawMinRating !== '') {
        const r = Number(rawMinRating);
        if (Number.isNaN(r) || r < 0 || r > 5) {
          return next(new AppError('VALIDATION_ERROR', 'minRating must be a number between 0 and 5', 400));
        }
        minRating = r;
      }

      // Sort
      const validSorts = ['nearest', 'rating', 'price'];
      const sort = rawSort ? String(rawSort).trim().toLowerCase() : 'nearest';
      if (!validSorts.includes(sort)) {
        return next(new AppError('VALIDATION_ERROR', "sort must be one of 'nearest', 'rating', 'price'", 400));
      }

      // Limit
      let limit = 20;
      if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
        const l = Number(rawLimit);
        if (Number.isNaN(l) || !Number.isInteger(l) || l < 1 || l > 50) {
          return next(new AppError('VALIDATION_ERROR', 'limit must be an integer between 1 and 50', 400));
        }
        limit = l;
      }

      // Cursor decoding
      let cursorData = null;
      if (rawCursor) {
        cursorData = decodeCursor(rawCursor);
        if (!cursorData || !mongoose.Types.ObjectId.isValid(cursorData.id)) {
          return next(new AppError('BAD_CURSOR', 'Cursor is invalid or tampered', 400));
        }
      }

      // Match query for workers
      const matchCriteria = {
        _id: { $ne: user._id },
        role: 'worker',
        isActive: true,
        profileComplete: true
      };

      if (filterSkill) {
        matchCriteria.skills = filterSkill;
      }

      if (minRate !== null || maxRate !== null) {
        matchCriteria.rateHourlyEffective = {};
        if (minRate !== null) matchCriteria.rateHourlyEffective.$gte = minRate;
        if (maxRate !== null) matchCriteria.rateHourlyEffective.$lte = maxRate;
      }

      if (minRating !== null) {
        // minRating excludes unrated workers
        matchCriteria['passportStats.avgRating'] = { $gte: minRating, $gt: 0 };
        matchCriteria['passportStats.jobs'] = { $gt: 0 };
      }

      // Build aggregation pipeline using $geoNear on searchLocation
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
            key: 'searchLocation',
            query: matchCriteria
          }
        }
      ];

      // Sorting stage
      if (sort === 'rating') {
        pipeline.push({
          $sort: {
            'passportStats.avgRating': -1,
            _id: 1
          }
        });
      } else if (sort === 'price') {
        pipeline.push({
          $sort: {
            rateHourlyEffective: 1,
            _id: 1
          }
        });
      } else {
        // 'nearest'
        pipeline.push({
          $sort: {
            calculatedDistance: 1,
            _id: 1
          }
        });
      }

      // Cursor filtering after sort
      if (cursorData) {
        let cursorCondition = null;
        const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);

        if (sort === 'rating') {
          const cursorVal = cursorData.val ?? 0;
          cursorCondition = {
            $or: [
              { 'passportStats.avgRating': { $lt: cursorVal } },
              {
                'passportStats.avgRating': cursorVal,
                _id: { $gt: cursorObjId }
              }
            ]
          };
        } else if (sort === 'price') {
          const cursorVal = cursorData.val ?? 0;
          cursorCondition = {
            $or: [
              { rateHourlyEffective: { $gt: cursorVal } },
              {
                rateHourlyEffective: cursorVal,
                _id: { $gt: cursorObjId }
              }
            ]
          };
        } else {
          // 'nearest'
          const cursorVal = cursorData.val ?? 0;
          cursorCondition = {
            $or: [
              { calculatedDistance: { $gt: cursorVal } },
              {
                calculatedDistance: cursorVal,
                _id: { $gt: cursorObjId }
              }
            ]
          };
        }

        pipeline.push({ $match: cursorCondition });
      }

      // Fetch limit + 1 to determine if next page exists
      pipeline.push({ $limit: limit + 1 });

      const docs = await User.aggregate(pipeline);

      const hasNext = docs.length > limit;
      const results = hasNext ? docs.slice(0, limit) : docs;

      // Batch Fair Rate hint lookup per (skill, locality) pair
      const pairs = new Set();
      results.forEach((w) => {
        const s = filterSkill || w.mainSkill || (w.skills && w.skills[0]) || 'other';
        const loc = w.localityKey || LOCALITIES[0].key;
        pairs.add(`${s}:${loc}`);
      });

      const fairRateMap = new Map();
      const pairQueries = Array.from(pairs).map((p) => {
        const [s, locKey] = p.split(':');
        const locDoc = getLocalityByKey(locKey);
        const cityKey = locDoc ? locDoc.cityKey : 'kochi';
        return { s, locKey, cityKey };
      });

      // Fetch all needed RateStats in batch
      if (pairQueries.length > 0) {
        const skillsNeeded = [...new Set(pairQueries.map((q) => q.s))];
        const locsNeeded = [...new Set(pairQueries.map((q) => q.locKey))];
        const cityKeysNeeded = [...new Set(pairQueries.map((q) => `city:${q.cityKey}`))];

        const statsDocs = await RateStats.find({
          skill: { $in: skillsNeeded },
          localityKey: { $in: [...locsNeeded, ...cityKeysNeeded] }
        });

        for (const q of pairQueries) {
          const locDoc = statsDocs.find((d) => d.skill === q.s && d.localityKey === q.locKey);
          const cityDoc = statsDocs.find((d) => d.skill === q.s && d.localityKey === `city:${q.cityKey}`);
          const baseline = SAMPLE_BASELINES[q.s] || SAMPLE_BASELINES.other;
          const baselineStats = { p25: baseline.p25, median: baseline.median, p75: baseline.p75, sampleSize: 0 };
          const resolved = pickSource(locDoc, cityDoc, baselineStats);
          fairRateMap.set(`${q.s}:${q.locKey}`, resolved);
        }
      }

      // Phase B7: Batch query viewer relations (isFollowing, isSaved) in ONE query
      const workerIds = results.map((w) => w._id);
      const viewerRelations = await Follow.find({
        fromId: user._id,
        toId: { $in: workerIds }
      }).lean();

      const followSet = new Set(
        viewerRelations.filter((r) => r.type === 'follow').map((r) => r.toId.toString())
      );
      const saveSet = new Set(
        viewerRelations.filter((r) => r.type === 'save').map((r) => r.toId.toString())
      );

      // Build sanitized result items
      const formattedWorkers = results.map((w) => {
        const wid = w._id.toString();
        const skillChoice = filterSkill || w.mainSkill || (w.skills && w.skills[0]) || 'other';
        const locKey = w.localityKey || LOCALITIES[0].key;
        const locDoc = getLocalityByKey(locKey);
        const sourceRes = fairRateMap.get(`${skillChoice}:${locKey}`);
        const effective = w.rateHourlyEffective || 0;
        const label = sourceRes ? fairLabel(effective, sourceRes.data) : 'fair';

        const approxDist = formatApproxDistance(w.calculatedDistance);

        return {
          id: wid,
          name: w.name,
          photoUrl: w.photoUrl || null,
          mainSkill: w.mainSkill || null,
          skills: Array.isArray(w.skills) ? w.skills : [],
          rate: {
            hourly: w.hourlyRate || null,
            daily: w.dailyRate || null,
            effectiveHourly: effective
          },
          rating: w.passportStats?.jobs > 0 ? w.passportStats?.avgRating : null,
          jobsCount: w.passportStats?.jobs || 0,
          approxDistance: approxDist,
          localityName: locDoc ? locDoc.name : null,
          hasVerifiedHistory: (w.passportStats?.jobs || 0) > 0,
          isFollowing: followSet.has(wid),
          isSaved: saveSet.has(wid),
          isSample: Boolean(w.isSample),
          fairRate: {
            label,
            isSample: sourceRes ? sourceRes.isSample : true
          }
        };
      });

      // Construct nextCursor
      let nextCursor = null;
      if (hasNext && results.length > 0) {
        const lastItem = results[results.length - 1];
        let lastVal = null;
        if (sort === 'rating') {
          lastVal = lastItem.passportStats?.avgRating || 0;
        } else if (sort === 'price') {
          lastVal = lastItem.rateHourlyEffective || 0;
        } else {
          lastVal = lastItem.calculatedDistance;
        }

        nextCursor = encodeCursor({
          id: lastItem._id.toString(),
          val: lastVal
        });
      }

      return res.status(200).json(formatSuccess({
        workers: formattedWorkers,
        nextCursor
      }, 'Workers retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /workers/:id
   * Worker viewer profile for logged-in callers.
   * Unknown id, invalid id, inactive, incomplete, or non-worker all return 404 NOT_FOUND.
   */
  router.get('/:id', requireAuth, workersLimiter, async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(new AppError('NOT_FOUND', 'Worker not found', 404));
      }

      const worker = await User.findOne({
        _id: id,
        role: 'worker',
        isActive: true,
        profileComplete: true
      });

      if (!worker) {
        return next(new AppError('NOT_FOUND', 'Worker not found', 404));
      }

      // Calculate availabilitySummary (7 entries from weekly pattern + 14-day blocked count)
      const weekly = worker.calendar?.weekly || {};
      const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const dayNames = {
        mon: 'Monday',
        tue: 'Tuesday',
        wed: 'Wednesday',
        thu: 'Thursday',
        fri: 'Friday',
        sat: 'Saturday',
        sun: 'Sunday'
      };

      const weeklySummary = dayKeys.map((k) => ({
        day: dayNames[k],
        slot: weekly[k] || 'full'
      }));

      // Count blocked dates in the next 14 days
      const clockInstance = config.clock || { now: () => new Date() };
      const now = clockInstance.now();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const todayStr = now.toISOString().slice(0, 10);
      const maxDateStr = new Date(now.getTime() + fourteenDaysMs).toISOString().slice(0, 10);

      let blockedDatesCount = 0;
      if (Array.isArray(worker.calendar?.blockedDates)) {
        blockedDatesCount = worker.calendar.blockedDates.filter(
          (b) => b.date >= todayStr && b.date <= maxDateStr
        ).length;
      }

      const locDoc = worker.localityKey ? getLocalityByKey(worker.localityKey) : null;
      const effectiveRate = worker.rateHourlyEffective || 0;

      // Full skills with isMain
      const skillsFormatted = (worker.skills || []).map((s) => ({
        skill: s,
        isMain: s === worker.mainSkill
      }));

      const responseData = {
        id: worker._id.toString(),
        name: worker.name,
        photoUrl: worker.photoUrl || null,
        bio: worker.bio || '',
        mainSkill: worker.mainSkill || null,
        skills: skillsFormatted,
        rate: {
          hourly: worker.hourlyRate || null,
          daily: worker.dailyRate || null,
          effectiveHourly: effectiveRate
        },
        localityName: locDoc ? locDoc.name : null,
        stats: {
          jobs: worker.passportStats?.jobs || 0,
          avgRating: worker.passportStats?.avgRating || 0,
          totalHours: worker.passportStats?.totalHours || 0
        },
        availabilitySummary: {
          weekly: weeklySummary,
          blockedNext14DaysCount: blockedDatesCount
        },
        isSample: Boolean(worker.isSample),
        endorsements: worker.endorsementCounts instanceof Map
          ? Object.fromEntries(worker.endorsementCounts)
          : (worker.endorsementCounts || {})
      };

      // Phase B7: Viewer follow/save relation
      const viewerFollows = await Follow.find({
        fromId: req.user._id,
        toId: worker._id
      }).lean();

      responseData.viewer = {
        isFollowing: viewerFollows.some((f) => f.type === 'follow'),
        isSaved: viewerFollows.some((f) => f.type === 'save')
      };

      // Phase B7: For CUSTOMERS, canEndorse [skills eligible for and not yet endorsed]
      if (req.user.role === 'customer') {
        const [completedBookings, existingEndorsements] = await Promise.all([
          Booking.find({
            customerId: req.user._id,
            workerId: worker._id,
            status: 'completed'
          }).select('customerId workerId skill status').lean(),
          Endorsement.find({
            customerId: req.user._id,
            workerId: worker._id
          }).select('customerId workerId skill').lean()
        ]);

        responseData.canEndorse = getCanEndorseSkills(
          req.user._id,
          worker._id,
          completedBookings,
          existingEndorsements
        );
      }

      // B5: Add history check (historyCheck: { status, records, privateIncludedCount })
      // runChainVerification is imported from passportService
      const { runChainVerification } = await import('../services/passportService.js');
      const historyCheckResult = await runChainVerification(worker._id);
      responseData.historyCheck = historyCheckResult;

      return res.status(200).json(formatSuccess({ worker: responseData }, 'Worker profile retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /workers/:id/passport
   * Visible passport entries for a worker (logged in, both roles).
   * Same 404 as /workers/:id for invalid/inactive/incomplete/non-worker ids.
   */
  router.get('/:id/passport', requireAuth, workersLimiter, async (req, res, next) => {
    try {
      const result = await getPublicPassport(req.params.id, req.query);
      return res.status(200).json(formatSuccess(result, 'Passport retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /workers/:id/passport/verify
   * Chain integrity check. Returns { status, records } only.
   */
  router.get('/:id/passport/verify', requireAuth, workersLimiter, async (req, res, next) => {
    try {
      const result = await verifyPassport(req.params.id);
      return res.status(200).json(formatSuccess(result, 'Chain verified'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

