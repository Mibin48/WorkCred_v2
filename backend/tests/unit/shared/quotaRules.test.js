/**
 * backend/tests/unit/shared/quotaRules.test.js
 *
 * Tests:
 * - India calendar day rollover at 23:59:59 and 00:00:00 IST.
 * - Daily limit enforcement (10 posts/day) and rollover reset.
 * - Active post cap (100 active).
 * - Follow and save caps (500 follows, 500 saves).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getIndiaDayKey,
  canCreatePost,
  canFollow,
  QUOTA_CAPS
} from '../../../../shared/quotaRules.js';

describe('shared/quotaRules.js Unit Tests', () => {
  it('correctly calculates India dayKey and handles midnight rollover at 23:59:59 and 00:00:00 IST', () => {
    // 23:59:59 IST on 2026-10-17 is 18:29:59 UTC on 2026-10-17
    const beforeMidnightUtc = new Date('2026-10-17T18:29:59.000Z');
    assert.equal(getIndiaDayKey(beforeMidnightUtc), '2026-10-17');

    // 00:00:00 IST on 2026-10-18 is 18:30:00 UTC on 2026-10-17
    const atMidnightUtc = new Date('2026-10-17T18:30:00.000Z');
    assert.equal(getIndiaDayKey(atMidnightUtc), '2026-10-18');
  });

  describe('canCreatePost', () => {
    it('allows post when under active cap and daily quota', () => {
      const user = {
        activePostCount: 5,
        postQuota: { dayKey: '2026-10-17', count: 3 }
      };
      const res = canCreatePost(user, '2026-10-17');
      assert.equal(res.allowed, true);
    });

    it('rejects post when active post cap (100) is reached', () => {
      const user = {
        activePostCount: 100,
        postQuota: { dayKey: '2026-10-17', count: 2 }
      };
      const res = canCreatePost(user, '2026-10-17');
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'POST_LIMIT_ACTIVE');
    });

    it('rejects post when daily limit (10) for same dayKey is reached', () => {
      const user = {
        activePostCount: 20,
        postQuota: { dayKey: '2026-10-17', count: 10 }
      };
      const res = canCreatePost(user, '2026-10-17');
      assert.equal(res.allowed, false);
      assert.equal(res.reason, 'POST_LIMIT_DAILY');
    });

    it('allows post when daily count was 10 but dayKey rolled over to new day', () => {
      const user = {
        activePostCount: 20,
        postQuota: { dayKey: '2026-10-16', count: 10 }
      };
      const res = canCreatePost(user, '2026-10-17');
      assert.equal(res.allowed, true);
    });
  });

  describe('canFollow', () => {
    it('enforces 500 follow limit', () => {
      assert.equal(canFollow({ followCounts: { follow: 499 } }, 'follow').allowed, true);
      const atLimit = canFollow({ followCounts: { follow: 500 } }, 'follow');
      assert.equal(atLimit.allowed, false);
      assert.equal(atLimit.reason, 'FOLLOW_LIMIT');
    });

    it('enforces 500 save limit independently of follows', () => {
      const user = { followCounts: { follow: 500, save: 499 } };
      assert.equal(canFollow(user, 'save').allowed, true);
      const atSaveLimit = canFollow({ followCounts: { follow: 10, save: 500 } }, 'save');
      assert.equal(atSaveLimit.allowed, false);
      assert.equal(atSaveLimit.reason, 'SAVE_LIMIT');
    });
  });
});
