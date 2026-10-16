import { isValidName, isValidIndianPhone } from './validators.js';
import { containsContactInfo } from './containsContactInfo.js';
import { VALID_SKILLS, WEEKLY_SLOT_OPTIONS, PROFILE_LIMITS } from './profileRules.js';
import { LOCALITIES, getLocalityByKey } from './localities.js';
import { calculateHaversineDistance } from './geo.js';
import { getIndiaTimeParts } from './calendarRules.js';

export const FORBIDDEN_PROFILE_FIELDS = new Set([
  'email',
  'role',
  'passwordHash',
  'tokenVersion',
  'isActive',
  'profileComplete',
  'passportStats',
  'passportHead',
  'penaltyCounters',
  'failedLoginCount',
  'lockUntil',
  'lockLevel',
  'id',
  '_id',
  'createdAt',
  'updatedAt'
]);

export const WORKER_ONLY_FIELDS = new Set([
  'skills',
  'hourlyRate',
  'dailyRate',
  'bio',
  'radiusKm',
  'calendar'
]);

export const SHARED_ALLOWED_FIELDS = new Set([
  'name',
  'phone',
  'localityKey',
  'location',
  'photoUrl'
]);

/**
 * Validates photoUrl strictly bound to Cloudinary cloudName, NODE_ENV, and caller's userId folder.
 * 
 * @param {string} photoUrl 
 * @param {object} context { cloudName, nodeEnv, userId }
 * @returns {{ valid: boolean, error?: string, sanitizedUrl?: string }}
 */
export function validatePhotoUrl(photoUrl, context = {}) {
  if (photoUrl === '' || photoUrl === null) {
    return { valid: true, sanitizedUrl: null };
  }

  if (typeof photoUrl !== 'string') {
    return { valid: false, error: 'photoUrl must be a string' };
  }

  // Reject query strings or fragments
  if (photoUrl.includes('?') || photoUrl.includes('#')) {
    return { valid: false, error: 'photoUrl must not contain query parameters or fragments' };
  }

  const { cloudName, nodeEnv, userId } = context;
  if (!cloudName || !nodeEnv || !userId) {
    return { valid: false, error: 'Server upload configuration missing' };
  }

  try {
    const url = new URL(photoUrl);
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'photoUrl must use HTTPS' };
    }
    if (url.hostname !== 'res.cloudinary.com') {
      return { valid: false, error: 'photoUrl must be hosted on res.cloudinary.com' };
    }

    // Required pattern: /<cloudName>/image/upload/.../workcred/<nodeEnv>/<userId>/avatar/<filename>
    const expectedPrefix = `/${cloudName}/image/upload/`;
    if (!url.pathname.startsWith(expectedPrefix)) {
      return { valid: false, error: `photoUrl must point to cloud ${cloudName}` };
    }

    const expectedFolder = `workcred/${nodeEnv}/${userId}/avatar/`;
    if (!url.pathname.includes(expectedFolder)) {
      return { valid: false, error: "photoUrl must reside inside your own user's avatar folder" };
    }

    return { valid: true, sanitizedUrl: photoUrl.trim() };
  } catch {
    return { valid: false, error: 'photoUrl is not a valid URL' };
  }
}

/**
 * Finds nearest locality from LOCALITIES within maxKm (default 25km).
 * 
 * @param {number} lat 
 * @param {number} lng 
 * @param {number} maxKm 
 * @returns {object|null}
 */
export function findNearestLocality(lat, lng, maxKm = 25) {
  let nearest = null;
  let minDistanceMeters = Infinity;

  for (const loc of LOCALITIES) {
    const dMeters = calculateHaversineDistance(lat, lng, loc.lat, loc.lng);
    if (dMeters < minDistanceMeters) {
      minDistanceMeters = dMeters;
      nearest = loc;
    }
  }

  if (nearest && minDistanceMeters <= maxKm * 1000) {
    return nearest;
  }
  return null;
}

/**
 * Validates PATCH /users/me payload shape and contents.
 * 
 * @param {object} body 
 * @param {object} user { role, _id }
 * @param {object} context { clock, cloudName, nodeEnv }
 * @returns {{ valid: boolean, errors: string[], data?: object, isCustomerSendingWorkerField?: boolean }}
 */
export function validateProfileUpdateShape(body, user, context = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be an object'] };
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { valid: false, errors: ['At least one field must be provided for update'] };
  }

  const errors = [];
  const sanitized = {};

  // Check forbidden and unknown fields
  let forbiddenFieldName = null;
  for (const key of keys) {
    if (FORBIDDEN_PROFILE_FIELDS.has(key)) {
      errors.push(`Modifying field '${key}' is not permitted`);
      if (!forbiddenFieldName) forbiddenFieldName = key;
      continue;
    }

    if (user.role === 'customer' && WORKER_ONLY_FIELDS.has(key)) {
      return {
        valid: false,
        errors: [`Field '${key}' is only allowed for workers`],
        isCustomerSendingWorkerField: true
      };
    }

    if (!SHARED_ALLOWED_FIELDS.has(key) && !WORKER_ONLY_FIELDS.has(key)) {
      errors.push(`Unknown field: '${key}'`);
      if (!forbiddenFieldName) forbiddenFieldName = key;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, forbiddenFieldName };
  }

  // 1. Name
  if ('name' in body) {
    if (!isValidName(body.name)) {
      errors.push('Name must be between 2 and 100 characters');
    } else {
      sanitized.name = body.name.trim();
    }
  }

  // 2. Phone
  if ('phone' in body) {
    if (!isValidIndianPhone(body.phone)) {
      errors.push('Phone must be a valid 10-digit Indian mobile number starting with 6-9');
    } else {
      sanitized.phone = body.phone.trim().replace(/\D/g, '');
    }
  }

  // 3. Location & LocalityKey
  let locationPoint = undefined;
  if ('location' in body) {
    const loc = body.location;
    if (!loc || typeof loc !== 'object' || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      errors.push('location must be an object with numeric lat and lng properties');
    } else if (loc.lat < 6 || loc.lat > 38 || loc.lng < 68 || loc.lng > 98) {
      errors.push('location coordinates must be within India bounds (lat: 6-38, lng: 68-98)');
    } else {
      locationPoint = {
        type: 'Point',
        coordinates: [loc.lng, loc.lat] // GeoJSON [lng, lat]
      };
      sanitized.location = locationPoint;
    }
  }

  if ('localityKey' in body) {
    if (body.localityKey === null || body.localityKey === '') {
      sanitized.localityKey = null;
    } else if (typeof body.localityKey === 'string') {
      const loc = getLocalityByKey(body.localityKey.trim());
      if (!loc) {
        errors.push(`localityKey '${body.localityKey}' is not in the recognized localities list`);
      } else {
        sanitized.localityKey = loc.key;
      }
    } else {
      errors.push('localityKey must be a string');
    }
  } else if (locationPoint && !('localityKey' in body)) {
    // If location is sent without localityKey, find nearest within 25km
    const [lng, lat] = locationPoint.coordinates;
    const nearest = findNearestLocality(lat, lng, 25);
    if (nearest) {
      sanitized.localityKey = nearest.key;
    } else {
      errors.push('CHOOSE_AREA: No recognized locality within 25 km of your location. Please select an area.');
    }
  }

  // 4. PhotoUrl
  if ('photoUrl' in body) {
    const photoValidation = validatePhotoUrl(body.photoUrl, {
      cloudName: context.cloudName,
      nodeEnv: context.nodeEnv,
      userId: user._id.toString()
    });
    if (!photoValidation.valid) {
      errors.push(photoValidation.error);
    } else {
      sanitized.photoUrl = photoValidation.sanitizedUrl;
    }
  }

  // Worker Only Fields
  if (user.role === 'worker') {
    // Skills
    if ('skills' in body) {
      if (!Array.isArray(body.skills)) {
        errors.push('skills must be an array of objects: [{ skill, isMain }]');
      } else if (body.skills.length < PROFILE_LIMITS.minSkills || body.skills.length > PROFILE_LIMITS.maxSkills) {
        errors.push(`skills must contain between ${PROFILE_LIMITS.minSkills} and ${PROFILE_LIMITS.maxSkills} items`);
      } else {
        const seenSkills = new Set();
        let mainCount = 0;
        let mainSkill = null;
        const skillStrings = [];

        for (const item of body.skills) {
          if (!item || typeof item !== 'object' || typeof item.skill !== 'string') {
            errors.push('Each skill entry must be an object with skill and isMain');
            break;
          }
          const s = item.skill.trim().toLowerCase();
          if (!VALID_SKILLS.includes(s)) {
            errors.push(`Skill '${s}' is not a valid skill choice`);
          }
          if (seenSkills.has(s)) {
            errors.push(`Duplicate skill '${s}' is not allowed`);
          }
          seenSkills.add(s);
          skillStrings.push(s);

          if (item.isMain === true) {
            mainCount++;
            mainSkill = s;
          }
        }

        if (mainCount !== 1) {
          errors.push('Exactly one skill must be designated as main (isMain: true)');
        }

        if (errors.length === 0) {
          sanitized.skills = skillStrings;
          sanitized.mainSkill = mainSkill;
        }
      }
    }

    // Rates
    if ('hourlyRate' in body) {
      if (body.hourlyRate === null || body.hourlyRate === 0) {
        sanitized.hourlyRate = null;
      } else if (typeof body.hourlyRate !== 'number' || !Number.isInteger(body.hourlyRate) || body.hourlyRate < PROFILE_LIMITS.minRate || body.hourlyRate > PROFILE_LIMITS.maxRate) {
        errors.push(`hourlyRate must be a whole integer between ₹${PROFILE_LIMITS.minRate} and ₹${PROFILE_LIMITS.maxRate}`);
      } else {
        sanitized.hourlyRate = body.hourlyRate;
      }
    }

    if ('dailyRate' in body) {
      if (body.dailyRate === null || body.dailyRate === 0) {
        sanitized.dailyRate = null;
      } else if (typeof body.dailyRate !== 'number' || !Number.isInteger(body.dailyRate) || body.dailyRate < PROFILE_LIMITS.minRate || body.dailyRate > PROFILE_LIMITS.maxRate) {
        errors.push(`dailyRate must be a whole integer between ₹${PROFILE_LIMITS.minRate} and ₹${PROFILE_LIMITS.maxRate}`);
      } else {
        sanitized.dailyRate = body.dailyRate;
      }
    }

    // Bio
    if ('bio' in body) {
      if (body.bio === null || body.bio === '') {
        sanitized.bio = '';
      } else if (typeof body.bio !== 'string') {
        errors.push('bio must be a string');
      } else {
        const trimmedBio = body.bio.trim();
        if (trimmedBio.length > PROFILE_LIMITS.maxBioLength) {
          errors.push(`bio cannot exceed ${PROFILE_LIMITS.maxBioLength} characters`);
        } else if (containsContactInfo(trimmedBio)) {
          errors.push('bio cannot contain phone numbers, emails, social handles, or website links');
        } else {
          sanitized.bio = trimmedBio;
        }
      }
    }

    // RadiusKm
    if ('radiusKm' in body) {
      if (typeof body.radiusKm !== 'number' || !Number.isInteger(body.radiusKm) || body.radiusKm < PROFILE_LIMITS.minRadiusKm || body.radiusKm > PROFILE_LIMITS.maxRadiusKm) {
        errors.push(`radiusKm must be an integer between ${PROFILE_LIMITS.minRadiusKm} and ${PROFILE_LIMITS.maxRadiusKm}`);
      } else {
        sanitized.radiusKm = body.radiusKm;
      }
    }

    // Calendar
    if ('calendar' in body) {
      const cal = body.calendar;
      if (!cal || typeof cal !== 'object') {
        errors.push('calendar must be an object with weekly and/or blockedDates');
      } else {
        const sanitizedCal = {};

        // Weekly
        if ('weekly' in cal) {
          if (!cal.weekly || typeof cal.weekly !== 'object' || Array.isArray(cal.weekly)) {
            errors.push('calendar.weekly must be an object with mon, tue, wed, thu, fri, sat, sun keys');
          } else {
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const dayNames = {
              mon: 'Monday',
              tue: 'Tuesday',
              wed: 'Wednesday',
              thu: 'Thursday',
              fri: 'Friday',
              sat: 'Saturday',
              sun: 'Sunday'
            };
            const weeklyEntries = [];
            const weeklyObj = {};

            for (const d of days) {
              const slot = (cal.weekly[d] || 'full').toLowerCase();
              if (!WEEKLY_SLOT_OPTIONS.includes(slot)) {
                errors.push(`Invalid slot '${slot}' for day '${d}'. Allowed: off, morning, afternoon, evening, full`);
              }
              weeklyObj[d] = slot;
              weeklyEntries.push({
                day: dayNames[d],
                slot: slot.charAt(0).toUpperCase() + slot.slice(1) // 'Full day', 'Morning', etc.
              });
            }

            sanitizedCal.weekly = weeklyObj;
          }
        }

        // BlockedDates
        if ('blockedDates' in cal) {
          if (!Array.isArray(cal.blockedDates)) {
            errors.push('calendar.blockedDates must be an array of { date, reason }');
          } else if (cal.blockedDates.length > PROFILE_LIMITS.maxBlockedDates) {
            errors.push(`calendar.blockedDates cannot exceed ${PROFILE_LIMITS.maxBlockedDates} entries`);
          } else {
            const clockInstance = context.clock || { now: () => new Date() };
            const todayParts = getIndiaTimeParts(clockInstance.now());
            const todayStr = todayParts.dateString;
            const maxAheadMs = 365 * 24 * 60 * 60 * 1000;
            const nowMs = clockInstance.now().getTime();

            const seenDates = new Set();
            const validBlocked = [];

            for (const item of cal.blockedDates) {
              if (!item || typeof item !== 'object' || typeof item.date !== 'string') {
                errors.push("Each blockedDates entry must have a 'date' string in YYYY-MM-DD format");
                continue;
              }

              const dateStr = item.date.trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                errors.push(`Invalid date format for '${dateStr}'. Must be YYYY-MM-DD`);
                continue;
              }

              // Must be today or later in India Time
              if (dateStr < todayStr) {
                errors.push(`Blocked date '${dateStr}' is in the past. Dates must be today (${todayStr}) or later`);
                continue;
              }

              // Max 365 days ahead
              const parsedDate = new Date(`${dateStr}T00:00:00.000Z`);
              if (parsedDate.getTime() - nowMs > maxAheadMs) {
                errors.push(`Blocked date '${dateStr}' is more than 365 days in the future`);
                continue;
              }

              if (seenDates.has(dateStr)) {
                errors.push(`Duplicate blocked date '${dateStr}' is not allowed`);
                continue;
              }
              seenDates.add(dateStr);

              let reason = '';
              if ('reason' in item && item.reason !== null && item.reason !== undefined) {
                if (typeof item.reason !== 'string') {
                  errors.push(`Reason for blocked date '${dateStr}' must be a string`);
                } else {
                  reason = item.reason.trim();
                  if (reason.length > PROFILE_LIMITS.maxBlockedReasonLength) {
                    errors.push(`Reason for '${dateStr}' exceeds ${PROFILE_LIMITS.maxBlockedReasonLength} characters`);
                  } else if (containsContactInfo(reason)) {
                    errors.push(`Reason for '${dateStr}' contains prohibited contact information`);
                  }
                }
              }

              validBlocked.push({ date: dateStr, reason });
            }

            // Sort ascending by date
            validBlocked.sort((a, b) => a.date.localeCompare(b.date));
            sanitizedCal.blockedDates = validBlocked;
          }
        }

        sanitized.calendar = sanitizedCal;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data: sanitized };
}
