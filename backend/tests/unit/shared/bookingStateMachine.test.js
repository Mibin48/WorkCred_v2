import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_STATES,
  canTransitionBooking,
  assertLegalBookingTransition
} from '../../../../shared/bookingStateMachine.js';

describe('shared/bookingStateMachine.js', () => {
  it('allows all legal transitions per booking state diagram', () => {
    // pending -> confirmed
    assert.equal(canTransitionBooking(BOOKING_STATES.PENDING, BOOKING_STATES.CONFIRMED), true);
    // pending -> cancelled
    assert.equal(canTransitionBooking(BOOKING_STATES.PENDING, BOOKING_STATES.CANCELLED), true);
    // confirmed -> in_progress
    assert.equal(canTransitionBooking(BOOKING_STATES.CONFIRMED, BOOKING_STATES.IN_PROGRESS), true);
    // confirmed -> cancelled
    assert.equal(canTransitionBooking(BOOKING_STATES.CONFIRMED, BOOKING_STATES.CANCELLED), true);
    // in_progress -> completed
    assert.equal(canTransitionBooking(BOOKING_STATES.IN_PROGRESS, BOOKING_STATES.COMPLETED), true);
  });

  it('rejects illegal transitions', () => {
    // pending cannot jump directly to in_progress or completed
    assert.equal(canTransitionBooking(BOOKING_STATES.PENDING, BOOKING_STATES.IN_PROGRESS), false);
    assert.equal(canTransitionBooking(BOOKING_STATES.PENDING, BOOKING_STATES.COMPLETED), false);

    // in_progress cannot be cancelled
    assert.equal(canTransitionBooking(BOOKING_STATES.IN_PROGRESS, BOOKING_STATES.CANCELLED), false);

    // completed and cancelled are terminal
    assert.equal(canTransitionBooking(BOOKING_STATES.COMPLETED, BOOKING_STATES.PENDING), false);
    assert.equal(canTransitionBooking(BOOKING_STATES.COMPLETED, BOOKING_STATES.CANCELLED), false);
    assert.equal(canTransitionBooking(BOOKING_STATES.CANCELLED, BOOKING_STATES.CONFIRMED), false);
  });

  it('assertLegalBookingTransition throws on illegal transitions', () => {
    assert.doesNotThrow(() => {
      assertLegalBookingTransition(BOOKING_STATES.CONFIRMED, BOOKING_STATES.IN_PROGRESS);
    });

    assert.throws(() => {
      assertLegalBookingTransition(BOOKING_STATES.IN_PROGRESS, BOOKING_STATES.CANCELLED);
    }, /Illegal booking transition/);
  });
});
