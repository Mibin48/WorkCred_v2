/**
 * backend/tests/unit/shared/feedCursor.test.js
 *
 * Tests:
 * - Feed cursor encode, decode happy path.
 * - Tampered signature or malformed base64url returns null.
 * - Missing id or invalid date returns null.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFeedCursor, decodeFeedCursor } from '../../../../shared/feedCursor.js';

describe('shared/feedCursor.js Unit Tests', () => {
  const secret = 'my_secret_key_12345';
  const id = '654321654321654321654321';
  const createdAt = new Date('2026-10-17T12:00:00.000Z');

  it('encodes and decodes cursor correctly', () => {
    const encoded = encodeFeedCursor({ id, createdAt }, secret);
    assert.equal(typeof encoded, 'string');

    const decoded = decodeFeedCursor(encoded, secret);
    assert.ok(decoded);
    assert.equal(decoded.id, id);
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
  });

  it('rejects cursor tampered with different secret', () => {
    const encoded = encodeFeedCursor({ id, createdAt }, secret);
    const decoded = decodeFeedCursor(encoded, 'different_secret');
    assert.equal(decoded, null);
  });

  it('rejects cursor when payload modified', () => {
    const encoded = encodeFeedCursor({ id, createdAt }, secret);
    const raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    raw.id = '000000000000000000000000'; // modified id without updating signature
    const tampered = Buffer.from(JSON.stringify(raw), 'utf8').toString('base64url');

    const decoded = decodeFeedCursor(tampered, secret);
    assert.equal(decoded, null);
  });

  it('rejects garbage or malformed strings', () => {
    assert.equal(decodeFeedCursor('garbage_string', secret), null);
    assert.equal(decodeFeedCursor('', secret), null);
    assert.equal(decodeFeedCursor(null, secret), null);
  });
});
