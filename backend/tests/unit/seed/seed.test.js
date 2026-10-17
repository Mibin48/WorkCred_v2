import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_WORKERS,
  SAMPLE_CUSTOMERS,
  COMPLETED_BOOKINGS_PLAN,
  validateDatasetSanity,
  createRng
} from '../../../src/seed/dataset.js';
import { withClock } from '../../../src/seed/clockTravel.js';
import { generateSolidPng } from '../../../src/seed/placeholders.js';
import { clock } from '../../../src/utils/clock.js';
import { containsContactInfo } from '../../../../shared/containsContactInfo.js';

describe('S1 Seed Unit Tests', () => {
  describe('Dataset Sanity', () => {
    it('passes all validateDatasetSanity assertions', () => {
      assert.doesNotThrow(() => validateDatasetSanity());
    });

    it('has exactly 12 workers and 8 customers', () => {
      assert.equal(SAMPLE_WORKERS.length, 12);
      assert.equal(SAMPLE_CUSTOMERS.length, 8);
    });

    it('all sample emails are in example.com and unique', () => {
      const allUsers = [...SAMPLE_WORKERS, ...SAMPLE_CUSTOMERS];
      const emails = new Set();
      for (const u of allUsers) {
        assert.ok(u.email.endsWith('@example.com'), `Email ${u.email} must end in @example.com`);
        assert.ok(!emails.has(u.email), `Duplicate email ${u.email}`);
        emails.add(u.email);
      }
    });

    it('all sample phones are in 9000000xxx range and unique', () => {
      const allUsers = [...SAMPLE_WORKERS, ...SAMPLE_CUSTOMERS];
      const phones = new Set();
      for (const u of allUsers) {
        assert.match(u.phone, /^9000000\d{3}$/, `Phone ${u.phone} must match 9000000xxx`);
        assert.ok(!phones.has(u.phone), `Duplicate phone ${u.phone}`);
        phones.add(u.phone);
      }
    });

    it('all descriptions, notes and comments pass containsContactInfo', () => {
      for (const w of SAMPLE_WORKERS) {
        if (w.bio) {
          assert.equal(containsContactInfo(w.bio), false, `Worker bio has contact info: ${w.bio}`);
        }
      }
      for (const p of COMPLETED_BOOKINGS_PLAN) {
        if (p.comment) {
          assert.equal(containsContactInfo(p.comment), false, `Comment has contact info: ${p.comment}`);
        }
      }
    });

    it('all rates are within sensible bounds (80 to 500)', () => {
      for (const w of SAMPLE_WORKERS) {
        if (w.hourlyRate) {
          assert.ok(w.hourlyRate >= 80 && w.hourlyRate <= 500);
        }
        if (w.dailyRate) {
          assert.ok(w.dailyRate >= 500 && w.dailyRate <= 4000);
        }
      }
      for (const p of COMPLETED_BOOKINGS_PLAN) {
        assert.ok(p.rate >= 80 && p.rate <= 500);
      }
    });
  });

  describe('clockTravel Helper', () => {
    it('freezes clock inside withClock and restores real clock after success', async () => {
      const originalNow = clock.now();
      const fakeTime = new Date('2020-01-01T12:00:00.000Z');

      await withClock(fakeTime, async () => {
        assert.equal(clock.now().toISOString(), fakeTime.toISOString());
      });

      const restoredNow = clock.now();
      assert.ok(Math.abs(restoredNow.getTime() - originalNow.getTime()) < 1000);
    });

    it('restores real clock even after thrown error', async () => {
      const originalNow = clock.now();
      const fakeTime = new Date('2021-05-10T08:00:00.000Z');

      await assert.rejects(
        async () => {
          await withClock(fakeTime, async () => {
            throw new Error('Test intentional failure');
          });
        },
        /Test intentional failure/
      );

      const restoredNow = clock.now();
      assert.ok(Math.abs(restoredNow.getTime() - originalNow.getTime()) < 1000);
    });
  });

  describe('Placeholder PNG Generator', () => {
    it('generates valid PNG buffer with approved solid color', () => {
      const pngBuffer = generateSolidPng('#f3efe6');
      assert.ok(Buffer.isBuffer(pngBuffer));
      // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
      assert.equal(pngBuffer[0], 0x89);
      assert.equal(pngBuffer[1], 0x50);
      assert.equal(pngBuffer[2], 0x4e);
      assert.equal(pngBuffer[3], 0x47);
      assert.equal(pngBuffer[4], 0x0d);
      assert.equal(pngBuffer[5], 0x0a);
      assert.equal(pngBuffer[6], 0x1a);
      assert.equal(pngBuffer[7], 0x0a);
    });

    it('rejects unapproved color hex', () => {
      assert.throws(() => generateSolidPng('#ff0000'), /not in approved sample colors list/);
    });
  });

  describe('Deterministic Mulberry32 PRNG', () => {
    it('produces identical sequences given identical seed', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);

      const seq1 = [rng1(), rng1(), rng1()];
      const seq2 = [rng2(), rng2(), rng2()];

      assert.deepEqual(seq1, seq2);
    });

    it('produces different sequences given different seed', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(43);

      assert.notEqual(rng1(), rng2());
    });
  });
});
