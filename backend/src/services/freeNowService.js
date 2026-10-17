/**
 * backend/src/services/freeNowService.js – Free Now business logic.
 *
 * Implements FREE-1 to FREE-5 and Decisions J2, J3, J4, J5:
 *   - Live availability window management
 *   - Read-time expiry
 *   - Atomic conditional updates
 *   - Single-live-window concurrency guard
 *   - Domain event publishing for radar updates
 */

import mongoose from 'mongoose';
import { Availability } from '../models/Availability.js';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import { clock } from '../utils/clock.js';
import { AppError } from '../utils/errors.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { getIndiaTimeParts } from '../../../shared/calendarRules.js';
import {
  validateHours,
  validateExtendHours,
  canExtend,
  remainingExtendableHours,
  minutesLeft,
  MAX_FREE_NOW_HOURS
} from '../../../shared/freeNowRules.js';
import { eventBus } from '../realtime/eventBus.js';
import { buildRadarWorkerFreePayload, buildRadarWorkerBusyPayload } from '../realtime/payloadBuilders.js';

// Active setTimeout timers map: workerId -> Timeout
const expiryTimers = new Map();

/**
 * Schedules a faster-path setTimeout for window expiry.
 * Timer triggers sweeper check when window expires.
 *
 * @param {string} workerIdStr
 * @param {Date} expiresAt
 */
export function scheduleExpiryTimer(workerIdStr, expiresAt) {
  clearExpiryTimer(workerIdStr);
  const now = clock.now();
  const delayMs = Math.max(0, expiresAt.getTime() - now.getTime());

  // Cap at 24 hours to prevent 32-bit int overflow in setTimeout
  if (delayMs <= 86400000) {
    const timer = setTimeout(async () => {
      try {
        await closeFreeNowWindow(workerIdStr, 'expired');
      } catch {
        // best-effort
      }
    }, delayMs);
    timer.unref?.();
    expiryTimers.set(workerIdStr, timer);
  }
}

/**
 * Clears an existing expiry timer for a worker.
 *
 * @param {string} workerIdStr
 */
export function clearExpiryTimer(workerIdStr) {
  if (expiryTimers.has(workerIdStr)) {
    clearTimeout(expiryTimers.get(workerIdStr));
    expiryTimers.delete(workerIdStr);
  }
}

/**
 * Clears all pending timers (used on shutdown and test teardown).
 */
export function clearAllExpiryTimers() {
  for (const timer of expiryTimers.values()) {
    clearTimeout(timer);
  }
  expiryTimers.clear();
}

/**
 * Helper: formats window object for responses.
 *
 * @param {object|null} win
 * @param {Date} now
 * @returns {object|null}
 */
export function formatWindow(win, now) {
  if (!win) return null;
  const startsAt = win.startsAt instanceof Date ? win.startsAt : new Date(win.startsAt);
  const expiresAt = win.expiresAt instanceof Date ? win.expiresAt : new Date(win.expiresAt);
  const totalHours = Math.round((expiresAt.getTime() - startsAt.getTime()) / 3600000);

  return {
    id: win._id.toString(),
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    minutesLeft: minutesLeft(expiresAt, now),
    totalHours,
    canExtendHours: remainingExtendableHours(startsAt, expiresAt)
  };
}

/**
 * Closes a worker's active Free Now window (idempotent atomic conditional update).
 * Announces radar:worker_busy only if it actually closed a live window.
 *
 * @param {string|mongoose.Types.ObjectId} workerId
 * @param {'stopped' | 'expired' | 'booked' | 'confirmed' | 'accepted' | 'started'} reason
 * @returns {Promise<boolean>} True if a live window was closed, false otherwise
 */
export async function closeFreeNowWindow(workerId, reason) {
  if (!workerId) return false;
  const workerObjId = typeof workerId === 'string' ? new mongoose.Types.ObjectId(workerId) : workerId;
  const workerIdStr = workerObjId.toString();
  const now = clock.now();

  const closed = await Availability.findOneAndUpdate(
    { workerId: workerObjId, active: true },
    {
      $set: {
        active: false,
        closedReason: reason,
        closedAt: now,
        announcedBusy: true
      }
    },
    { new: false } // returns document prior to update
  );

  if (closed) {
    clearExpiryTimer(workerIdStr);
    logAuditEvent('free_now_closed', { workerId: workerIdStr, reason });

    const coords = closed.location?.coordinates || [0, 0];
    const origin = { lng: coords[0], lat: coords[1] };

    eventBus.publish('radar:worker_busy', {
      payload: buildRadarWorkerBusyPayload(workerIdStr, reason),
      workerOrigin: origin
    });
    return true;
  }

  return false;
}

/**
 * Creates and starts a new Free Now window for a worker.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.workerId
 * @param {number} params.hours Exactly 2, 4, or 8
 * @param {object} params.user Worker User document
 * @returns {Promise<object>}
 */
export async function startFreeNowWindow({ workerId, hours, user }) {
  if (!user.profileComplete) {
    throw new AppError('PROFILE_INCOMPLETE', 'Complete your profile before going Free Now', 403);
  }

  if (!validateHours(hours)) {
    throw new AppError('VALIDATION_ERROR', 'hours must be exactly 2, 4, or 8', 400);
  }

  const workerObjId = typeof workerId === 'string' ? new mongoose.Types.ObjectId(workerId) : workerId;
  const workerIdStr = workerObjId.toString();
  const now = clock.now();

  // 1. Check no booking of this worker is in_progress (409 JOB_IN_PROGRESS)
  const inProgressBooking = await Booking.findOne({
    workerId: workerObjId,
    status: 'in_progress'
  });
  if (inProgressBooking) {
    throw new AppError('JOB_IN_PROGRESS', 'Cannot go Free Now while a job is in progress', 409);
  }

  // 2. Calendar rule: today not a blocked date in India time (J3, 409 BLOCKED_TODAY)
  const { dateString } = getIndiaTimeParts(now);
  if (Array.isArray(user.calendar?.blockedDates)) {
    const isBlocked = user.calendar.blockedDates.some((b) => {
      const bDate = typeof b === 'string' ? b : b?.date;
      return bDate === dateString;
    });
    if (isBlocked) {
      throw new AppError('BLOCKED_TODAY', 'Today is marked as a blocked date on your calendar', 409);
    }
  }

  // 3. Close any expired-but-still-active window of this worker first
  await Availability.updateMany(
    { workerId: workerObjId, active: true, expiresAt: { $lte: now } },
    {
      $set: {
        active: false,
        closedReason: 'expired',
        closedAt: now,
        announcedBusy: true
      }
    }
  );

  // 4. Resolve search location (centroid of locality)
  let searchLocation = user.searchLocation;
  if (!searchLocation || !searchLocation.coordinates || (searchLocation.coordinates[0] === 0 && searchLocation.coordinates[1] === 0)) {
    if (user.localityKey) {
      const loc = getLocalityByKey(user.localityKey);
      if (loc) {
        searchLocation = { type: 'Point', coordinates: [loc.lng, loc.lat] };
      }
    }
  }
  if (!searchLocation || !searchLocation.coordinates || (searchLocation.coordinates[0] === 0 && searchLocation.coordinates[1] === 0)) {
    throw new AppError('SET_AREA', 'Set your locality before going Free Now', 400);
  }

  const rateHourly = user.rateHourlyEffective || user.hourlyRate || (user.dailyRate ? Math.round(user.dailyRate / 8) : 0);
  const startsAt = now;
  const expiresAt = new Date(now.getTime() + hours * 3600000);

  // 5. Insert new window with duplicate-key race guard (UNIQUE partial index on active)
  let newWindow;
  try {
    newWindow = await Availability.create({
      workerId: workerObjId,
      location: searchLocation,
      localityKey: user.localityKey,
      skills: Array.isArray(user.skills) ? user.skills : [],
      rateHourly,
      startsAt,
      expiresAt,
      active: true,
      announcedBusy: false
    });
  } catch (err) {
    if (err.code === 11000) {
      // Live window already exists
      const existing = await Availability.findOne({ workerId: workerObjId, active: true });
      const errApp = new AppError('ALREADY_FREE', 'You already have an active Free Now window', 409);
      errApp.details = { window: formatWindow(existing, now) };
      throw errApp;
    }
    throw err;
  }

  // Schedule timer
  scheduleExpiryTimer(workerIdStr, expiresAt);
  logAuditEvent('free_now_started', { workerId: workerIdStr, hours });

  // Publish radar:worker_free
  eventBus.publish('radar:worker_free', {
    payload: buildRadarWorkerFreePayload(workerIdStr),
    workerOrigin: { lng: searchLocation.coordinates[0], lat: searchLocation.coordinates[1] }
  });

  return {
    window: formatWindow(newWindow, now),
    serverTime: now.toISOString()
  };
}

/**
 * Extends an existing live Free Now window.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.workerId
 * @param {number} params.hours 1, 2, or 4
 * @returns {Promise<object>}
 */
export async function extendFreeNowWindow({ workerId, hours }) {
  if (!validateExtendHours(hours)) {
    throw new AppError('VALIDATION_ERROR', 'hours must be 1, 2, or 4', 400);
  }

  const workerObjId = typeof workerId === 'string' ? new mongoose.Types.ObjectId(workerId) : workerId;
  const workerIdStr = workerObjId.toString();
  const now = clock.now();

  const win = await Availability.findOne({
    workerId: workerObjId,
    active: true,
    expiresAt: { $gt: now }
  });

  if (!win) {
    throw new AppError('NO_WINDOW', 'No active Free Now window found to extend', 404);
  }

  if (!canExtend(win.startsAt, win.expiresAt, hours, MAX_FREE_NOW_HOURS)) {
    const remainingHours = remainingExtendableHours(win.startsAt, win.expiresAt, MAX_FREE_NOW_HOURS);
    const err = new AppError('EXTEND_LIMIT', `Total window duration cannot exceed 12 hours. Remaining extendable hours: ${remainingHours}`, 409);
    err.details = { remainingHours };
    err.extra = { remainingHours };
    throw err;
  }

  const addedMs = hours * 3600000;
  const newExpiresAt = new Date(win.expiresAt.getTime() + addedMs);

  const updated = await Availability.findOneAndUpdate(
    { _id: win._id, active: true },
    { $set: { expiresAt: newExpiresAt } },
    { new: true }
  );

  if (!updated) {
    throw new AppError('NO_WINDOW', 'Window was closed concurrently', 404);
  }

  scheduleExpiryTimer(workerIdStr, newExpiresAt);
  logAuditEvent('free_now_extended', { workerId: workerIdStr, hours });

  return {
    window: formatWindow(updated, now),
    serverTime: now.toISOString()
  };
}

/**
 * Stops an active Free Now window. Safe to repeat.
 *
 * @param {mongoose.Types.ObjectId|string} workerId
 * @returns {Promise<object>}
 */
export async function stopFreeNowWindow(workerId) {
  const workerObjId = typeof workerId === 'string' ? new mongoose.Types.ObjectId(workerId) : workerId;
  const workerIdStr = workerObjId.toString();

  await closeFreeNowWindow(workerObjId, 'stopped');
  logAuditEvent('free_now_stopped', { workerId: workerIdStr });

  return { message: 'Free Now window stopped successfully' };
}

/**
 * Fetches the caller worker's current Free Now status.
 *
 * @param {mongoose.Types.ObjectId|string} workerId
 * @returns {Promise<object>}
 */
export async function getWorkerFreeNowWindow(workerId) {
  const workerObjId = typeof workerId === 'string' ? new mongoose.Types.ObjectId(workerId) : workerId;
  const now = clock.now();

  const win = await Availability.findOne({
    workerId: workerObjId,
    active: true,
    expiresAt: { $gt: now }
  });

  return {
    window: formatWindow(win, now),
    serverTime: now.toISOString()
  };
}
