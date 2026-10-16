export const BOOKING_STATES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const LEGAL_TRANSITIONS = {
  [BOOKING_STATES.PENDING]: [
    BOOKING_STATES.CONFIRMED,
    BOOKING_STATES.CANCELLED
  ],
  [BOOKING_STATES.CONFIRMED]: [
    BOOKING_STATES.IN_PROGRESS,
    BOOKING_STATES.CANCELLED
  ],
  [BOOKING_STATES.IN_PROGRESS]: [
    BOOKING_STATES.COMPLETED
  ],
  [BOOKING_STATES.COMPLETED]: [],
  [BOOKING_STATES.CANCELLED]: []
};

/**
 * Checks whether a booking state transition is legal.
 * @param {string} fromState 
 * @param {string} toState 
 * @returns {boolean}
 */
export function canTransitionBooking(fromState, toState) {
  if (!fromState || !toState) return false;
  const allowed = LEGAL_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Asserts legal transition or throws an error.
 * @param {string} fromState 
 * @param {string} toState 
 */
export function assertLegalBookingTransition(fromState, toState) {
  if (!canTransitionBooking(fromState, toState)) {
    throw new Error(`Illegal booking transition from "${fromState}" to "${toState}"`);
  }
}
