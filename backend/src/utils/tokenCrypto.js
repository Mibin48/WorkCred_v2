import crypto from 'node:crypto';
import * as jose from 'jose';

const ACCESS_TOKEN_EXPIRATION = '15m';
export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60; // 900 seconds
export const REFRESH_COOKIE_NAME = 'wc_rt';
export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const REFRESH_MAX_SESSION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days absolute maximum

/**
 * Signs an access token (HS256) containing sub, role, tokenVersion, and sessionId.
 * 
 * @param {object} payload
 * @param {string} payload.userId
 * @param {string} payload.role
 * @param {number} payload.tokenVersion
 * @param {string} payload.sessionId
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function signAccessToken({ userId, role, tokenVersion, sessionId }, secret) {
  const secretKey = new TextEncoder().encode(secret);
  return await new jose.SignJWT({
    role,
    tokenVersion,
    sessionId: sessionId || crypto.randomUUID()
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId.toString())
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRATION)
    .sign(secretKey);
}

/**
 * Verifies an access token and extracts claims.
 * 
 * @param {string} token 
 * @param {string} secret 
 * @returns {Promise<jose.JWTPayload & { sub: string, role: string, tokenVersion: number, sessionId: string }>}
 */
export async function verifyAccessToken(token, secret) {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jose.jwtVerify(token, secretKey, {
    algorithms: ['HS256']
  });
  return payload;
}

/**
 * Generates an opaque cryptographically secure refresh token string.
 * @returns {string} 64-character hex string
 */
export function generateOpaqueRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes a keyed HMAC hash of the refresh token using JWT_REFRESH_SECRET.
 * Only this hash is stored in the database.
 * 
 * @param {string} rawToken 
 * @param {string} secret Key for HMAC (JWT_REFRESH_SECRET)
 * @returns {string} Hex HMAC digest
 */
export function hashRefreshToken(rawToken, secret) {
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

/**
 * Generates a random session family identifier.
 * @returns {string} UUID string
 */
export function generateFamilyId() {
  return crypto.randomUUID();
}

/**
 * Generates cookie options for the wc_rt refresh token cookie.
 * 
 * @param {boolean} isProduction 
 * @returns {import('express').CookieOptions}
 */
export function getRefreshCookieOptions(isProduction = false) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/v1/auth',
    secure: isProduction,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS
  };
}

/**
 * Generates options for clearing the wc_rt cookie (omits maxAge to adhere to express best practices).
 * 
 * @param {boolean} isProduction 
 * @returns {import('express').CookieOptions}
 */
export function getClearCookieOptions(isProduction = false) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/api/v1/auth',
    secure: isProduction
  };
}
