import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generate4DigitCode,
  encryptCode,
  decryptCode,
  verifyCodeConstantTime
} from '../../../../shared/codesCrypto.js';

describe('shared/codesCrypto.js', () => {
  const sampleKey = crypto.randomBytes(32).toString('base64');
  const bookingId = '670f5e128b9c2a1122334455';

  it('generates a 4-digit numeric string', () => {
    const code = generate4DigitCode();
    assert.match(code, /^\d{4}$/);
  });

  it('performs full encryption and decryption round-trip correctly', () => {
    const code = '4821';
    const encrypted = encryptCode(code, sampleKey, bookingId, 'start');
    assert.match(encrypted, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

    const decrypted = decryptCode(encrypted, sampleKey, bookingId, 'start');
    assert.equal(decrypted, code);
  });

  it('fails decryption if encrypted with start and decrypted with finish (AAD binding)', () => {
    const code = '1234';
    const encrypted = encryptCode(code, sampleKey, bookingId, 'start');

    assert.throws(() => {
      decryptCode(encrypted, sampleKey, bookingId, 'finish');
    });
  });

  it('fails decryption if a different bookingId is used (AAD binding)', () => {
    const code = '5678';
    const encrypted = encryptCode(code, sampleKey, bookingId, 'start');
    const wrongBookingId = '670f5e128b9c2a1122334499';

    assert.throws(() => {
      decryptCode(encrypted, sampleKey, wrongBookingId, 'start');
    });
  });

  it('fails decryption if wrong key is provided', () => {
    const code = '9999';
    const encrypted = encryptCode(code, sampleKey, bookingId, 'finish');
    const wrongKey = crypto.randomBytes(32).toString('base64');

    assert.throws(() => {
      decryptCode(encrypted, wrongKey, bookingId, 'finish');
    });
  });

  it('verifies code constant time matches', () => {
    const code = '0420';
    const encrypted = encryptCode(code, sampleKey, bookingId, 'start');

    assert.equal(verifyCodeConstantTime('0420', encrypted, sampleKey, bookingId, 'start'), true);
    assert.equal(verifyCodeConstantTime('0421', encrypted, sampleKey, bookingId, 'start'), false);
    assert.equal(verifyCodeConstantTime('wrong', encrypted, sampleKey, bookingId, 'start'), false);
  });
});
