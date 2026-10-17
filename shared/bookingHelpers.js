/**
 * B5 Pure shared helpers for bookings, handshake, and passport.
 * These functions have zero side effects and can run in any environment.
 *
 * Covered:
 *   maskEmployerName       – display name masking (H7)
 *   generateRecordId       – Crockford base32 record ID (H3)
 *   isValidRecordId        – format validator
 *   computeHoursWorked     – minutes between two dates / 60, rounded to 2 dp, never negative (H2)
 *   cashAmount             – agreedRate × bookedHours, rounded to 0 dp (H2)
 *   displayStatus          – read-time status string (H4)
 *   bookingTabFor          – which tab a booking belongs to per role (H4)
 *   isWithinEarlyStartWindow – booking cannot start earlier than 60 min before scheduledAt
 *   attemptStateCalc       – pure function describing counter/lock transitions (HAND-4)
 *   verifyChain            – cryptographic chain verification (PASS-4)
 */

import crypto from 'node:crypto';
import { computePassportHash, GENESIS_PREV_HASH } from './passportHash.js';

// ---------------------------------------------------------------------------
// Crockford base32 alphabet (no I, L, O, U)
// ---------------------------------------------------------------------------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a random 8-character Crockford base32 string.
 * Uses crypto.randomBytes so it is safe to use as a unique identifier.
 * NOT derived from the hash; NOT part of the hash (H3).
 * @returns {string}  e.g. "3A7GVN4R"
 */
export function generateRecordId() {
  // 5 random bytes give 40 bits → 8 characters in base32 (5 bits each)
  const buf = crypto.randomBytes(5);
  let result = '';
  // Extract 5 bits at a time from the 40-bit buffer
  // Pack into a BigInt for clean bit manipulation
  let n = 0n;
  for (const byte of buf) {
    n = (n << 8n) | BigInt(byte);
  }
  for (let i = 0; i < 8; i++) {
    // Take the top 5 bits each time
    const idx = Number((n >> 35n) & 0x1fn);
    result += CROCKFORD[idx];
    n = (n << 5n) & 0xffffffffffn; // keep 40 bits
  }
  return result;
}

/**
 * Validates a record ID string: exactly 8 chars from Crockford alphabet (uppercase).
 * @param {string} id
 * @returns {boolean}
 */
export function isValidRecordId(id) {
  if (typeof id !== 'string' || id.length !== 8) return false;
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(id);
}

// ---------------------------------------------------------------------------
// maskEmployerName  (H7)
// ---------------------------------------------------------------------------
/**
 * Masks an employer name for display.
 *   "Ravi Kumar"  → "R*** K."
 *   "Ravi"        → "R***"
 *   ""            → "***"
 *   Extra spaces collapsed; non-Latin letters handled by
 *   using the code point of the first character.
 *
 * Rules:
 *  - Split on whitespace, filter empty tokens.
 *  - First token  → first char + "***"
 *  - Last token (if different) → first char + "."
 *  - If only one token: just "F***"
 *
 * @param {string} name
 * @returns {string}
 */
export function maskEmployerName(name) {
  if (!name || typeof name !== 'string') return '***';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '***';
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  // First character (may be multi-byte Unicode but charAt works for BMP)
  const firstChar = first.charAt(0);
  if (tokens.length === 1) {
    return `${firstChar}***`;
  }
  const lastChar = last.charAt(0);
  return `${firstChar}*** ${lastChar}.`;
}

// ---------------------------------------------------------------------------
// computeHoursWorked  (H2)
// ---------------------------------------------------------------------------
/**
 * Computes hours worked as (finishedAt - startedAt) / 60, rounded to 2 dp.
 * Returns 0 if negative (guard only; should never happen in normal flow).
 *
 * @param {Date} startedAt
 * @param {Date} finishedAt
 * @returns {number}  e.g. 1.50
 */
export function computeHoursWorked(startedAt, finishedAt) {
  const ms = finishedAt.getTime() - startedAt.getTime();
  if (ms <= 0) return 0;
  const minutes = ms / 60000;
  return Number((minutes / 60).toFixed(2));
}

// ---------------------------------------------------------------------------
// cashAmount  (H2)
// ---------------------------------------------------------------------------
/**
 * Cash amount = agreedRate (₹/hr) × bookedHours, rounded to nearest integer.
 * @param {number} agreedRate  rupees per hour
 * @param {number} bookedHours  booked hours (1 to 12)
 * @returns {number}  integer rupees
 */
export function cashAmount(agreedRate, bookedHours) {
  return Math.round(agreedRate * bookedHours);
}

// ---------------------------------------------------------------------------
// displayStatus  (H4)
// Read-time derived display status.  Stored status is NOT changed.
// ---------------------------------------------------------------------------
/**
 * Returns the display status string for a booking at a given clock time.
 *
 * States that may differ from stored status:
 *   pending   + scheduledAt in the past                       → "expired"
 *   confirmed + scheduledAt + hours window ended (not started)→ "missed"
 * All other states pass through unchanged.
 *
 * @param {{ status: string, scheduledAt: Date, hours: number }} booking
 * @param {Date} now
 * @returns {string}
 */
export function displayStatus(booking, now) {
  const { status, scheduledAt, hours } = booking;
  const schedMs = scheduledAt instanceof Date ? scheduledAt.getTime() : new Date(scheduledAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (status === 'pending' && schedMs <= nowMs) {
    return 'expired';
  }
  if (status === 'confirmed') {
    // Window ends at scheduledAt + hours
    const windowEndMs = schedMs + hours * 60 * 60 * 1000;
    if (nowMs >= windowEndMs) {
      return 'missed';
    }
  }
  return status;
}

// ---------------------------------------------------------------------------
// bookingTabFor  (H4)
// ---------------------------------------------------------------------------
const CUSTOMER_TABS = ['upcoming', 'active', 'done', 'cancelled'];
const WORKER_TABS = ['requests', 'upcoming', 'active', 'done', 'cancelled'];

/**
 * Returns the tab name for a booking, or null if it belongs to no tab.
 *
 * Customer tabs:
 *   upcoming  – pending or confirmed, NOT expired or missed
 *   active    – in_progress
 *   done      – completed
 *   cancelled – cancelled, expired, missed
 *
 * Worker tabs:
 *   requests  – pending, NOT expired
 *   upcoming  – confirmed, NOT missed
 *   active    – in_progress
 *   done      – completed
 *   cancelled – cancelled, expired, missed
 *
 * @param {'customer'|'worker'} role
 * @param {{ status: string, scheduledAt: Date, hours: number }} booking
 * @param {Date} now
 * @returns {string|null}
 */
export function bookingTabFor(role, booking, now) {
  const ds = displayStatus(booking, now);

  if (role === 'customer') {
    if (ds === 'pending' || ds === 'confirmed') return 'upcoming';
    if (ds === 'in_progress') return 'active';
    if (ds === 'completed') return 'done';
    if (ds === 'cancelled' || ds === 'expired' || ds === 'missed') return 'cancelled';
    return null;
  }

  if (role === 'worker') {
    if (ds === 'pending') return 'requests';
    if (ds === 'confirmed') return 'upcoming';
    if (ds === 'in_progress') return 'active';
    if (ds === 'completed') return 'done';
    if (ds === 'cancelled' || ds === 'expired' || ds === 'missed') return 'cancelled';
    return null;
  }

  return null;
}

export { CUSTOMER_TABS, WORKER_TABS };

// ---------------------------------------------------------------------------
// isWithinEarlyStartWindow
// ---------------------------------------------------------------------------
/**
 * Returns true if `now` is within 60 minutes BEFORE scheduledAt (inclusive),
 * i.e. the worker is allowed to enter the start code at this moment.
 *
 * Rule (HAND-2 + requirement):
 *   The server must NOT let the start happen earlier than 60 minutes
 *   before scheduledAt.
 *   → allowed when: now >= scheduledAt - 60 minutes
 *
 * @param {Date} scheduledAt
 * @param {Date} now
 * @returns {boolean}
 */
export function isWithinEarlyStartWindow(scheduledAt, now) {
  const earliestAllowedMs = scheduledAt.getTime() - 60 * 60 * 1000;
  return now.getTime() >= earliestAllowedMs;
}

// ---------------------------------------------------------------------------
// attemptStateCalc  (HAND-4)
// Pure function; no DB access.
// ---------------------------------------------------------------------------
/**
 * Given the raw attempt counters and lock state, returns the next state
 * after one attempt reservation.
 *
 * Rules (see SECURITY_SPEC §2.4 and HAND-4):
 *   - Attempts are numbered 1..5. The 5th wrong attempt sets the lock.
 *   - "Reservation" means: if not locked, increment counter and return result.
 *   - If already locked (lockUntil > now) → LOCKED.
 *   - If counter >= 5 and lockUntil <= now → the lock has expired: reset counter to 0 first.
 *   - After reservation, if new counter == 5 → set lock for 10 minutes.
 *   - If new counter > 5 → REFUSED (should not happen in normal flow).
 *
 * Returns:
 *  { allowed: false, reason: 'LOCKED',   lockedUntil: Date, minutesLeft: number }
 *  { allowed: false, reason: 'REFUSED' }   // counter somehow > 5
 *  { allowed: true,  newAttempts: number, setLockUntil: Date|null, attemptsLeft: number }
 *
 * @param {{ attempts: number, lockUntil: Date|null }} state   current DB state
 * @param {Date} now
 * @returns {object}
 */
export function attemptStateCalc(state, now) {
  const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes
  const MAX_ATTEMPTS = 5;

  let { attempts, lockUntil } = state;
  const nowMs = now.getTime();

  // 1. Check if currently locked
  if (lockUntil && lockUntil.getTime() > nowMs) {
    const minutesLeft = Math.ceil((lockUntil.getTime() - nowMs) / 60000);
    return { allowed: false, reason: 'LOCKED', lockedUntil: lockUntil, minutesLeft };
  }

  // 2. Lock has expired (or never set): reset counter if it was maxed
  if (attempts >= MAX_ATTEMPTS) {
    attempts = 0;
  }

  // 3. Refuse if somehow beyond max (safety guard)
  if (attempts >= MAX_ATTEMPTS) {
    return { allowed: false, reason: 'REFUSED' };
  }

  // 4. Reserve one slot
  const newAttempts = attempts + 1;
  const attemptsLeft = MAX_ATTEMPTS - newAttempts; // after this attempt
  let setLockUntil = null;

  if (newAttempts >= MAX_ATTEMPTS) {
    setLockUntil = new Date(nowMs + LOCK_DURATION_MS);
  }

  return {
    allowed: true,
    newAttempts,
    setLockUntil,
    attemptsLeft,
    wasReset: state.attempts >= MAX_ATTEMPTS // tells caller to also reset in DB
  };
}

// ---------------------------------------------------------------------------
// verifyChain  (PASS-4)
// ---------------------------------------------------------------------------
/**
 * Verifies the entire passport hash chain for one worker.
 *
 * Returns needs_attention if ANY of:
 *   1. seq not contiguous from 1
 *   2. prevHash of entry N does not match hash of entry N-1
 *      (entry 1's prevHash must be 64 zeros)
 *   3. recomputed hash does not match stored hash
 *   4. last entry's seq/hash do not match passportHead
 *   5. passportStats.jobs differs from number of entries
 *   6. duplicate bookingId detected
 *   7. (empty history with jobs > 0 or head.seq > 0 is also invalid)
 *
 * @param {Array<{
 *   seq: number,
 *   bookingId: string,
 *   skill: string,
 *   date: Date|string,
 *   hours: number,
 *   rating: number,
 *   comment: string,
 *   employerName: string,
 *   prevHash: string,
 *   hash: string
 * }>} entries  ALL entries (including hidden) in seq ORDER (ascending)
 * @param {{ seq: number, hash: string }} head  from worker.passportHead
 * @param {{ jobs: number }} stats  from worker.passportStats
 * @returns {{ status: 'valid'|'needs_attention', records: number }}
 */
export function verifyChain(entries, head, stats) {
  const N = entries.length;

  // Empty chain is valid iff head.seq === 0 and stats.jobs === 0
  if (N === 0) {
    const valid = head.seq === 0 && stats.jobs === 0;
    return {
      status: valid ? 'valid' : 'needs_attention',
      records: 0
    };
  }

  // stats.jobs must equal number of entries
  if (stats.jobs !== N) {
    return { status: 'needs_attention', records: N };
  }

  const seenBookingIds = new Set();

  for (let i = 0; i < N; i++) {
    const entry = entries[i];

    // 1. seq must be contiguous from 1
    if (entry.seq !== i + 1) {
      return { status: 'needs_attention', records: N };
    }

    // 6. Duplicate bookingId
    const bid = String(entry.bookingId);
    if (seenBookingIds.has(bid)) {
      return { status: 'needs_attention', records: N };
    }
    seenBookingIds.add(bid);

    // 2. prevHash linkage
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : entries[i - 1].hash;
    if (entry.prevHash !== expectedPrev) {
      return { status: 'needs_attention', records: N };
    }

    // 3. Recompute hash
    const recomputed = computePassportHash({
      prevHash: entry.prevHash,
      seq: entry.seq,
      bookingId: String(entry.bookingId),
      skill: entry.skill,
      date: entry.date,
      hours: entry.hours,
      rating: entry.rating,
      comment: entry.comment,
      employerName: entry.employerName
    });

    if (recomputed !== entry.hash) {
      return { status: 'needs_attention', records: N };
    }
  }

  // 4. Head must match last entry
  const last = entries[N - 1];
  if (head.seq !== last.seq || head.hash !== last.hash) {
    return { status: 'needs_attention', records: N };
  }

  return { status: 'valid', records: N };
}
