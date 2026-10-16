import crypto from 'node:crypto';

/**
 * Generates a 4-digit code as a zero-padded string ('0000' to '9999').
 * @returns {string}
 */
export function generate4DigitCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/**
 * Encrypts a 4-digit code using AES-256-GCM (Decision F3).
 * Additional Authenticated Data = bookingId + ":" + ("start" | "finish")
 * Format: "v1:" + base64url(iv, 12 bytes) + ":" + base64url(authTag, 16 bytes) + ":" + base64url(ciphertext)
 *
 * @param {string} code 4-digit plaintext code
 * @param {string} keyBase64 32-byte key as base64 string
 * @param {string} bookingId MongoDB ObjectId string
 * @param {'start'|'finish'} type Code type
 * @returns {string} Formatted encrypted string
 */
export function encryptCode(code, keyBase64, bookingId, type) {
  if (type !== 'start' && type !== 'finish') {
    throw new Error('Code type must be "start" or "finish"');
  }

  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const aad = Buffer.from(`${bookingId}:${type}`, 'utf8');
  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(String(code), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts a 4-digit code.
 *
 * @param {string} encryptedString "v1:iv:authTag:ciphertext"
 * @param {string} keyBase64 32-byte key as base64 string
 * @param {string} bookingId MongoDB ObjectId string
 * @param {'start'|'finish'} type Code type
 * @returns {string} Plaintext 4-digit code
 */
export function decryptCode(encryptedString, keyBase64, bookingId, type) {
  if (type !== 'start' && type !== 'finish') {
    throw new Error('Code type must be "start" or "finish"');
  }

  const parts = String(encryptedString).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted code format');
  }

  const [, ivB64, tagB64, cipherB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(cipherB64, 'base64url');

  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(`${bookingId}:${type}`, 'utf8');
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Verifies candidate code in constant time against encrypted code.
 *
 * @param {string} candidateCode Plaintext candidate code
 * @param {string} encryptedString Stored encrypted string
 * @param {string} keyBase64 Encryption key
 * @param {string} bookingId Booking ID
 * @param {'start'|'finish'} type Code type
 * @returns {boolean} True if matching, false otherwise
 */
export function verifyCodeConstantTime(candidateCode, encryptedString, keyBase64, bookingId, type) {
  try {
    const decrypted = decryptCode(encryptedString, keyBase64, bookingId, type);
    const candidateBuf = Buffer.from(String(candidateCode).trim(), 'utf8');
    const decryptedBuf = Buffer.from(decrypted, 'utf8');

    if (candidateBuf.length !== decryptedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuf, decryptedBuf);
  } catch {
    return false;
  }
}
