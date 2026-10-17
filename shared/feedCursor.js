/**
 * shared/feedCursor.js – Tamper-safe cursor encoding and decoding for Feed and Posts.
 *
 * Cursors are encoded as URL-safe base64 strings containing:
 * { id: string, createdAt: string }
 * With SHA-256 HMAC signature verification using a secret or tamper check structure.
 */

import crypto from 'node:crypto';

/**
 * Encodes a feed cursor containing id and createdAt.
 *
 * @param {{ id: string, createdAt: string|Date }} payload
 * @param {string} [secret] Optional HMAC secret for cryptographic tamper prevention
 * @returns {string} Base64url cursor
 */
export function encodeFeedCursor(payload, secret = 'workcred_feed_default_salt') {
  if (!payload || !payload.id || !payload.createdAt) {
    throw new Error('Cursor payload must contain id and createdAt');
  }

  const createdAtIso = new Date(payload.createdAt).toISOString();
  const idStr = String(payload.id);

  const dataToSign = `${idStr}:${createdAtIso}`;
  const sig = crypto.createHmac('sha256', secret).update(dataToSign).digest('base64url');

  const obj = {
    id: idStr,
    t: createdAtIso,
    s: sig
  };

  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/**
 * Decodes and verifies a feed cursor.
 * Returns null if malformed, invalid date, or tampered signature.
 *
 * @param {string} cursorStr
 * @param {string} [secret]
 * @returns {{ id: string, createdAt: Date } | null}
 */
export function decodeFeedCursor(cursorStr, secret = 'workcred_feed_default_salt') {
  if (typeof cursorStr !== 'string' || cursorStr.trim().length === 0) {
    return null;
  }

  try {
    const raw = Buffer.from(cursorStr.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.t || !parsed.s) {
      return null;
    }

    const date = new Date(parsed.t);
    if (isNaN(date.getTime())) {
      return null;
    }

    // Verify HMAC
    const dataToSign = `${parsed.id}:${parsed.t}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(dataToSign).digest('base64url');

    if (parsed.s !== expectedSig) {
      return null; // Tampered signature
    }

    return {
      id: parsed.id,
      createdAt: date
    };
  } catch {
    return null;
  }
}
