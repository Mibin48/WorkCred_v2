/**
 * Valid skills list according to PRD PROF-3.
 */
export const VALID_SKILLS = [
  'helper',
  'electrician',
  'plumber',
  'mason',
  'painter',
  'carpenter',
  'cook',
  'cleaner',
  'driver',
  'vendor',
  'other'
];

/**
 * Valid weekly availability slot options according to PROF-4.
 */
export const WEEKLY_SLOT_OPTIONS = [
  'off',
  'morning',
  'afternoon',
  'evening',
  'full'
];

/**
 * System limits for profile attributes.
 */
export const PROFILE_LIMITS = {
  maxSkills: 6,
  minSkills: 1,
  minRate: 50,
  maxRate: 100000,
  maxBioLength: 200,
  minRadiusKm: 1,
  maxRadiusKm: 10,
  maxBlockedDates: 60,
  maxBlockedReasonLength: 60
};

/**
 * Pure function to evaluate profile completeness (PROF-6).
 * 
 * Worker complete when:
 * - name (valid string)
 * - phone (valid 10-digit Indian phone)
 * - at least one skill with exactly one main
 * - hourlyRate > 0 OR dailyRate > 0
 * - localityKey (valid non-empty string)
 * - radiusKm between 1 and 10
 * Photo and bio are optional.
 * 
 * Customer complete when:
 * - name (valid string)
 * - phone (valid 10-digit Indian phone)
 * - localityKey (valid non-empty string)
 * 
 * @param {object} user 
 * @returns {boolean}
 */
export function isProfileComplete(user) {
  if (!user || typeof user !== 'object') return false;

  const hasName = typeof user.name === 'string' && user.name.trim().length >= 2;
  const hasPhone = typeof user.phone === 'string' && /^[6-9]\d{9}$/.test(user.phone.trim().replace(/\D/g, ''));
  const hasLocality = typeof user.localityKey === 'string' && user.localityKey.trim().length > 0;

  if (user.role === 'customer') {
    return Boolean(hasName && hasPhone && hasLocality);
  }

  if (user.role === 'worker') {
    if (!hasName || !hasPhone || !hasLocality) return false;

    // Skills check: array of 1 to 6 skills with exactly one main
    let hasValidSkills = false;
    if (Array.isArray(user.skills) && user.skills.length >= 1 && user.skills.length <= 6) {
      if (typeof user.mainSkill === 'string' && user.skills.includes(user.mainSkill)) {
        hasValidSkills = true;
      }
    }
    if (!hasValidSkills) return false;

    // Rate check: whole whole rupees > 0, hourlyRate > 0 or dailyRate > 0
    const hasHourly = typeof user.hourlyRate === 'number' && user.hourlyRate > 0;
    const hasDaily = typeof user.dailyRate === 'number' && user.dailyRate > 0;
    if (!hasHourly && !hasDaily) return false;

    // Radius check: integer 1 to 10
    const hasRadius = typeof user.radiusKm === 'number' && user.radiusKm >= 1 && user.radiusKm <= 10;
    if (!hasRadius) return false;

    return true;
  }

  return false;
}
