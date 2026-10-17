/**
 * backend/src/realtime/recipientFilter.js – Pure recipient filtering.
 *
 * Implements J6: Rooms are a coarse first pass; exact filtering checks
 * role, skill, and exact Haversine distance against per-socket cached data.
 */

import { calculateHaversineDistance } from '../../../shared/geo.js';

/**
 * Filters worker sockets for a new job or filled job.
 * Worker must:
 *   - have role === 'worker'
 *   - have skill in cached skills array
 *   - have worker.origin and jobOrigin
 *   - have distance(jobOrigin, workerOrigin) <= worker.radiusKm (in meters)
 *
 * @param {Array<object>} sockets Array of socket objects containing .cachedData
 * @param {string} skill Required skill name
 * @param {{ lng: number, lat: number }} jobOrigin Centroid of job locality
 * @returns {Array<object>} Array of matching sockets
 */
export function filterWorkersForJob(sockets, skill, jobOrigin) {
  if (!Array.isArray(sockets) || !skill || !jobOrigin) return [];
  const reqSkill = String(skill).toLowerCase();

  return sockets.filter((sock) => {
    const data = sock.cachedData;
    if (!data || data.role !== 'worker') return false;

    // Check skill
    const skills = Array.isArray(data.skills) ? data.skills.map((s) => String(s).toLowerCase()) : [];
    if (!skills.includes(reqSkill)) return false;

    // Check distance
    if (!data.origin || typeof data.origin.lng !== 'number' || typeof data.origin.lat !== 'number') {
      return false;
    }

    const maxDistMeters = (Number(data.radiusKm) || 5) * 1000;
    const distMeters = calculateHaversineDistance(
      jobOrigin.lat,
      jobOrigin.lng,
      data.origin.lat,
      data.origin.lng
    );

    return distMeters <= maxDistMeters;
  });
}

/**
 * Filters customer sockets for radar:worker_free or radar:worker_busy.
 * Customer must:
 *   - have role === 'customer'
 *   - have customer.origin and workerOrigin
 *   - have distance(workerOrigin, customerOrigin) <= maxRadiusMeters (default 5000 = 5 km)
 *
 * @param {Array<object>} sockets Array of socket objects containing .cachedData
 * @param {{ lng: number, lat: number }} workerOrigin Centroid of worker locality
 * @param {number} [maxRadiusMeters=5000]
 * @returns {Array<object>} Array of matching sockets
 */
export function filterCustomersForRadar(sockets, workerOrigin, maxRadiusMeters = 5000) {
  if (!Array.isArray(sockets) || !workerOrigin) return [];

  return sockets.filter((sock) => {
    const data = sock.cachedData;
    if (!data || data.role !== 'customer') return false;

    if (!data.origin || typeof data.origin.lng !== 'number' || typeof data.origin.lat !== 'number') {
      return false;
    }

    const distMeters = calculateHaversineDistance(
      workerOrigin.lat,
      workerOrigin.lng,
      data.origin.lat,
      data.origin.lng
    );

    return distMeters <= maxRadiusMeters;
  });
}
