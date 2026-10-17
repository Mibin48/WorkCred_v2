/**
 * backend/src/realtime/sweeper.js – Ephemeral Free Now window expiry sweeper.
 *
 * Implements J5 and Requirement 6:
 *   - Runs every 30 seconds and once at startup
 *   - Closes expired windows ({ active: true, expiresAt: { $lte: now } })
 *   - Announces radar:worker_busy once per expired window (atomic announcedBusy guard)
 *   - Exposes sweepOnce(now) for deterministic test invocation
 *   - Stops cleanly on graceful shutdown
 */

import { Availability } from '../models/Availability.js';
import { clock } from '../utils/clock.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { clearExpiryTimer, clearAllExpiryTimers } from '../services/freeNowService.js';
import { eventBus } from './eventBus.js';
import { buildRadarWorkerBusyPayload } from './payloadBuilders.js';
import { logger } from '../utils/logger.js';

let sweepInterval = null;

/**
 * Runs a single sweep pass against expired windows.
 * Atomically marks them active: false, closedReason: 'expired', announcedBusy: true,
 * and emits radar:worker_busy once.
 *
 * @param {Date} [now] Injectable clock time
 * @returns {Promise<number>} Count of closed windows
 */
export async function sweepOnce(now = clock.now()) {
  try {
    const expiredCandidates = await Availability.find({
      active: true,
      expiresAt: { $lte: now }
    }).select('_id workerId location');

    let closedCount = 0;

    for (const win of expiredCandidates) {
      const updated = await Availability.findOneAndUpdate(
        {
          _id: win._id,
          active: true,
          expiresAt: { $lte: now },
          announcedBusy: false
        },
        {
          $set: {
            active: false,
            closedReason: 'expired',
            closedAt: now,
            announcedBusy: true
          }
        },
        { new: true }
      );

      if (updated) {
        closedCount++;
        const workerIdStr = updated.workerId.toString();
        clearExpiryTimer(workerIdStr);
        logAuditEvent('free_now_expired', { workerId: workerIdStr });

        const coords = updated.location?.coordinates || [0, 0];
        eventBus.publish('radar:worker_busy', {
          payload: buildRadarWorkerBusyPayload(workerIdStr, 'expired'),
          workerOrigin: { lng: coords[0], lat: coords[1] }
        });
      }
    }

    return closedCount;
  } catch (err) {
    logger.error({ err: err.message }, 'Error during Free Now sweep pass');
    return 0;
  }
}

/**
 * Starts the background sweeper loop (every 30s + immediate run).
 */
export function startSweeper() {
  if (sweepInterval) return;

  // Run once immediately
  sweepOnce().catch(() => {});

  sweepInterval = setInterval(() => {
    sweepOnce().catch(() => {});
  }, 30000);

  if (sweepInterval.unref) {
    sweepInterval.unref();
  }
}

/**
 * Stops the sweeper and clears all timers.
 */
export function stopSweeper() {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
  clearAllExpiryTimers();
}
