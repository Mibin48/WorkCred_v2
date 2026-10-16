import { getLocalityByKey } from '../../../shared/localities.js';

/**
 * Sanitizes a User document into the authenticated /users/me representation.
 * Explicitly excludes passwordHash, failedLoginCount, lockUntil, lockLevel, tokenVersion,
 * and exact coordinates (lat, lng, coordinates, location).
 * 
 * @param {import('../models/User.js').User} user 
 * @returns {object}
 */
export function sanitizeUserMe(user) {
  if (!user) return null;
  const userObj = user.toObject ? user.toObject() : user;

  const hasExactLoc = Boolean(
    userObj.location &&
    Array.isArray(userObj.location.coordinates) &&
    (userObj.location.coordinates[0] !== 0 || userObj.location.coordinates[1] !== 0)
  );

  const locDoc = userObj.localityKey ? getLocalityByKey(userObj.localityKey) : null;

  const base = {
    id: userObj._id.toString(),
    role: userObj.role,
    name: userObj.name,
    email: userObj.email,
    phone: userObj.phone,
    photoUrl: userObj.photoUrl || null,
    localityKey: userObj.localityKey || null,
    localityName: locDoc ? locDoc.name : null,
    hasExactLocation: hasExactLoc,
    profileComplete: Boolean(userObj.profileComplete),
    mustChangePassword: Boolean(userObj.mustChangePassword)
  };

  if (userObj.role === 'worker') {
    // Reconstruct skills array of [{ skill, isMain }]
    const skillsList = Array.isArray(userObj.skills) ? userObj.skills : [];
    const formattedSkills = skillsList.map((s) => ({
      skill: s,
      isMain: s === userObj.mainSkill
    }));

    base.skills = formattedSkills;
    base.mainSkill = userObj.mainSkill || null;
    base.hourlyRate = userObj.hourlyRate || 0;
    base.dailyRate = userObj.dailyRate || 0;
    base.bio = userObj.bio || '';
    base.radiusKm = userObj.radiusKm ?? null;
    base.calendar = {
      weekly: userObj.calendar?.weekly || {
        mon: 'full',
        tue: 'full',
        wed: 'full',
        thu: 'full',
        fri: 'full',
        sat: 'full',
        sun: 'full'
      },
      blockedDates: Array.isArray(userObj.calendar?.blockedDates)
        ? userObj.calendar.blockedDates.map((b) => ({
            date: b.date || b,
            reason: b.reason || ''
          }))
        : []
    };
    base.passportStats = userObj.passportStats || {
      jobs: 0,
      avgRating: 0,
      totalHours: 0,
      topSkills: []
    };
  }

  return base;
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
