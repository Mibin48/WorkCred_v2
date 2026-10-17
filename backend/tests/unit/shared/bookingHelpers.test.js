/**
 * Unit tests for B5 shared pure helpers (bookingHelpers.js).
 *
 * Tests:
 *  - maskEmployerName
 *  - generateRecordId / isValidRecordId
 *  - computeHoursWorked
 *  - cashAmount
 *  - displayStatus for every stored state + read-time transitions
 *  - bookingTabFor for every state and role
 *  - isWithinEarlyStartWindow boundary cases
 *  - attemptStateCalc: happy paths, 5th wrong sets lock, lock expiry resets,
 *    reservation beyond 5 is refused
 *  - verifyChain: valid chain, 10 tamper scenarios
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  maskEmployerName,
  generateRecordId,
  isValidRecordId,
  computeHoursWorked,
  cashAmount,
  displayStatus,
  bookingTabFor,
  isWithinEarlyStartWindow,
  attemptStateCalc,
  verifyChain
} from '../../../../shared/bookingHelpers.js';

import { computePassportHash, GENESIS_PREV_HASH } from '../../../../shared/passportHash.js';

// ---------------------------------------------------------------------------
// Helpers for building minimal booking and entry objects
// ---------------------------------------------------------------------------
function makeBooking(overrides) {
  const scheduledAt = new Date('2026-10-20T10:00:00.000Z');
  return {
    status: 'pending',
    scheduledAt,
    hours: 4,
    ...overrides
  };
}

function makeEntry(overrides) {
  const base = {
    seq: 1,
    bookingId: '670f5e128b9c2a1122334455',
    skill: 'electrician',
    date: new Date('2026-10-16T00:00:00.000Z'),
    hours: 3.5,
    rating: 5,
    comment: 'Great work fixing the distribution board.',
    employerName: 'Ramesh Kumar',
    prevHash: GENESIS_PREV_HASH,
    hash: ''
  };
  const merged = { ...base, ...overrides };
  // Compute hash if not provided
  if (!merged.hash) {
    merged.hash = computePassportHash(merged);
  }
  return merged;
}

/**
 * Build a chain of N entries where each is properly linked.
 */
function buildChain(n, overrides = []) {
  const entries = [];
  for (let i = 1; i <= n; i++) {
    const prev = entries[i - 2];
    const prevHash = prev ? prev.hash : GENESIS_PREV_HASH;
    const base = {
      seq: i,
      bookingId: `booking${i.toString().padStart(20, '0')}`,
      skill: 'electrician',
      date: new Date(`2026-10-${String(i).padStart(2, '0')}T00:00:00.000Z`),
      hours: 2.0,
      rating: 4,
      comment: `Job ${i}`,
      employerName: 'Test Customer',
      prevHash,
      hash: ''
    };
    const specific = overrides[i - 1] || {};
    const entry = { ...base, ...specific };
    // Only compute hash if not explicitly overridden
    if (!specific.hash) {
      entry.hash = computePassportHash(entry);
    }
    entries.push(entry);
  }
  return entries;
}

function headFromEntries(entries) {
  if (entries.length === 0) return { seq: 0, hash: GENESIS_PREV_HASH };
  const last = entries[entries.length - 1];
  return { seq: last.seq, hash: last.hash };
}

// ---------------------------------------------------------------------------
describe('maskEmployerName', () => {
  it('masks two-word name', () => {
    assert.equal(maskEmployerName('Ravi Kumar'), 'R*** K.');
  });
  it('masks single name', () => {
    assert.equal(maskEmployerName('Ravi'), 'R***');
  });
  it('handles empty string', () => {
    assert.equal(maskEmployerName(''), '***');
  });
  it('handles null/undefined', () => {
    assert.equal(maskEmployerName(null), '***');
    assert.equal(maskEmployerName(undefined), '***');
  });
  it('collapses extra spaces', () => {
    assert.equal(maskEmployerName('  Ravi   Kumar  '), 'R*** K.');
  });
  it('handles three-word name (uses first and last)', () => {
    const result = maskEmployerName('Ravi Mohan Kumar');
    assert.equal(result, 'R*** K.');
  });
  it('uses first char of last name for initial', () => {
    assert.equal(maskEmployerName('Lakshmi Devi'), 'L*** D.');
  });
});

// ---------------------------------------------------------------------------
describe('generateRecordId and isValidRecordId', () => {
  it('generates 8-char string', () => {
    const id = generateRecordId();
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 8);
  });
  it('uses only Crockford alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRecordId();
      assert.match(id, /^[0-9A-HJKMNP-TV-Z]{8}$/, `invalid id: ${id}`);
    }
  });
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRecordId()));
    assert(ids.size >= 45, 'Expected mostly unique IDs');
  });
  it('isValidRecordId accepts valid id', () => {
    assert.equal(isValidRecordId('A1B2C3D4'), true);
    assert.equal(isValidRecordId('00000000'), true);
  });
  it('isValidRecordId rejects invalid chars', () => {
    assert.equal(isValidRecordId('A1B2C3DI'), false); // I not allowed
    assert.equal(isValidRecordId('A1B2C3DL'), false); // L not allowed
    assert.equal(isValidRecordId('A1B2C3DO'), false); // O not allowed
    assert.equal(isValidRecordId('A1B2C3DU'), false); // U not allowed
  });
  it('isValidRecordId rejects wrong length', () => {
    assert.equal(isValidRecordId('ABCDEFG'), false);   // 7
    assert.equal(isValidRecordId('ABCDEFGHI'), false); // 9
  });
  it('isValidRecordId rejects lowercase', () => {
    assert.equal(isValidRecordId('a1b2c3d4'), false);
  });
});

// ---------------------------------------------------------------------------
describe('computeHoursWorked', () => {
  it('computes 1 hour correctly', () => {
    const start = new Date('2026-10-16T09:00:00Z');
    const end = new Date('2026-10-16T10:00:00Z');
    assert.equal(computeHoursWorked(start, end), 1.00);
  });
  it('computes 1.5 hours', () => {
    const start = new Date('2026-10-16T09:00:00Z');
    const end = new Date('2026-10-16T10:30:00Z');
    assert.equal(computeHoursWorked(start, end), 1.50);
  });
  it('computes fractional hours', () => {
    const start = new Date('2026-10-16T09:00:00Z');
    const end = new Date('2026-10-16T09:10:00Z'); // 10 minutes
    assert.equal(computeHoursWorked(start, end), Number((10 / 60).toFixed(2)));
  });
  it('returns 0 for negative duration (guard)', () => {
    const start = new Date('2026-10-16T10:00:00Z');
    const end = new Date('2026-10-16T09:00:00Z');
    assert.equal(computeHoursWorked(start, end), 0);
  });
  it('returns 0 for equal times', () => {
    const t = new Date();
    assert.equal(computeHoursWorked(t, t), 0);
  });
});

// ---------------------------------------------------------------------------
describe('cashAmount', () => {
  it('calculates rate × hours', () => {
    assert.equal(cashAmount(100, 4), 400);
  });
  it('rounds to nearest integer', () => {
    assert.equal(cashAmount(125, 3), 375); // exact
    assert.equal(cashAmount(133, 3), 399);
  });
  it('handles half hours', () => {
    assert.equal(cashAmount(200, 1.5), 300);
  });
});

// ---------------------------------------------------------------------------
describe('displayStatus', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const future = new Date('2026-10-20T13:00:00Z');
  const past = new Date('2026-10-20T10:00:00Z');

  it('pending + future scheduledAt → pending', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: future });
    assert.equal(displayStatus(b, now), 'pending');
  });

  it('pending + past scheduledAt → expired', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: past });
    assert.equal(displayStatus(b, now), 'expired');
  });

  it('confirmed + window not ended → confirmed', () => {
    // scheduledAt = now+1h, hours = 4 → window ends at now+5h
    const scheduledAt = new Date(now.getTime() + 60 * 60 * 1000);
    const b = makeBooking({ status: 'confirmed', scheduledAt, hours: 4 });
    assert.equal(displayStatus(b, now), 'confirmed');
  });

  it('confirmed + window ended → missed', () => {
    // scheduledAt = past, hours = 1 → window ended at past+1h, which is before now
    const scheduledAt = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3h ago
    const b = makeBooking({ status: 'confirmed', scheduledAt, hours: 1 });
    assert.equal(displayStatus(b, now), 'missed');
  });

  it('in_progress → in_progress', () => {
    const b = makeBooking({ status: 'in_progress' });
    assert.equal(displayStatus(b, now), 'in_progress');
  });

  it('completed → completed', () => {
    const b = makeBooking({ status: 'completed' });
    assert.equal(displayStatus(b, now), 'completed');
  });

  it('cancelled → cancelled', () => {
    const b = makeBooking({ status: 'cancelled' });
    assert.equal(displayStatus(b, now), 'cancelled');
  });
});

// ---------------------------------------------------------------------------
describe('bookingTabFor', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const future = new Date('2026-10-21T10:00:00Z');
  const past3h = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  // Customer tabs
  it('customer: pending+future → upcoming', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: future });
    assert.equal(bookingTabFor('customer', b, now), 'upcoming');
  });
  it('customer: confirmed+future → upcoming', () => {
    const b = makeBooking({ status: 'confirmed', scheduledAt: future });
    assert.equal(bookingTabFor('customer', b, now), 'upcoming');
  });
  it('customer: in_progress → active', () => {
    const b = makeBooking({ status: 'in_progress' });
    assert.equal(bookingTabFor('customer', b, now), 'active');
  });
  it('customer: completed → done', () => {
    const b = makeBooking({ status: 'completed' });
    assert.equal(bookingTabFor('customer', b, now), 'done');
  });
  it('customer: cancelled → cancelled', () => {
    const b = makeBooking({ status: 'cancelled' });
    assert.equal(bookingTabFor('customer', b, now), 'cancelled');
  });
  it('customer: expired pending → cancelled', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: past3h });
    assert.equal(bookingTabFor('customer', b, now), 'cancelled');
  });
  it('customer: missed confirmed → cancelled', () => {
    const b = makeBooking({ status: 'confirmed', scheduledAt: past3h, hours: 1 });
    assert.equal(bookingTabFor('customer', b, now), 'cancelled');
  });

  // Worker tabs
  it('worker: pending+future → requests', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: future });
    assert.equal(bookingTabFor('worker', b, now), 'requests');
  });
  it('worker: confirmed+future → upcoming', () => {
    const b = makeBooking({ status: 'confirmed', scheduledAt: future });
    assert.equal(bookingTabFor('worker', b, now), 'upcoming');
  });
  it('worker: in_progress → active', () => {
    const b = makeBooking({ status: 'in_progress' });
    assert.equal(bookingTabFor('worker', b, now), 'active');
  });
  it('worker: completed → done', () => {
    const b = makeBooking({ status: 'completed' });
    assert.equal(bookingTabFor('worker', b, now), 'done');
  });
  it('worker: cancelled → cancelled', () => {
    const b = makeBooking({ status: 'cancelled' });
    assert.equal(bookingTabFor('worker', b, now), 'cancelled');
  });
  it('worker: expired pending → cancelled', () => {
    const b = makeBooking({ status: 'pending', scheduledAt: past3h });
    assert.equal(bookingTabFor('worker', b, now), 'cancelled');
  });
  it('worker: missed confirmed → cancelled', () => {
    const b = makeBooking({ status: 'confirmed', scheduledAt: past3h, hours: 1 });
    assert.equal(bookingTabFor('worker', b, now), 'cancelled');
  });
});

// ---------------------------------------------------------------------------
describe('isWithinEarlyStartWindow', () => {
  const scheduledAt = new Date('2026-10-20T10:00:00Z');

  it('allowed at exactly 60 minutes before', () => {
    const now = new Date(scheduledAt.getTime() - 60 * 60 * 1000);
    assert.equal(isWithinEarlyStartWindow(scheduledAt, now), true);
  });

  it('allowed at 59 minutes before (inside window)', () => {
    const now = new Date(scheduledAt.getTime() - 59 * 60 * 1000);
    assert.equal(isWithinEarlyStartWindow(scheduledAt, now), true);
  });

  it('NOT allowed at 61 minutes before', () => {
    const now = new Date(scheduledAt.getTime() - 61 * 60 * 1000);
    assert.equal(isWithinEarlyStartWindow(scheduledAt, now), false);
  });

  it('allowed at exactly scheduledAt', () => {
    assert.equal(isWithinEarlyStartWindow(scheduledAt, scheduledAt), true);
  });

  it('allowed after scheduledAt', () => {
    const now = new Date(scheduledAt.getTime() + 30 * 60 * 1000);
    assert.equal(isWithinEarlyStartWindow(scheduledAt, now), true);
  });
});

// ---------------------------------------------------------------------------
describe('attemptStateCalc', () => {
  const now = new Date('2026-10-20T10:00:00Z');

  it('first attempt allowed', () => {
    const result = attemptStateCalc({ attempts: 0, lockUntil: null }, now);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttempts, 1);
    assert.equal(result.attemptsLeft, 4);
    assert.equal(result.setLockUntil, null);
  });

  it('4th attempt allowed, no lock', () => {
    const result = attemptStateCalc({ attempts: 3, lockUntil: null }, now);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttempts, 4);
    assert.equal(result.attemptsLeft, 1);
    assert.equal(result.setLockUntil, null);
  });

  it('5th attempt allowed, sets lock', () => {
    const result = attemptStateCalc({ attempts: 4, lockUntil: null }, now);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttempts, 5);
    assert.equal(result.attemptsLeft, 0);
    assert.notEqual(result.setLockUntil, null);
    // Lock should be 10 minutes from now
    const diff = result.setLockUntil.getTime() - now.getTime();
    assert.equal(diff, 10 * 60 * 1000);
  });

  it('locked: returns LOCKED', () => {
    const lockUntil = new Date(now.getTime() + 5 * 60 * 1000); // 5 min lock remaining
    const result = attemptStateCalc({ attempts: 5, lockUntil }, now);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'LOCKED');
    assert.equal(result.minutesLeft, 5);
  });

  it('lock expired: resets counter and allows', () => {
    const lockUntil = new Date(now.getTime() - 1000); // expired 1 second ago
    const result = attemptStateCalc({ attempts: 5, lockUntil }, now);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttempts, 1); // reset to 0 then inc
    assert.equal(result.wasReset, true);
  });

  it('lock expired with null lockUntil (never locked)', () => {
    // attempts = 5 but lockUntil = null (shouldn't normally happen; guard)
    const result = attemptStateCalc({ attempts: 5, lockUntil: null }, now);
    assert.equal(result.allowed, true);
    assert.equal(result.newAttempts, 1);
  });
});

// ---------------------------------------------------------------------------
describe('verifyChain', () => {
  it('empty chain with 0 jobs and 0 head seq → valid', () => {
    const result = verifyChain([], { seq: 0, hash: GENESIS_PREV_HASH }, { jobs: 0 });
    assert.equal(result.status, 'valid');
    assert.equal(result.records, 0);
  });

  it('empty chain with jobs > 0 → needs_attention', () => {
    const result = verifyChain([], { seq: 0, hash: GENESIS_PREV_HASH }, { jobs: 1 });
    assert.equal(result.status, 'needs_attention');
  });

  it('valid single-entry chain', () => {
    const entries = buildChain(1);
    const head = headFromEntries(entries);
    const result = verifyChain(entries, head, { jobs: 1 });
    assert.equal(result.status, 'valid');
    assert.equal(result.records, 1);
  });

  it('valid 3-entry chain', () => {
    const entries = buildChain(3);
    const head = headFromEntries(entries);
    const result = verifyChain(entries, head, { jobs: 3 });
    assert.equal(result.status, 'valid');
    assert.equal(result.records, 3);
  });

  it('reference test vector from SECURITY_SPEC', () => {
    const entry = {
      seq: 1,
      bookingId: '670f5e128b9c2a1122334455',
      skill: 'electrician',
      date: '2026-10-16',
      hours: 3.5,
      rating: 5,
      comment: 'Great work fixing the distribution board.',
      employerName: 'Ramesh Kumar',
      prevHash: GENESIS_PREV_HASH,
      hash: ''
    };
    entry.hash = computePassportHash(entry);
    // The expected hash from SECURITY_SPEC §3.3
    assert.equal(entry.hash, '98ac98ecd2d07703d180823047245583f3c073ff47de9054327404aa45fafcbd');

    const head = { seq: 1, hash: entry.hash };
    const result = verifyChain([entry], head, { jobs: 1 });
    assert.equal(result.status, 'valid');
  });

  it('tampered hours → needs_attention', () => {
    const entries = buildChain(3);
    const head = headFromEntries(entries);
    entries[1] = { ...entries[1], hours: 9.99 }; // tamper hours, keep stored hash
    const result = verifyChain(entries, head, { jobs: 3 });
    assert.equal(result.status, 'needs_attention');
  });

  it('tampered rating → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    entries[0] = { ...entries[0], rating: 1 }; // was 4, tamper to 1
    const result = verifyChain(entries, head, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('tampered comment → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    entries[0] = { ...entries[0], comment: 'Tampered!' };
    const result = verifyChain(entries, head, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('tampered employerName → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    entries[0] = { ...entries[0], employerName: 'Hacker' };
    const result = verifyChain(entries, head, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('tampered skill → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    entries[0] = { ...entries[0], skill: 'plumber' };
    const result = verifyChain(entries, head, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('swapped order (seq 1 and 2 swapped) → needs_attention', () => {
    const entries = buildChain(3);
    const head = headFromEntries(entries);
    // Swap first two entries
    const swapped = [entries[1], entries[0], entries[2]];
    const result = verifyChain(swapped, head, { jobs: 3 });
    assert.equal(result.status, 'needs_attention');
  });

  it('missing middle entry → needs_attention (seq gap)', () => {
    const entries = buildChain(3);
    const head = headFromEntries(entries);
    // Remove entry 2 (middle)
    const missing = [entries[0], entries[2]];
    const result = verifyChain(missing, head, { jobs: 3 });
    assert.equal(result.status, 'needs_attention');
  });

  it('deleted last entry (head mismatch) → needs_attention', () => {
    const entries = buildChain(3);
    const head = headFromEntries(entries); // head = seq 3
    // Remove the last entry
    const truncated = entries.slice(0, 2);
    const result = verifyChain(truncated, head, { jobs: 3 });
    assert.equal(result.status, 'needs_attention');
  });

  it('wrong head hash → needs_attention', () => {
    const entries = buildChain(2);
    const badHead = { seq: 2, hash: 'a'.repeat(64) }; // wrong hash
    const result = verifyChain(entries, badHead, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('stats count mismatch → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    // jobs says 3 but there are only 2 entries
    const result = verifyChain(entries, head, { jobs: 3 });
    assert.equal(result.status, 'needs_attention');
  });

  it('duplicate bookingId → needs_attention', () => {
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    // Force same bookingId on both entries (but recompute hashes to keep them internally consistent)
    const same = 'booking00000000000000000001';
    const e1 = { ...entries[0], bookingId: same };
    e1.hash = computePassportHash(e1);
    const e2 = {
      ...entries[1],
      bookingId: same,
      prevHash: e1.hash
    };
    e2.hash = computePassportHash(e2);
    const dupHead = { seq: e2.seq, hash: e2.hash };
    const result = verifyChain([e1, e2], dupHead, { jobs: 2 });
    assert.equal(result.status, 'needs_attention');
  });

  it('toggling visible or maskEmployerName leaves chain valid', () => {
    // These fields are NOT in the hash, so toggling them doesn't affect validity
    const entries = buildChain(2);
    const head = headFromEntries(entries);
    // Add visible/maskEmployerName to entries (not part of verifyChain input, but simulated)
    // verifyChain only uses the fields it needs; adding extra fields is safe
    entries[0].visible = false;
    entries[0].maskEmployerName = false;
    const result = verifyChain(entries, head, { jobs: 2 });
    assert.equal(result.status, 'valid');
  });
});

// ---------------------------------------------------------------------------
describe('haversine boundary at 499m, 500m, 501m', () => {
  // We test through geo.js rather than duplicating the formula
  it('calculates distance close to 500m correctly', async () => {
    const { calculateHaversineDistance } = await import('../../../../shared/geo.js');
    // Reference point: 9.9333 N, 76.2981 E (Thevara)
    const lat1 = 9.9333, lng1 = 76.2981;
    // Move ~500m north: 0.004496 degrees lat ≈ 500m
    const lat2_499 = lat1 + 0.004491; // ~499m
    const lat2_500 = lat1 + 0.004496; // ~500m
    const lat2_501 = lat1 + 0.004505; // ~501m

    const d499 = calculateHaversineDistance(lat1, lng1, lat2_499, lng1);
    const d500 = calculateHaversineDistance(lat1, lng1, lat2_500, lng1);
    const d501 = calculateHaversineDistance(lat1, lng1, lat2_501, lng1);

    assert(d499 < 500, `Expected d499 < 500, got ${d499}`);
    assert(d500 <= 501, `Expected d500 close to 500, got ${d500}`);
    assert(d501 > 500, `Expected d501 > 500, got ${d501}`);
  });
});
