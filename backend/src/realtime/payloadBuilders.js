/**
 * backend/src/realtime/payloadBuilders.js – Minimal, safe event payload builders.
 *
 * Enforces J1: events are hints, never full data. Payloads carry IDs and
 * small display basics only. Never codes, phone, email, coordinates, notes,
 * comments or cryptographic hashes.
 */

/**
 * Payload for job:new
 * @param {string} jobId
 * @param {string} skill
 * @returns {{ jobId: string, skill: string }}
 */
export function buildJobNewPayload(jobId, skill) {
  return {
    jobId: String(jobId),
    skill: String(skill)
  };
}

/**
 * Payload for job:filled
 * @param {string} jobId
 * @param {'filled' | 'cancelled'} reason
 * @returns {{ jobId: string, reason: string }}
 */
export function buildJobFilledPayload(jobId, reason) {
  return {
    jobId: String(jobId),
    reason: reason === 'cancelled' ? 'cancelled' : 'filled'
  };
}

/**
 * Payload for radar:worker_free
 * @param {string} workerId
 * @returns {{ workerId: string }}
 */
export function buildRadarWorkerFreePayload(workerId) {
  return {
    workerId: String(workerId)
  };
}

/**
 * Payload for radar:worker_busy
 * @param {string} workerId
 * @param {string} reason
 * @returns {{ workerId: string, reason: string }}
 */
export function buildRadarWorkerBusyPayload(workerId, reason) {
  return {
    workerId: String(workerId),
    reason: String(reason)
  };
}

/**
 * Payload for booking:request
 * @param {string} bookingId
 * @returns {{ bookingId: string }}
 */
export function buildBookingRequestPayload(bookingId) {
  return {
    bookingId: String(bookingId)
  };
}

/**
 * Payload for booking:created
 * @param {string} bookingId
 * @returns {{ bookingId: string }}
 */
export function buildBookingCreatedPayload(bookingId) {
  return {
    bookingId: String(bookingId)
  };
}

/**
 * Payload for booking:started
 * @param {string} bookingId
 * @returns {{ bookingId: string }}
 */
export function buildBookingStartedPayload(bookingId) {
  return {
    bookingId: String(bookingId)
  };
}

/**
 * Payload for booking:completed
 * @param {string} bookingId
 * @returns {{ bookingId: string }}
 */
export function buildBookingCompletedPayload(bookingId) {
  return {
    bookingId: String(bookingId)
  };
}

/**
 * Payload for booking:cancelled
 * @param {string} bookingId
 * @param {'customer' | 'worker'} cancelledBy
 * @returns {{ bookingId: string, cancelledBy: string }}
 */
export function buildBookingCancelledPayload(bookingId, cancelledBy) {
  return {
    bookingId: String(bookingId),
    cancelledBy: String(cancelledBy)
  };
}
