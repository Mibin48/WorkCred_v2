/**
 * shared/freeNowRules.js – Pure Free Now business rules.
 *
 * Rules:
 *   - Worker picks 2, 4 or 8 hours at start (FREE-1)
 *   - Extend by 1, 2 or 4 hours up to 12 hours total
 *   - Read-time expiry: windowIsLive(window, now)
 */

export const ALLOWED_HOURS = [2, 4, 8];
export const ALLOWED_EXTEND_HOURS = [1, 2, 4];
export const MAX_FREE_NOW_HOURS = 12;

/**
 * Validates initial Free Now window duration in hours.
 * Must be an integer and exactly 2, 4, or 8.
 *
 * @param {any} hours
 * @returns {boolean}
 */
export function validateHours(hours) {
  const h = Number(hours);
  return Number.isInteger(h) && ALLOWED_HOURS.includes(h);
}

/**
 * Validates Free Now extension duration in hours.
 * Must be an integer and exactly 1, 2, or 4.
 *
 * @param {any} hours
 * @returns {boolean}
 */
export function validateExtendHours(hours) {
  const h = Number(hours);
  return Number.isInteger(h) && ALLOWED_EXTEND_HOURS.includes(h);
}

/**
 * Checks whether extending a window by `addHours` would exceed `maxHours` (default 12)
 * from its original `startsAt`.
 *
 * @param {Date|string|number} startsAt
 * @param {Date|string|number} expiresAt
 * @param {number} addHours
 * @param {number} [maxHours=12]
 * @returns {boolean}
 */
export function canExtend(startsAt, expiresAt, addHours, maxHours = MAX_FREE_NOW_HOURS) {
  const startMs = new Date(startsAt).getTime();
  const currentExpiryMs = new Date(expiresAt).getTime();
  const addedMs = Number(addHours) * 3600000;
  const newTotalMs = currentExpiryMs + addedMs - startMs;
  return newTotalMs <= maxHours * 3600000;
}

/**
 * Calculates remaining hours that can be added to the window without exceeding maxHours.
 *
 * @param {Date|string|number} startsAt
 * @param {Date|string|number} expiresAt
 * @param {number} [maxHours=12]
 * @returns {number} integer hours between 0 and 12
 */
export function remainingExtendableHours(startsAt, expiresAt, maxHours = MAX_FREE_NOW_HOURS) {
  const startMs = new Date(startsAt).getTime();
  const currentExpiryMs = new Date(expiresAt).getTime();
  const usedHours = (currentExpiryMs - startMs) / 3600000;
  return Math.max(0, Math.floor(maxHours - usedHours));
}

/**
 * Computes minutes left until expiresAt relative to now.
 * Ceiled so 59 seconds counts as 1 minute left.
 * At or past expiry returns 0.
 *
 * @param {Date|string|number} expiresAt
 * @param {Date|string|number} now
 * @returns {number} non-negative integer
 */
export function minutesLeft(expiresAt, now) {
  const expMs = new Date(expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  const diffMs = expMs - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 60000);
}

/**
 * Checks if a window is currently live (active is true and expiresAt > now).
 * Read-time expiry check.
 *
 * @param {object|null} window
 * @param {Date|string|number} now
 * @returns {boolean}
 */
export function windowIsLive(window, now) {
  if (!window || typeof window !== 'object') return false;
  if (!window.active) return false;
  const expMs = new Date(window.expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  return expMs > nowMs;
}
