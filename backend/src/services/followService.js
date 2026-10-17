/**
 * backend/src/services/followService.js – Core service for follows and saves.
 *
 * Rules:
 * - Both roles may follow and save workers.
 * - Target must be active, profileComplete worker and not caller.
 * - Caps: 500 follows, 500 saves per user (stored on followCounts).
 * - Idempotent create: repeating returns success without double counting.
 * - Delete: decrements counter only when record was actually removed.
 * - GET /follows lists followed/saved workers as B4 search-style cards with cursor pagination.
 */

import mongoose from 'mongoose';
import { Follow } from '../models/Follow.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { canFollow, QUOTA_CAPS } from '../../../shared/quotaRules.js';
import { validateFollowInput } from '../../../shared/followRules.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { formatApproxDistance, encodeCursor, decodeCursor } from '../../../shared/jobRules.js';
import { resolveViewerOrigin } from './feedService.js';
import { calculateHaversineDistance } from '../../../shared/geo.js';

/**
 * Creates or repeats a follow / save relation.
 *
 * @param {object} params
 * @param {object} params.body { workerId, type: 'follow'|'save' }
 * @param {object} params.caller Caller User document
 * @returns {Promise<{ message: string, following: boolean }>}
 */
export async function createFollow({ body, caller }) {
  const validation = validateFollowInput(body, caller._id);
  if (!validation.valid) {
    if (validation.errors.includes('CANNOT_FOLLOW_SELF')) {
      throw new AppError('CANNOT_FOLLOW_SELF', 'You cannot follow or save yourself', 400);
    }
    throw new AppError('VALIDATION_ERROR', validation.errors.join('; '), 400);
  }

  const { workerId, type } = validation.data;

  if (!mongoose.Types.ObjectId.isValid(workerId)) {
    throw new AppError('NOT_FOUND', 'Worker not found', 404);
  }

  const targetWorker = await User.findOne({
    _id: workerId,
    role: 'worker',
    isActive: true,
    profileComplete: true
  });

  if (!targetWorker) {
    throw new AppError('NOT_FOUND', 'Worker not found', 404);
  }

  // Check if relation already exists (Idempotent)
  const existing = await Follow.findOne({
    fromId: caller._id,
    toId: targetWorker._id,
    type
  });

  if (existing) {
    return { message: `${type === 'follow' ? 'Followed' : 'Saved'} successfully`, following: true };
  }

  // Atomic conditional check and increment on caller's followCounts
  const fieldKey = `followCounts.${type}`;
  const maxCap = type === 'follow' ? QUOTA_CAPS.maxFollows : QUOTA_CAPS.maxSaves;
  const errorCode = type === 'follow' ? 'FOLLOW_LIMIT' : 'SAVE_LIMIT';

  const updatedCaller = await User.findOneAndUpdate(
    {
      _id: caller._id,
      [fieldKey]: { $lt: maxCap }
    },
    {
      $inc: { [fieldKey]: 1 }
    },
    { new: true }
  );

  if (!updatedCaller) {
    throw new AppError(errorCode, `Maximum limit of ${maxCap} ${type}s reached`, 409);
  }

  try {
    await Follow.create({
      fromId: caller._id,
      toId: targetWorker._id,
      type
    });

    logAuditEvent('follow_added', {
      userId: caller._id,
      targetWorkerId: targetWorker._id,
      type
    });

    return { message: `${type === 'follow' ? 'Followed' : 'Saved'} successfully`, following: true };
  } catch (err) {
    // If insertion failed (e.g. race unique collision), roll back the counter increment
    await User.updateOne(
      { _id: caller._id },
      { $inc: { [fieldKey]: -1 } }
    );
    // If unique key collision occurred, treat as success (idempotent)
    if (err.code === 11000) {
      return { message: `${type === 'follow' ? 'Followed' : 'Saved'} successfully`, following: true };
    }
    throw err;
  }
}

/**
 * Removes a follow or save relation.
 * Safe to repeat.
 *
 * @param {object} params
 * @param {string} params.workerId
 * @param {'follow'|'save'} params.type
 * @param {object} params.caller
 * @returns {Promise<{ message: string, following: boolean }>}
 */
export async function removeFollow({ workerId, type, caller }) {
  if (!type || (type !== 'follow' && type !== 'save')) {
    throw new AppError('VALIDATION_ERROR', "Query parameter 'type' must be 'follow' or 'save'", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(workerId)) {
    return { message: 'Removed successfully', following: false };
  }

  const result = await Follow.deleteOne({
    fromId: caller._id,
    toId: workerId,
    type
  });

  if (result.deletedCount > 0) {
    const fieldKey = `followCounts.${type}`;
    await User.updateOne(
      { _id: caller._id, [fieldKey]: { $gt: 0 } },
      { $inc: { [fieldKey]: -1 } }
    );

    logAuditEvent('follow_removed', {
      userId: caller._id,
      targetWorkerId: workerId,
      type
    });
  }

  return { message: 'Removed successfully', following: false };
}

/**
 * Lists followed or saved workers as B4 search-style cards with cursor pagination.
 * Skips inactive or incomplete workers.
 *
 * @param {object} params
 * @param {'follow'|'save'} params.type
 * @param {number} [params.limit] 1 to 50 (default 20)
 * @param {string} [params.cursor]
 * @param {object} params.caller
 * @returns {Promise<{ workers: object[], nextCursor: string|null }>}
 */
export async function listFollows({ type, limit = 20, cursor, caller }) {
  if (!type || (type !== 'follow' && type !== 'save')) {
    throw new AppError('VALIDATION_ERROR', "Query parameter 'type' must be 'follow' or 'save'", 400);
  }

  const parsedLimit = Number(limit) || 20;
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    throw new AppError('VALIDATION_ERROR', 'limit must be between 1 and 50', 400);
  }

  let cursorData = null;
  if (cursor) {
    cursorData = decodeCursor(cursor);
    if (!cursorData) {
      throw new AppError('BAD_CURSOR', 'Invalid or tampered pagination cursor', 400);
    }
  }

  const matchQuery = {
    fromId: caller._id,
    type
  };

  if (cursorData) {
    const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);
    const cursorDate = new Date(cursorData.val);

    matchQuery.$or = [
      { createdAt: { $lt: cursorDate } },
      { createdAt: cursorDate, _id: { $lt: cursorObjId } }
    ];
  }

  const pipeline = [
    { $match: matchQuery },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: parsedLimit + 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'toId',
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

  const docs = await Follow.aggregate(pipeline);
  const hasNext = docs.length > parsedLimit;
  const pageDocs = hasNext ? docs.slice(0, parsedLimit) : docs;

  const originCoords = resolveViewerOrigin(caller);

  const workers = pageDocs.map((item) => {
    const w = item.workerDoc;
    const locDoc = w.localityKey ? getLocalityByKey(w.localityKey) : null;
    const effective = w.rateHourlyEffective || 0;

    let approxDist = undefined;
    if (originCoords && locDoc) {
      const distMeters = calculateHaversineDistance(
        originCoords[1],
        originCoords[0],
        locDoc.lat,
        locDoc.lng
      );
      approxDist = formatApproxDistance(distMeters);
    }

    const card = {
      id: w._id.toString(),
      name: w.name,
      photoUrl: w.photoUrl || null,
      mainSkill: w.mainSkill || (w.skills && w.skills[0]) || null,
      rate: {
        hourly: w.hourlyRate || null,
        daily: w.dailyRate || null,
        effectiveHourly: effective
      },
      rating: (w.passportStats?.jobs || 0) > 0 ? (w.passportStats?.avgRating || null) : null,
      jobsCount: w.passportStats?.jobs || 0,
      hasVerifiedHistory: (w.passportStats?.jobs || 0) > 0,
      localityName: locDoc ? locDoc.name : null
    };

    if (approxDist) {
      card.approxDistance = approxDist;
    }

    return card;
  });

  let nextCursor = null;
  if (hasNext && pageDocs.length > 0) {
    const lastItem = pageDocs[pageDocs.length - 1];
    nextCursor = encodeCursor({
      id: lastItem._id.toString(),
      val: lastItem.createdAt.toISOString()
    });
  }

  return { workers, nextCursor };
}
