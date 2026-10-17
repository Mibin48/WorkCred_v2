/**
 * backend/tests/unit/shared/endorsementEligibility.test.js
 *
 * Tests:
 * - Customers only (workers get ROLE_FORBIDDEN).
 * - Completed booking for the specific skill required (NOT_ELIGIBLE).
 * - Already endorsed prevented (ALREADY_ENDORSED).
 * - canEndorse computation returns eligible skills minus already endorsed ones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkEndorsementEligibility,
  getCanEndorseSkills
} from '../../../../shared/endorsementEligibility.js';

describe('shared/endorsementEligibility.js Unit Tests', () => {
  const custId = 'cust123';
  const workerId = 'work456';

  it('rejects endorsement if caller is a worker', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'worker',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: [{ customerId: custId, workerId, skill: 'electrician', status: 'completed' }]
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'ROLE_FORBIDDEN');
  });

  it('rejects endorsement if customer has no completed booking with worker', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'customer',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: []
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'NOT_ELIGIBLE');
  });

  it('rejects endorsement if booking with worker is for a different skill', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'customer',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: [{ customerId: custId, workerId, skill: 'plumber', status: 'completed' }]
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'NOT_ELIGIBLE');
  });

  it('rejects endorsement if booking status is not completed (e.g. in_progress or confirmed)', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'customer',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: [{ customerId: custId, workerId, skill: 'electrician', status: 'in_progress' }]
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'NOT_ELIGIBLE');
  });

  it('rejects endorsement if customer already endorsed worker for that skill', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'customer',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: [{ customerId: custId, workerId, skill: 'electrician', status: 'completed' }],
      existingEndorsements: [{ customerId: custId, workerId, skill: 'electrician' }]
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'ALREADY_ENDORSED');
  });

  it('allows endorsement when caller has completed booking for that skill and has not yet endorsed', () => {
    const res = checkEndorsementEligibility({
      callerRole: 'customer',
      callerId: custId,
      workerId,
      skill: 'electrician',
      bookings: [{ customerId: custId, workerId, skill: 'electrician', status: 'completed' }],
      existingEndorsements: []
    });
    assert.equal(res.eligible, true);
  });

  it('getCanEndorseSkills returns completed job skills excluding already endorsed ones', () => {
    const bookings = [
      { customerId: custId, workerId, skill: 'electrician', status: 'completed' },
      { customerId: custId, workerId, skill: 'plumber', status: 'completed' },
      { customerId: custId, workerId, skill: 'carpenter', status: 'cancelled' }
    ];
    const existing = [
      { customerId: custId, workerId, skill: 'electrician' }
    ];

    const canEndorse = getCanEndorseSkills(custId, workerId, bookings, existing);
    assert.deepEqual(canEndorse, ['plumber']);
  });
});
