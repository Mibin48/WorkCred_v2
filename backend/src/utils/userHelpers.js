import { AppError } from '../utils/errors.js';

/**
 * Sanitizes a User document into the public /users/me representation.
 * Explicitly excludes passwordHash, failedLoginCount, lockUntil, lockLevel, tokenVersion, and any tokens/hashes.
 * 
 * @param {import('../models/User.js').User} user 
 * @returns {object}
 */
export function sanitizeUserMe(user) {
  if (!user) return null;
  const userObj = user.toObject ? user.toObject() : user;

  return {
    id: userObj._id.toString(),
    role: userObj.role,
    name: userObj.name,
    email: userObj.email,
    phone: userObj.phone,
    photoUrl: userObj.photoUrl || null,
    profileComplete: Boolean(userObj.profileComplete),
    mustChangePassword: Boolean(userObj.mustChangePassword)
  };
}

/**
 * Verifies if an account is currently locked due to failed login attempts.
 * Returns { locked: true, remainingMinutes: number } or { locked: false }.
 * 
 * @param {import('../models/User.js').User} user 
 * @returns {{ locked: boolean, remainingMinutes?: number }}
 */
export function checkAccountLockout(user) {
  if (!user.lockUntil) {
    return { locked: false };
  }

  const now = Date.now();
  const lockTime = new Date(user.lockUntil).getTime();

  if (lockTime > now) {
    const diffMs = lockTime - now;
    const remainingMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
    return { locked: true, remainingMinutes };
  }

  return { locked: false };
}

/**
 * Computes lockout backoff duration based on current lockLevel.
 * Lock schedule: 1st lock -> 10m (level 1), 2nd -> 20m (level 2), 3rd -> 40m (level 3), 4th+ -> 60m (level 4+)
 * 
 * @param {number} currentLockLevel 
 * @returns {{ lockMinutes: number, nextLockLevel: number }}
 */
export function computeLockDuration(currentLockLevel = 0) {
  const nextLockLevel = currentLockLevel + 1;
  let lockMinutes;

  if (nextLockLevel === 1) lockMinutes = 10;
  else if (nextLockLevel === 2) lockMinutes = 20;
  else if (nextLockLevel === 3) lockMinutes = 40;
  else lockMinutes = 60; // Max 60 minutes cap

  return { lockMinutes, nextLockLevel };
}
