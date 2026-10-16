import { containsContactInfo } from './containsContactInfo.js';
import { VALID_SKILLS } from './profileRules.js';
import { getLocalityByKey } from './localities.js';
import { isSlotAvailable } from './calendarRules.js';

/**
 * Checks whether two time intervals overlap.
 * Touching ends (aEnd === bStart or bEnd === aStart) do NOT overlap.
 * 
 * @param {Date|number} aStart 
 * @param {number} aHours 
 * @param {Date|number} bStart 
 * @param {number} bHours 
 * @returns {boolean}
 */
export function intervalsOverlap(aStart, aHours, bStart, bHours) {
  const startA = new Date(aStart).getTime();
  const endA = startA + Math.round(aHours * 60 * 60 * 1000);
  const startB = new Date(bStart).getTime();
  const endB = startB + Math.round(bHours * 60 * 60 * 1000);

  return startA < endB && startB < endA;
}

/**
 * Generates discrete hour boundary Date objects starting from startAt for duration hours.
 * E.g., start at 10:30 for 2 hours -> checks [10:30, 11:30].
 * E.g., start at 10:00 for 3 hours -> checks [10:00, 11:00, 12:00].
 * 
 * @param {Date|string} startAt 
 * @param {number} hours 
 * @returns {Date[]}
 */
export function hourBoundaries(startAt, hours) {
  const boundaries = [];
  const startMs = new Date(startAt).getTime();
  const stepMs = 60 * 60 * 1000;
  const totalMs = hours * stepMs;

  for (let offset = 0; offset <= totalMs; offset += stepMs) {
    boundaries.push(new Date(startMs + offset));
  }

  // If hours is fractional (e.g. 1.5, 2.5), ensure end boundary is present
  const endBoundary = new Date(startMs + totalMs);
  if (boundaries[boundaries.length - 1].getTime() !== endBoundary.getTime()) {
    boundaries.push(endBoundary);
  }

  return boundaries;
}

/**
 * Checks if a worker's calendar is available for EVERY hour boundary from startAt until startAt + hours.
 * Uses isSlotAvailable from calendarRules.js.
 * Note: An interval [startAt, endAt) ends at endAt, so the instant checked at the end is endAt - 1ms.
 * 
 * @param {object} calendar 
 * @param {Date|string} startAt 
 * @param {number} hours 
 * @returns {boolean}
 */
export function isWindowAvailable(calendar, startAt, hours) {
  if (!calendar) return true; // If no calendar pattern set, defaults to available
  const boundaries = hourBoundaries(startAt, hours);
  for (let i = 0; i < boundaries.length; i++) {
    let checkPoint = boundaries[i];
    // If it's the right-hand boundary of the window, test inside the interval (1ms before)
    if (i === boundaries.length - 1) {
      checkPoint = new Date(checkPoint.getTime() - 1);
    }
    if (!isSlotAvailable(calendar, checkPoint)) {
      return false;
    }
  }
  return true;
}

/**
 * Formats distance in meters to approximate distance:
 * - Nearest 0.5 km (500 m)
 * - Minimum "under 1 km" when distance < 1000 meters (returns km: 1)
 * 
 * @param {number} meters 
 * @returns {{ km: number, label: string }}
 */
export function formatApproxDistance(meters) {
  if (typeof meters !== 'number' || meters < 0 || Number.isNaN(meters)) {
    return { km: 0, label: 'nearby' };
  }
  const kmExact = meters / 1000;
  if (kmExact < 1) {
    return { km: 1, label: 'under 1 km' };
  }
  // Round to nearest 0.5 km
  const roundedKm = Math.round(kmExact * 2) / 2;
  return { km: roundedKm, label: `about ${roundedKm.toFixed(1)} km` };
}

/**
 * Validates job creation input.
 * - skill: from VALID_SKILLS
 * - workersNeeded: integer 1 to 10
 * - hours: number 1 to 12 (whole or half hours: h * 2 must be integer)
 * - startAt: at least 15m ahead, at most 30d ahead
 * - offeredRate: whole rupees per hour 50 to 100000
 * - description: string max 300 trimmed, must pass containsContactInfo
 * - location: optional { lat, lng } within India bounds
 * - localityKey: optional, must exist if provided
 * 
 * @param {object} body 
 * @param {object} context { clock }
 * @returns {{ valid: boolean, errors: string[], data?: object }}
 */
export function validateJobInput(body, context = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const allowedKeys = new Set([
    'skill',
    'workersNeeded',
    'hours',
    'startAt',
    'offeredRate',
    'description',
    'localityKey',
    'location'
  ]);

  for (const k of Object.keys(body)) {
    if (!allowedKeys.has(k)) {
      errors.push(`Unknown field '${k}'`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 1. Skill
  const skill = typeof body.skill === 'string' ? body.skill.trim().toLowerCase() : '';
  if (!VALID_SKILLS.includes(skill)) {
    errors.push(`skill '${body.skill}' is not a recognized skill`);
  }

  // 2. workersNeeded
  const workersNeeded = body.workersNeeded;
  if (typeof workersNeeded !== 'number' || !Number.isInteger(workersNeeded) || workersNeeded < 1 || workersNeeded > 10) {
    errors.push('workersNeeded must be an integer between 1 and 10');
  }

  // 3. hours
  const hours = body.hours;
  if (typeof hours !== 'number' || hours < 1 || hours > 12 || (hours * 2) % 1 !== 0) {
    errors.push('hours must be a number between 1 and 12 in whole or half hours (e.g. 1, 1.5, 2)');
  }

  // 4. startAt
  const clock = context.clock || { now: () => new Date() };
  const nowMs = clock.now().getTime();
  let startAtDate = null;
  if (!body.startAt || typeof body.startAt !== 'string') {
    errors.push('startAt is required and must be an ISO date string');
  } else {
    startAtDate = new Date(body.startAt);
    if (Number.isNaN(startAtDate.getTime())) {
      errors.push('startAt must be a valid ISO date string');
    } else {
      const diffMs = startAtDate.getTime() - nowMs;
      const minAheadMs = 15 * 60 * 1000; // 15 minutes
      const maxAheadMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (diffMs < minAheadMs) {
        errors.push('startAt must be at least 15 minutes in the future');
      } else if (diffMs > maxAheadMs) {
        errors.push('startAt cannot be more than 30 days in the future');
      }
    }
  }

  // 5. offeredRate
  const offeredRate = body.offeredRate;
  if (typeof offeredRate !== 'number' || !Number.isInteger(offeredRate) || offeredRate < 50 || offeredRate > 100000) {
    errors.push('offeredRate must be a whole integer between ₹50 and ₹100,000 per hour');
  }

  // 6. description
  let description = '';
  if (typeof body.description !== 'string' || body.description.trim().length === 0) {
    errors.push('description is required');
  } else {
    description = body.description.trim();
    if (description.length > 300) {
      errors.push('description cannot exceed 300 characters');
    } else if (containsContactInfo(description)) {
      errors.push('description contains prohibited contact information (phone, email, social handle, or link)');
    }
  }

  // 7. localityKey
  let localityKey = null;
  if ('localityKey' in body && body.localityKey !== null && body.localityKey !== undefined) {
    if (typeof body.localityKey !== 'string') {
      errors.push('localityKey must be a string');
    } else {
      const loc = getLocalityByKey(body.localityKey.trim());
      if (!loc) {
        errors.push(`localityKey '${body.localityKey}' is not a recognized locality`);
      } else {
        localityKey = loc.key;
      }
    }
  } else if (context.userLocalityKey) {
    localityKey = context.userLocalityKey;
  }

  // 8. location
  let locationPoint = null;
  if ('location' in body && body.location !== null && body.location !== undefined) {
    const loc = body.location;
    if (typeof loc !== 'object' || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      errors.push('location must be an object with numeric lat and lng properties');
    } else if (loc.lat < 6 || loc.lat > 38 || loc.lng < 68 || loc.lng > 98) {
      errors.push('location coordinates must be within India bounds (lat: 6-38, lng: 68-98)');
    } else {
      locationPoint = {
        type: 'Point',
        coordinates: [loc.lng, loc.lat]
      };
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      skill,
      workersNeeded,
      hours,
      startAt: startAtDate,
      offeredRate,
      description,
      localityKey,
      location: locationPoint
    }
  };
}

/**
 * Encodes sort cursor to URL-safe base64 string.
 * @param {object} payload 
 * @returns {string}
 */
export function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes URL-safe base64 cursor string.
 * Returns null if malformed or tampered.
 * @param {string} cursorStr 
 * @returns {object|null}
 */
export function decodeCursor(cursorStr) {
  if (typeof cursorStr !== 'string' || cursorStr.trim().length === 0) {
    return null;
  }
  try {
    const jsonStr = Buffer.from(cursorStr.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || !parsed.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

