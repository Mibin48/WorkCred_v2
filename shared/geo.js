const EARTH_RADIUS_METERS = 6371000;

/**
 * Converts degrees to radians.
 * @param {number} deg 
 * @returns {number}
 */
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Calculates haversine distance between two coordinates in meters.
 * @param {number} lat1 
 * @param {number} lng1 
 * @param {number} lat2 
 * @param {number} lng2 
 * @returns {number} Distance in meters
 */
export function calculateHaversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Formats a distance into human-readable approximate distance.
 * E.g., 400m -> "under 500 m", 1200m -> "about 1 km", 2400m -> "about 2 km"
 * @param {number} meters 
 * @returns {string}
 */
export function formatApproximateDistance(meters) {
  if (typeof meters !== 'number' || meters < 0) return 'nearby';
  if (meters < 500) {
    return 'under 500 m';
  }
  const km = Math.round(meters / 1000);
  if (km <= 1) {
    return 'about 1 km';
  }
  return `about ${km} km`;
}

/**
 * Validates coordinate pair.
 * @param {number} lat 
 * @param {number} lng 
 * @returns {boolean}
 */
export function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
