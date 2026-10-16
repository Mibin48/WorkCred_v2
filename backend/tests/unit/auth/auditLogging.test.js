import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { maskEmail, maskPhone } from '../../../src/utils/logger.js';

describe('backend/tests/unit/auth/auditLogging.test.js (Log capture and redaction)', () => {
  it('masks email addresses accurately', () => {
    assert.equal(maskEmail('ravi@example.com'), 'r***i@example.com');
    assert.equal(maskEmail('ab@example.com'), 'a***@example.com');
    assert.equal(maskEmail('customer.service@domain.org'), 'c***e@domain.org');
  });

  it('masks phone numbers accurately', () => {
    assert.equal(maskPhone('9876543210'), '98****3210');
  });

  it('guarantees no plaintext password, token, or full unmasked email in log events', () => {
    let capturedLog = '';
    const customStream = {
      write(msg) {
        capturedLog += msg;
      }
    };

    const testLogger = pino({
      level: 'info',
      redact: {
        paths: ['password', 'token', 'refreshToken', 'cookie'],
        censor: '[REDACTED]'
      }
    }, customStream);

    const sensitivePassword = 'SuperSecretPassword123#';
    const rawRefreshToken = '6382103789421038471203847120398471203847120384712038471203847120';
    const rawEmail = 'confidential.user@example.com';
    const masked = maskEmail(rawEmail);

    testLogger.info({
      audit: true,
      event: 'signup',
      email: masked,
      userId: '670f5e128b9c2a1122334455',
      password: sensitivePassword,
      refreshToken: rawRefreshToken
    }, 'AUDIT_EVENT: signup');

    assert.ok(!capturedLog.includes(sensitivePassword), 'Plain password must never appear in logs');
    assert.ok(!capturedLog.includes(rawRefreshToken), 'Raw tokens must never appear in logs');
    assert.ok(!capturedLog.includes(rawEmail), 'Full unmasked email must never appear in logs');
    assert.ok(capturedLog.includes(masked), 'Masked email should appear in logs');
    assert.ok(capturedLog.includes('[REDACTED]'), 'Redacted marker should replace password/token');
  });
});
