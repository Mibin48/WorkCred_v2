/**
 * passportService.js – B5 Work Passport business logic.
 *
 * Security-critical functions:
 *   - getPublicPassport   (GET /workers/:id/passport)
 *   - verifyPassport      (GET /workers/:id/passport/verify)
 *   - getMyPassport       (GET /passport/me)
 *   - patchPassportEntry  (PATCH /passport/entries/:id)
 *   - runChainVerification (internal: loads all entries and verifies)
 */

import mongoose from 'mongoose';
import { PassportEntry } from '../models/PassportEntry.js';
import { User } from '../models/User.js';
import { verifyChain, maskEmployerName } from '../../../shared/bookingHelpers.js';
import { encodeCursor, decodeCursor } from '../../../shared/jobRules.js';
import { logAuditEvent } from '../utils/auditLogger.js';

// ---------------------------------------------------------------------------
// Chain verification helper
// ---------------------------------------------------------------------------
/**
 * Loads all entries for a worker in seq order and verifies the chain.
 * Includes hidden entries (visibility does not affect integrity).
 *
 * @param {mongoose.Types.ObjectId} workerId
 * @returns {{ status: 'valid'|'needs_attention', records: number, privateIncludedCount: number }}
 */
export async function runChainVerification(workerId) {
  const worker = await User.findById(workerId).select('passportStats passportHead');
  if (!worker) return { status: 'needs_attention', records: 0, privateIncludedCount: 0 };

  const entries = await PassportEntry.find({ workerId })
    .sort({ seq: 1 })
    .select('seq bookingId skill date hours rating comment employerName prevHash hash visible');

  const privateCount = entries.filter((e) => !e.visible).length;

  const result = verifyChain(
    entries.map((e) => ({
      seq: e.seq,
      bookingId: e.bookingId.toString(),
      skill: e.skill,
      date: e.date,
      hours: e.hours,
      rating: e.rating,
      comment: e.comment || '',
      employerName: e.employerName,
      prevHash: e.prevHash,
      hash: e.hash
    })),
    {
      seq: worker.passportHead.seq,
      hash: worker.passportHead.hash
    },
    {
      jobs: worker.passportStats.jobs
    }
  );

  return {
    ...result,
    privateIncludedCount: privateCount
  };
}

// ---------------------------------------------------------------------------
// GET /workers/:id/passport  (public view, visible entries only)
// ---------------------------------------------------------------------------
/**
 * Returns visible passport entries with masked employer names.
 *
 * @param {string} workerId
 * @param {{ limit?, cursor? }} query
 * @returns {{ entries: [], nextCursor: string|null, privateIncludedCount: number, historyCheck: {} }}
 */
export async function getPublicPassport(workerId, query) {
  if (!mongoose.Types.ObjectId.isValid(workerId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  // Validate this is an active, complete worker
  const worker = await User.findOne({
    _id: workerId,
    role: 'worker',
    isActive: true,
    profileComplete: true
  });
  if (!worker) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  let limit = 20;
  if (query.limit !== undefined) {
    const l = Number(query.limit);
    if (isNaN(l) || l < 1 || l > 50) {
      const err = new Error('limit must be between 1 and 50'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    limit = l;
  }

  let cursorData = null;
  if (query.cursor) {
    cursorData = decodeCursor(query.cursor);
    if (!cursorData) {
      const err = new Error('Invalid cursor'); err.code = 'BAD_CURSOR'; err.statusCode = 400; throw err;
    }
  }

  const filter = { workerId: worker._id, visible: true };
  if (cursorData) {
    filter.$or = [
      { seq: { $lt: cursorData.val } },
      { seq: cursorData.val, _id: { $lt: new mongoose.Types.ObjectId(cursorData.id) } }
    ];
  }

  const raw = await PassportEntry.find(filter)
    .sort({ seq: -1 })
    .limit(limit + 1)
    .select('recordId skill date hours rating comment employerName employerDisplay maskEmployerName visible seq createdAt');

  const hasNext = raw.length > limit;
  const results = hasNext ? raw.slice(0, limit) : raw;

  const items = results.map((e) => ({
    recordId: e.recordId,
    skill: e.skill,
    date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : e.date,
    hours: e.hours,
    rating: e.rating,
    comment: e.comment || '',
    // employerDisplay: show masked unless worker turned masking off
    employerDisplay: e.maskEmployerName
      ? maskEmployerName(e.employerName)
      : (e.employerDisplay?.name || e.employerName)
  }));

  let nextCursor = null;
  if (hasNext && results.length > 0) {
    const last = results[results.length - 1];
    nextCursor = encodeCursor({ id: last._id.toString(), val: last.seq });
  }

  // Count total private entries (for the note)
  const allEntriesCount = await PassportEntry.countDocuments({ workerId: worker._id });
  const visibleCount = await PassportEntry.countDocuments({ workerId: worker._id, visible: true });
  const privateIncludedCount = allEntriesCount - visibleCount;

  // Run chain verification
  const historyCheck = await runChainVerification(worker._id);

  return {
    entries: items,
    nextCursor,
    privateIncludedCount,
    historyCheck
  };
}

// ---------------------------------------------------------------------------
// GET /workers/:id/passport/verify  (logged in)
// ---------------------------------------------------------------------------
/**
 * Runs chain verification and returns { status, records } only.
 * Never returns hashes or details.
 *
 * @param {string} workerId
 * @returns {{ status: string, records: number }}
 */
export async function verifyPassport(workerId) {
  if (!mongoose.Types.ObjectId.isValid(workerId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const worker = await User.findOne({
    _id: workerId,
    role: 'worker',
    isActive: true,
    profileComplete: true
  });
  if (!worker) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const { status, records } = await runChainVerification(worker._id);
  return { status, records };
}

// ---------------------------------------------------------------------------
// GET /passport/me  (worker only, full timeline including hidden)
// ---------------------------------------------------------------------------
/**
 * Returns all entries (including hidden) for the logged-in worker.
 * Includes seq, visible, maskEmployerName flags, and stats.
 *
 * @param {object} caller req.user (worker)
 * @param {{ limit?, cursor? }} query
 */
export async function getMyPassport(caller, query) {
  let limit = 20;
  if (query.limit !== undefined) {
    const l = Number(query.limit);
    if (isNaN(l) || l < 1 || l > 50) {
      const err = new Error('limit must be between 1 and 50'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    limit = l;
  }

  let cursorData = null;
  if (query.cursor) {
    cursorData = decodeCursor(query.cursor);
    if (!cursorData) {
      const err = new Error('Invalid cursor'); err.code = 'BAD_CURSOR'; err.statusCode = 400; throw err;
    }
  }

  const filter = { workerId: caller._id };
  if (cursorData) {
    filter.$or = [
      { seq: { $lt: cursorData.val } },
      { seq: cursorData.val, _id: { $lt: new mongoose.Types.ObjectId(cursorData.id) } }
    ];
  }

  const raw = await PassportEntry.find(filter)
    .sort({ seq: -1 })
    .limit(limit + 1)
    .select('recordId skill date hours rating comment employerName employerDisplay maskEmployerName visible seq createdAt');

  const hasNext = raw.length > limit;
  const results = hasNext ? raw.slice(0, limit) : raw;

  const items = results.map((e) => {
    const item = {
      recordId: e.recordId,
      seq: e.seq,
      skill: e.skill,
      date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : e.date,
      hours: e.hours,
      rating: e.rating,
      comment: e.comment || '',
      visible: e.visible,
      maskEmployerName: e.maskEmployerName,
      // If maskEmployerName is false, show the real name; else show masked
      employerDisplay: e.maskEmployerName
        ? maskEmployerName(e.employerName)
        : (e.employerDisplay?.name || e.employerName)
    };
    // Worker sees their own name if masking is off
    if (!e.maskEmployerName) {
      item.employerName = e.employerDisplay?.name || e.employerName;
    }
    return item;
  });

  let nextCursor = null;
  if (hasNext && results.length > 0) {
    const last = results[results.length - 1];
    nextCursor = encodeCursor({ id: last._id.toString(), val: last.seq });
  }

  // Stats from user document
  const worker = await User.findById(caller._id).select('passportStats passportHead');
  const stats = {
    jobs: worker.passportStats.jobs,
    totalHours: worker.passportStats.totalHours,
    avgRating: worker.passportStats.avgRating,
    topSkills: worker.passportStats.topSkills || []
  };

  // History check (includes hidden)
  const historyCheck = await runChainVerification(caller._id);

  return {
    entries: items,
    nextCursor,
    stats,
    historyCheck
  };
}

// ---------------------------------------------------------------------------
// PATCH /passport/entries/:id  (worker only, own entries, visible + maskEmployerName only)
// ---------------------------------------------------------------------------
/**
 * Toggles visible and/or maskEmployerName on a passport entry.
 * Any other field in the body → 400 (nothing changes).
 * Another worker's entry → 404.
 *
 * @param {string} recordId  Crockford base32 record ID
 * @param {object} body  may contain visible (boolean), maskEmployerName (boolean)
 * @param {object} caller req.user (worker)
 */
export async function patchPassportEntry(recordId, body, caller) {
  // Validate that ONLY allowed fields are present
  const allowedFields = ['visible', 'maskEmployerName'];
  const receivedKeys = Object.keys(body || {});
  const forbidden = receivedKeys.filter((k) => !allowedFields.includes(k));
  if (forbidden.length > 0) {
    const err = new Error(`Only visible and maskEmployerName can be updated. Forbidden: ${forbidden.join(', ')}`);
    err.code = 'FORBIDDEN_FIELD'; err.statusCode = 400; throw err;
  }
  if (receivedKeys.length === 0) {
    const err = new Error('At least one of visible or maskEmployerName must be provided');
    err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
  }

  const entry = await PassportEntry.findOne({ recordId });
  if (!entry || entry.workerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const updateSet = {};
  if ('visible' in body) {
    if (typeof body.visible !== 'boolean') {
      const err = new Error('visible must be a boolean'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    updateSet.visible = body.visible;
  }
  if ('maskEmployerName' in body) {
    if (typeof body.maskEmployerName !== 'boolean') {
      const err = new Error('maskEmployerName must be a boolean'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    updateSet.maskEmployerName = body.maskEmployerName;
  }

  // Use updateOne (the Mongoose pre-hook validates only visible/maskEmployerName are touched)
  await PassportEntry.updateOne({ _id: entry._id }, { $set: updateSet });

  logAuditEvent('entry_visibility_changed', {
    userId: caller._id,
    entryId: entry._id.toString(),
    recordId,
    changedFields: Object.keys(updateSet)
  });

  const updated = await PassportEntry.findById(entry._id)
    .select('recordId skill date hours rating comment employerDisplay maskEmployerName visible seq');

  return {
    recordId: updated.recordId,
    seq: updated.seq,
    skill: updated.skill,
    visible: updated.visible,
    maskEmployerName: updated.maskEmployerName,
    employerDisplay: updated.maskEmployerName
      ? maskEmployerName(entry.employerName)
      : (updated.employerDisplay?.name || entry.employerName)
  };
}
