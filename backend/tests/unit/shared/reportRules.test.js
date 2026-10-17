/**
 * backend/tests/unit/shared/reportRules.test.js
 *
 * Tests:
 * - Valid targets (post, worker), reject booking (directed to bookings report).
 * - Valid reasons (spam, inappropriate, fake, unsafe, other).
 * - Note length limits and contact info blocking.
 * - ipHash produces 64-char hex HMAC and never raw IP.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReportInput,
  hashClientIp,
  VALID_REPORT_REASONS,
  VALID_REPORT_TARGETS
} from '../../../../shared/reportRules.js';

describe('shared/reportRules.js Unit Tests', () => {
  it('validates correct post report', () => {
    const res = validateReportInput({
      targetType: 'post',
      targetId: '654321654321654321654321',
      reason: 'spam',
      note: 'Spammy content'
    });
    assert.equal(res.valid, true);
    assert.equal(res.data.targetType, 'post');
    assert.equal(res.data.reason, 'spam');
  });

  it('rejects booking target and guides caller to booking report route', () => {
    const res = validateReportInput({
      targetType: 'booking',
      targetId: '654321654321654321654321',
      reason: 'spam'
    });
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /booking report endpoint/i);
  });

  it('rejects unknown targetType and unknown reason', () => {
    const res = validateReportInput({
      targetType: 'comment',
      targetId: '654321654321654321654321',
      reason: 'dislike'
    });
    assert.equal(res.valid, false);
    assert.equal(res.errors.length, 2);
  });

  it('rejects note with contact info', () => {
    const res = validateReportInput({
      targetType: 'worker',
      targetId: '654321654321654321654321',
      reason: 'fake',
      note: 'Call me at 9845012345 to discuss'
    });
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /prohibited contact information/);
  });

  it('computes 64-character SHA-256 HMAC for client IP', () => {
    const ip = '192.168.1.100';
    const hash1 = hashClientIp(ip, 'secret_key');
    const hash2 = hashClientIp(ip, 'secret_key');
    assert.equal(hash1.length, 64);
    assert.equal(/^[0-9a-f]{64}$/.test(hash1), true);
    assert.equal(hash1, hash2);
    assert.notEqual(hash1, ip);
  });
});
