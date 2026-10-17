import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHours,
  validateExtendHours,
  canExtend,
  remainingExtendableHours,
  minutesLeft,
  windowIsLive
} from '../../../../shared/freeNowRules.js';

describe('shared/freeNowRules.js unit tests', () => {
  describe('validateHours', () => {
    it('accepts 2, 4, 8 only', () => {
      assert.equal(validateHours(2), true);
      assert.equal(validateHours(4), true);
      assert.equal(validateHours(8), true);
    });

    it('rejects other numbers or invalid types', () => {
      assert.equal(validateHours(1), false);
      assert.equal(validateHours(3), false);
      assert.equal(validateHours(6), false);
      assert.equal(validateHours(12), false);
      assert.equal(validateHours(0), false);
      assert.equal(validateHours(-2), false);
      assert.equal(validateHours(2.5), false);
      assert.equal(validateHours('2'), true); // Number('2') is integer in allowed list
      assert.equal(validateHours('abc'), false);
      assert.equal(validateHours(null), false);
    });
  });

  describe('validateExtendHours', () => {
    it('accepts 1, 2, 4 only', () => {
      assert.equal(validateExtendHours(1), true);
      assert.equal(validateExtendHours(2), true);
      assert.equal(validateExtendHours(4), true);
    });

    it('rejects other values', () => {
      assert.equal(validateExtendHours(3), false);
      assert.equal(validateExtendHours(8), false);
      assert.equal(validateExtendHours(0), false);
    });
  });

  describe('canExtend and remainingExtendableHours', () => {
    const start = new Date('2026-10-17T10:00:00.000Z');

    it('allows extending when total length stays <= 12 hours', () => {
      // 8 hour window -> expires at 18:00
      const exp8 = new Date('2026-10-17T18:00:00.000Z');
      assert.equal(canExtend(start, exp8, 4), true); // 8 + 4 = 12h
      assert.equal(remainingExtendableHours(start, exp8), 4);

      // Attempting 5 hours or more beyond 12h fails
      assert.equal(canExtend(start, exp8, 5), false);
    });

    it('rejects extending when already at 12 hours', () => {
      const exp12 = new Date('2026-10-17T22:00:00.000Z');
      assert.equal(canExtend(start, exp12, 1), false);
      assert.equal(remainingExtendableHours(start, exp12), 0);
    });

    it('correctly reports remaining hours', () => {
      const exp2 = new Date('2026-10-17T12:00:00.000Z');
      assert.equal(remainingExtendableHours(start, exp2), 10);
      assert.equal(canExtend(start, exp2, 4), true);
    });
  });

  describe('minutesLeft', () => {
    it('calculates integer minutes left', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const exp = new Date('2026-10-17T10:30:00.000Z');
      assert.equal(minutesLeft(exp, now), 30);
    });

    it('ceils fractional minutes so 1 second counts as 1 minute', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const exp = new Date('2026-10-17T10:00:01.000Z');
      assert.equal(minutesLeft(exp, now), 1);
    });

    it('returns 0 when now is at or past expiresAt', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      assert.equal(minutesLeft(now, now), 0);

      const past = new Date('2026-10-17T09:59:59.000Z');
      assert.equal(minutesLeft(past, now), 0);
    });
  });

  describe('windowIsLive', () => {
    it('returns true when active and expiresAt > now', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const win = {
        active: true,
        expiresAt: new Date('2026-10-17T10:00:01.000Z')
      };
      assert.equal(windowIsLive(win, now), true);
    });

    it('returns false at exact expiry', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const win = {
        active: true,
        expiresAt: now
      };
      assert.equal(windowIsLive(win, now), false);
    });

    it('returns false if active is false', () => {
      const now = new Date('2026-10-17T10:00:00.000Z');
      const win = {
        active: false,
        expiresAt: new Date('2026-10-17T11:00:00.000Z')
      };
      assert.equal(windowIsLive(win, now), false);
    });

    it('returns false on null or non-object', () => {
      assert.equal(windowIsLive(null, new Date()), false);
      assert.equal(windowIsLive(undefined, new Date()), false);
    });
  });
});
