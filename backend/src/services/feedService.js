/**
 * backend/src/services/feedService.js – Core service for the unified feed (GET /feed).
 *
 * Rules:
 * - Tabs: 'nearby' | 'following' (default 'nearby').
 * - Newest first on (createdAt, _id) with opaque tamper-safe cursor.
 * - Highlights on first page of nearby tab only:
 *   - Workers: nearest open jobs matching worker's skills (max 5)
 *   - Customers: nearest live Free Now workers (max 5)
 * - Nearby tab: posts within 10 km of viewer origin (using author's searchLocation centroid).
 * - Distances are approximate (nearest 0.5 km) using formatApproxDistance.
 * - Following tab: posts by workers the caller follows (type: 'follow' only; saves do NOT feed it).
 * - Posts by inactive workers or workers without profileComplete are hidden everywhere.
 * - Author's own posts appear in nearby tab only if caller is worker (never duplicated).
 * - Viewer relation flags (isFollowing, isSaved) computed in ONE batch query per page.
 */

import mongoose from 'mongoose';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { Follow } from '../models/Follow.js';
import { Job } from '../models/Job.js';
import { Availability } from '../models/Availability.js';
import { AppError } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { formatApproxDistance } from '../../../shared/jobRules.js';
import { encodeFeedCursor, decodeFeedCursor } from '../../../shared/feedCursor.js';
import { formatPostResponse } from './postService.js';
import { getFairRateInfo } from '../routes/compass.js';

const NEARBY_MAX_DISTANCE_METERS = 10000; // 10 km

/**
 * Resolves caller origin coordinates: exact private location if set, else locality centroid.
 *
 * @param {object} user
 * @returns {[number, number] | null} [lng, lat]
 */
export function resolveViewerOrigin(user) {
  if (
    user.location &&
    Array.isArray(user.location.coordinates) &&
    (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0)
  ) {
    return user.location.coordinates;
  }
  if (user.localityKey) {
    const loc = getLocalityByKey(user.localityKey);
    if (loc) {
      return [loc.lng, loc.lat];
    }
  }
  return null;
}

/**
 * Retrieves the unified feed for a viewer.
 *
 * @param {object} params
 * @param {object} params.user Viewer User document
 * @param {string} [params.tab] 'nearby' | 'following' (default 'nearby')
 * @param {number} [params.limit] 1 to 50 (default 20)
 * @param {string} [params.cursor] Opaque base64url cursor
 * @param {string} [params.cursorSecret] HMAC secret for cursor tamper detection
 * @returns {Promise<{ items: object[], nextCursor: string|null, highlights?: object[] }>}
 */
export async function getFeed({ user, tab = 'nearby', limit = 20, cursor, cursorSecret }) {
  const selectedTab = String(tab || 'nearby').toLowerCase();
  if (selectedTab !== 'nearby' && selectedTab !== 'following') {
    throw new AppError('VALIDATION_ERROR', "tab must be 'nearby' or 'following'", 400);
  }

  const parsedLimit = Number(limit) || 20;
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    throw new AppError('VALIDATION_ERROR', 'limit must be between 1 and 50', 400);
  }

  // Parse and verify cursor if provided
  let cursorData = null;
  if (cursor) {
    cursorData = decodeFeedCursor(cursor, cursorSecret);
    if (!cursorData) {
      throw new AppError('BAD_CURSOR', 'Invalid or tampered pagination cursor', 400);
    }
  }

  const now = clock.now();

  if (selectedTab === 'nearby') {
    const originCoords = resolveViewerOrigin(user);
    if (!originCoords) {
      throw new AppError('SET_AREA', 'Please choose your area or share location to view nearby posts', 400);
    }

    // Pipeline with $geoNear on post.location
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: originCoords },
          distanceField: 'calculatedDistance',
          maxDistance: NEARBY_MAX_DISTANCE_METERS,
          spherical: true,
          key: 'location'
        }
      },
      // Join author User document to ensure active and profileComplete
      {
        $lookup: {
          from: 'users',
          localField: 'workerId',
          foreignField: '_id',
          as: 'authorDoc'
        }
      },
      { $unwind: '$authorDoc' },
      {
        $match: {
          'authorDoc.isActive': true,
          'authorDoc.profileComplete': true
        }
      }
    ];

    // Cursor filter on (createdAt, _id)
    if (cursorData) {
      const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);
      const cursorDate = cursorData.createdAt;

      pipeline.push({
        $match: {
          $or: [
            { createdAt: { $lt: cursorDate } },
            { createdAt: cursorDate, _id: { $lt: cursorObjId } }
          ]
        }
      });
    }

    // Sort newest first: createdAt descending, _id descending
    pipeline.push({
      $sort: {
        createdAt: -1,
        _id: -1
      }
    });

    pipeline.push({ $limit: parsedLimit + 1 });

    const docs = await Post.aggregate(pipeline);
    const hasNext = docs.length > parsedLimit;
    const pageDocs = hasNext ? docs.slice(0, parsedLimit) : docs;

    // Batch query viewer relations (isFollowing, isSaved) in ONE query
    const authorIds = pageDocs.map((d) => d.workerId);
    const viewerRelations = await Follow.find({
      fromId: user._id,
      toId: { $in: authorIds }
    }).lean();

    const followSet = new Set(
      viewerRelations.filter((r) => r.type === 'follow').map((r) => r.toId.toString())
    );
    const saveSet = new Set(
      viewerRelations.filter((r) => r.type === 'save').map((r) => r.toId.toString())
    );

    const items = pageDocs.map((postDoc) => {
      const author = postDoc.authorDoc;
      const wid = author._id.toString();
      const isMine = user._id.toString() === wid;

      return formatPostResponse(postDoc, author, {
        isFollowing: followSet.has(wid),
        isSaved: saveSet.has(wid),
        isMine,
        approxDistance: formatApproxDistance(postDoc.calculatedDistance)
      });
    });

    // Next cursor
    let nextCursor = null;
    if (hasNext && pageDocs.length > 0) {
      const lastDoc = pageDocs[pageDocs.length - 1];
      nextCursor = encodeFeedCursor(
        { id: lastDoc._id.toString(), createdAt: lastDoc.createdAt },
        cursorSecret
      );
    }

    // Highlights only on first page (no cursor)
    let highlights = undefined;
    if (!cursor) {
      highlights = await getFeedHighlights(user, originCoords, now);
    }

    return { items, nextCursor, highlights };
  } else {
    // 'following' tab: posts by workers caller follows (type: 'follow' only)
    const followedWorkers = await Follow.find({
      fromId: user._id,
      type: 'follow'
    }).select('toId').lean();

    const followedWorkerIds = followedWorkers.map((f) => f.toId);

    if (followedWorkerIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const matchQuery = {
      workerId: { $in: followedWorkerIds }
    };

    if (cursorData) {
      const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);
      const cursorDate = cursorData.createdAt;

      matchQuery.$or = [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, _id: { $lt: cursorObjId } }
      ];
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'users',
          localField: 'workerId',
          foreignField: '_id',
          as: 'authorDoc'
        }
      },
      { $unwind: '$authorDoc' },
      {
        $match: {
          'authorDoc.isActive': true,
          'authorDoc.profileComplete': true
        }
      },
      {
        $sort: {
          createdAt: -1,
          _id: -1
        }
      },
      { $limit: parsedLimit + 1 }
    ];

    const docs = await Post.aggregate(pipeline);
    const hasNext = docs.length > parsedLimit;
    const pageDocs = hasNext ? docs.slice(0, parsedLimit) : docs;

    // Batch query viewer relations in ONE query (they are followed, check if also saved)
    const authorIds = pageDocs.map((d) => d.workerId);
    const viewerRelations = await Follow.find({
      fromId: user._id,
      toId: { $in: authorIds }
    }).lean();

    const followSet = new Set(
      viewerRelations.filter((r) => r.type === 'follow').map((r) => r.toId.toString())
    );
    const saveSet = new Set(
      viewerRelations.filter((r) => r.type === 'save').map((r) => r.toId.toString())
    );

    const items = pageDocs.map((postDoc) => {
      const author = postDoc.authorDoc;
      const wid = author._id.toString();
      const isMine = user._id.toString() === wid;

      return formatPostResponse(postDoc, author, {
        isFollowing: followSet.has(wid),
        isSaved: saveSet.has(wid),
        isMine
      });
    });

    let nextCursor = null;
    if (hasNext && pageDocs.length > 0) {
      const lastDoc = pageDocs[pageDocs.length - 1];
      nextCursor = encodeFeedCursor(
        { id: lastDoc._id.toString(), createdAt: lastDoc.createdAt },
        cursorSecret
      );
    }

    return { items, nextCursor };
  }
}

/**
 * Computes highlights for the first page of the nearby tab.
 * Max 5 items.
 * For WORKERS: nearest open jobs matching their skills.
 * For CUSTOMERS: nearest live Free Now workers.
 *
 * @param {object} user
 * @param {[number, number]} originCoords
 * @param {Date} now
 * @returns {Promise<object[]>}
 */
async function getFeedHighlights(user, originCoords, now) {
  if (user.role === 'worker') {
    const workerSkills = user.skills || [];
    if (workerSkills.length === 0) return [];

    const radiusMeters = (user.radiusKm || 5) * 1000;

    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: originCoords },
          key: 'searchLocation',
          distanceField: 'distMeters',
          maxDistance: radiusMeters,
          spherical: true,
          query: {
            status: 'open',
            startAt: { $gt: now },
            skill: { $in: workerSkills },
            $expr: { $lt: ['$acceptedCount', '$workersNeeded'] }
          }
        }
      },
      { $sort: { startAt: 1, _id: 1 } },
      { $limit: 5 }
    ];

    const jobs = await Job.aggregate(pipeline);

    return jobs.map((j) => {
      const locDoc = j.localityKey ? getLocalityByKey(j.localityKey) : null;
      return {
        type: 'job',
        id: j._id.toString(),
        skill: j.skill,
        workersNeeded: j.workersNeeded,
        hours: j.hours,
        startAt: j.startAt,
        offeredRate: j.offeredRate,
        description: j.description,
        localityName: locDoc ? locDoc.name : null,
        approxDistance: formatApproxDistance(j.distMeters),
        isSample: Boolean(j.isSample)
      };
    });
  } else {
    // Customer: nearest live Free Now workers (max 5)
    const maxRadiusMeters = 5000; // 5 km for Free Now

    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: originCoords },
          distanceField: 'calculatedDistance',
          maxDistance: maxRadiusMeters,
          spherical: true,
          key: 'location',
          query: {
            active: true,
            expiresAt: { $gt: now }
          }
        }
      },
      {
        $sort: {
          calculatedDistance: 1,
          _id: 1
        }
      },
      { $limit: 5 },
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
    ];

    const freeDocs = await Availability.aggregate(pipeline);

    return freeDocs.map((item) => {
      const w = item.workerDoc;
      const mainSkill = w.mainSkill || item.skills[0] || 'other';
      const locDoc = item.localityKey ? getLocalityByKey(item.localityKey) : null;
      const minutesLeftVal = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now.getTime()) / 60000));

      return {
        type: 'worker_free',
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
        isSample: Boolean(w.isSample),
        canBookNow: minutesLeftVal > 30
      };
    });
  }
}
