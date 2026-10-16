import crypto from 'node:crypto';

export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Normalizes string for canonical Passport record hashing:
 * Converts null/undefined to empty string, trims, applies Unicode NFC normalization.
 * @param {string} str 
 * @returns {string}
 */
export function normalizePassportString(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim().normalize('NFC');
}

/**
 * Computes canonical SHA-256 hex hash for a Work Passport record (Decision F4).
 *
 * Hash covers:
 * ["v1", prevHash, seq, bookingId, skill, dateUTC, hoursToTwoDecimalsAsString, ratingInteger, commentTrimmedNFC, employerRealName]
 *
 * NOTE: The hash binds the REAL employer name and does NOT bind `visible` or `maskEmployerName`.
 *
 * @param {{
 *   prevHash: string,
 *   seq: number,
 *   bookingId: string,
 *   skill: string,
 *   date: string|Date,
 *   hours: number,
 *   rating: number,
 *   comment: string,
 *   employerName: string
 * }} entry
 * @returns {string} SHA-256 digest in hex
 */
export function computePassportHash(entry) {
  const prevHash = entry.seq === 1 && !entry.prevHash ? GENESIS_PREV_HASH : entry.prevHash;
  const seq = Number.parseInt(entry.seq, 10);
  const bookingId = String(entry.bookingId);
  const skill = normalizePassportString(entry.skill).toLowerCase();

  let dateUTC = '';
  if (entry.date instanceof Date) {
    dateUTC = entry.date.toISOString().slice(0, 10);
  } else if (typeof entry.date === 'string') {
    dateUTC = entry.date.slice(0, 10);
  }

  const hoursToTwoDecimalsAsString = Number(entry.hours).toFixed(2);
  const ratingInteger = Math.round(Number(entry.rating));
  const commentTrimmedNFC = normalizePassportString(entry.comment);
  const employerRealName = normalizePassportString(entry.employerName);

  const payload = [
    'v1',
    prevHash,
    seq,
    bookingId,
    skill,
    dateUTC,
    hoursToTwoDecimalsAsString,
    ratingInteger,
    commentTrimmedNFC,
    employerRealName
  ];

  const serialized = JSON.stringify(payload);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}
