import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  intervalsOverlap,
  hourBoundaries,
  isWindowAvailable,
  formatApproxDistance,
  validateJobInput,
  encodeCursor,
  decodeCursor
} from '../../../../shared/jobRules.js';

describe('shared/jobRules.js unit tests', () => {
  describe('intervalsOverlap', () => {
    it('touching intervals do NOT overlap', () => {
      // 10:00 for 2h (10-12) and 12:00 for 1h (12-13)
      const a = '2026-10-20T10:00:00.000Z';
      const b = '2026-10-20T12:00:00.000Z';
      assert.equal(intervalsOverlap(a, 2, b, 1), false);
      assert.equal(intervalsOverlap(b, 1, a, 2), false);
    });

    it('partial overlap returns true', () => {
      // 10:00 for 2h (10-12) and 11:00 for 2h (11-13)
      const a = '2026-10-20T10:00:00.000Z';
      const b = '2026-10-20T11:00:00.000Z';
      assert.equal(intervalsOverlap(a, 2, b, 2), true);
      assert.equal(intervalsOverlap(b, 2, a, 2), true);
    });

    it('nested interval returns true', () => {
      // 10:00 for 4h (10-14) and 11:00 for 1h (11-12)
      const a = '2026-10-20T10:00:00.000Z';
      const b = '2026-10-20T11:00:00.000Z';
      assert.equal(intervalsOverlap(a, 4, b, 1), true);
      assert.equal(intervalsOverlap(b, 1, a, 4), true);
    });

    it('identical interval returns true', () => {
      const a = '2026-10-20T10:00:00.000Z';
      assert.equal(intervalsOverlap(a, 3, a, 3), true);
    });

    it('separated intervals do not overlap', () => {
      const a = '2026-10-20T10:00:00.000Z';
      const b = '2026-10-20T14:00:00.000Z';
      assert.equal(intervalsOverlap(a, 2, b, 2), false);
    });
  });

  describe('hourBoundaries', () => {
    it('produces correct hour boundaries for integer and half hours', () => {
      const start = '2026-10-20T10:00:00.000Z';
      const b2 = hourBoundaries(start, 2);
      assert.equal(b2.length, 3);
      assert.equal(b2[0].toISOString(), '2026-10-20T10:00:00.000Z');
      assert.equal(b2[1].toISOString(), '2026-10-20T11:00:00.000Z');
      assert.equal(b2[2].toISOString(), '2026-10-20T12:00:00.000Z');

      const b1_5 = hourBoundaries(start, 1.5);
      assert.equal(b1_5.length, 3);
      assert.equal(b1_5[2].toISOString(), '2026-10-20T11:30:00.000Z');
    });
  });

  describe('isWindowAvailable', () => {
    // 2026-10-20 is Tuesday. In India: UTC + 5.5
    // Let's create an India daytime: 10:00 AM IST on 2026-10-20
    // UTC = 04:30 AM
    const tuesdayMorningUTC = new Date('2026-10-20T04:30:00.000Z'); // 10:00 AM IST

    it('returns true when weekly schedule allows full day and no blocked dates', () => {
      const calendar = {
        weekly: { tue: 'full' },
        blockedDates: []
      };
      assert.equal(isWindowAvailable(calendar, tuesdayMorningUTC, 3), true);
    });

    it('returns false when weekday is off', () => {
      const calendar = {
        weekly: { tue: 'off' },
        blockedDates: []
      };
      assert.equal(isWindowAvailable(calendar, tuesdayMorningUTC, 2), false);
    });

    it('returns false when blocked date is inside the window', () => {
      const calendar = {
        weekly: { tue: 'full' },
        blockedDates: [{ date: '2026-10-20' }]
      };
      assert.equal(isWindowAvailable(calendar, tuesdayMorningUTC, 2), false);
    });

    it('returns false when window crosses beyond 21:00 IST', () => {
      // 19:30 IST is 14:00 UTC. 2.5 hours ends at 22:00 IST
      const eveningUTC = new Date('2026-10-20T14:00:00.000Z');
      const calendar = {
        weekly: { tue: 'full' },
        blockedDates: []
      };
      assert.equal(isWindowAvailable(calendar, eveningUTC, 2.5), false);
    });

    it('returns false when window crosses midnight', () => {
      // 23:00 IST is 17:30 UTC. 3 hours crosses midnight
      const lateUTC = new Date('2026-10-20T17:30:00.000Z');
      const calendar = {
        weekly: { tue: 'full' },
        blockedDates: []
      };
      assert.equal(isWindowAvailable(calendar, lateUTC, 3), false);
    });
  });

  describe('formatApproxDistance', () => {
    it('formats distances correctly: under 1 km, nearest 0.5 km', () => {
      assert.deepEqual(formatApproxDistance(500), { km: 1, label: 'under 1 km' });
      assert.deepEqual(formatApproxDistance(999), { km: 1, label: 'under 1 km' });
      assert.deepEqual(formatApproxDistance(1200), { km: 1, label: 'about 1.0 km' });
      assert.deepEqual(formatApproxDistance(1400), { km: 1.5, label: 'about 1.5 km' });
      assert.deepEqual(formatApproxDistance(2600), { km: 2.5, label: 'about 2.5 km' });
      assert.deepEqual(formatApproxDistance(2800), { km: 3, label: 'about 3.0 km' });
    });
  });

  describe('cursor encode and decode', () => {
    it('encodes and decodes cursor correctly', () => {
      const payload = { id: '654321654321654321654321', sortVal: 150 };
      const cursor = encodeCursor(payload);
      assert.ok(typeof cursor === 'string');
      const decoded = decodeCursor(cursor);
      assert.deepEqual(decoded, payload);
    });

    it('returns null on invalid or tampered cursor', () => {
      assert.equal(decodeCursor('invalid_base64url!#$'), null);
      assert.equal(decodeCursor('dGVzdA'), null); // 'test' not json object
      assert.equal(decodeCursor(null), null);
    });
  });

  describe('validateJobInput', () => {
    const fixedNow = new Date('2026-10-20T10:00:00.000Z');
    const fakeClock = { now: () => fixedNow };

    const validBody = {
      skill: 'electrician',
      workersNeeded: 2,
      hours: 4,
      startAt: new Date(fixedNow.getTime() + 60 * 60 * 1000).toISOString(), // 1h in future
      offeredRate: 200,
      description: 'Fix main breaker and kitchen lights'
    };

    it('accepts valid job input', () => {
      const res = validateJobInput(validBody, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(res.valid, true);
      assert.equal(res.data.skill, 'electrician');
      assert.equal(res.data.localityKey, 'edapally');
    });

    it('rejects unknown fields with 400', () => {
      const res = validateJobInput({ ...validBody, rogueField: true }, { clock: fakeClock });
      assert.equal(res.valid, false);
      assert.ok(res.errors[0].includes("Unknown field 'rogueField'"));
    });

    it('rejects description containing contact info', () => {
      const res = validateJobInput({ ...validBody, description: 'Call me at 9811122233' }, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(res.valid, false);
      assert.ok(res.errors[0].includes('contact information'));
    });

    it('validates startAt boundaries: 14m59s (invalid), 15m (valid), 30 days (valid), 30 days + 1s (invalid)', () => {
      // 14m 59s ahead -> invalid
      const t14m59s = new Date(fixedNow.getTime() + (14 * 60 + 59) * 1000).toISOString();
      const r1 = validateJobInput({ ...validBody, startAt: t14m59s }, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(r1.valid, false);

      // exactly 15m ahead -> valid
      const t15m = new Date(fixedNow.getTime() + 15 * 60 * 1000).toISOString();
      const r2 = validateJobInput({ ...validBody, startAt: t15m }, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(r2.valid, true);

      // exactly 30 days ahead -> valid
      const t30d = new Date(fixedNow.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const r3 = validateJobInput({ ...validBody, startAt: t30d }, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(r3.valid, true);

      // 30 days + 1s ahead -> invalid
      const t30d1s = new Date(fixedNow.getTime() + (30 * 24 * 60 * 60 + 1) * 1000).toISOString();
      const r4 = validateJobInput({ ...validBody, startAt: t30d1s }, { clock: fakeClock, userLocalityKey: 'edapally' });
      assert.equal(r4.valid, false);
    });

    it('validates workersNeeded (1-10) and hours (1-12, whole or half)', () => {
      assert.equal(validateJobInput({ ...validBody, workersNeeded: 0 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, workersNeeded: 11 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, hours: 0.5 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, hours: 12.5 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, hours: 2.3 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, hours: 2.5 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, true);
    });

    it('validates offeredRate (whole rupees 50 to 100000)', () => {
      assert.equal(validateJobInput({ ...validBody, offeredRate: 49 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, offeredRate: 100001 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, offeredRate: 150.5 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, false);
      assert.equal(validateJobInput({ ...validBody, offeredRate: 150 }, { clock: fakeClock, userLocalityKey: 'edapally' }).valid, true);
    });
  });
});
