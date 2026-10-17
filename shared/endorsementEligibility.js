/**
 * shared/endorsementEligibility.js – Pure rules for customer endorsement eligibility.
 *
 * Rules:
 * - Customers only (role must be customer).
 * - Caller must have at least one completed booking with that worker whose skill equals the endorsed skill.
 * - One endorsement per customer, worker, and skill (ALREADY_ENDORSED).
 */

import { VALID_SKILLS } from './profileRules.js';

/**
 * Checks whether a customer is eligible to endorse a worker for a specific skill
 * based on their list of completed bookings and existing endorsements.
 *
 * @param {object} params
 * @param {string} params.callerRole 'customer' | 'worker'
 * @param {string} params.callerId
 * @param {string} params.workerId
 * @param {string} params.skill
 * @param {Array<{ customerId: any, workerId: any, skill: string, status: string }>} params.bookings
 * @param {Array<{ customerId: any, workerId: any, skill: string }>} params.existingEndorsements
 * @returns {{ eligible: boolean, reason?: 'ROLE_FORBIDDEN' | 'INVALID_SKILL' | 'NOT_ELIGIBLE' | 'ALREADY_ENDORSED' }}
 */
export function checkEndorsementEligibility({
  callerRole,
  callerId,
  workerId,
  skill,
  bookings = [],
  existingEndorsements = []
}) {
  if (callerRole !== 'customer') {
    return { eligible: false, reason: 'ROLE_FORBIDDEN' };
  }

  const normalizedSkill = String(skill || '').trim().toLowerCase();
  if (!VALID_SKILLS.includes(normalizedSkill)) {
    return { eligible: false, reason: 'INVALID_SKILL' };
  }

  const cId = callerId ? callerId.toString() : '';
  const wId = workerId ? workerId.toString() : '';

  // Check if already endorsed
  const already = existingEndorsements.some((e) => {
    const endorsementCustId = (e.customerId?._id || e.customerId)?.toString();
    const endorsementWorkerId = (e.workerId?._id || e.workerId)?.toString();
    return (
      endorsementCustId === cId &&
      endorsementWorkerId === wId &&
      e.skill === normalizedSkill
    );
  });

  if (already) {
    return { eligible: false, reason: 'ALREADY_ENDORSED' };
  }

  // Must have at least one completed booking with that worker for that skill
  const hasCompletedJob = bookings.some((b) => {
    const bCustId = (b.customerId?._id || b.customerId)?.toString();
    const bWorkerId = (b.workerId?._id || b.workerId)?.toString();
    return (
      bCustId === cId &&
      bWorkerId === wId &&
      b.skill === normalizedSkill &&
      b.status === 'completed'
    );
  });

  if (!hasCompletedJob) {
    return { eligible: false, reason: 'NOT_ELIGIBLE' };
  }

  return { eligible: true };
}

/**
 * Computes all skills that a customer is eligible to endorse for a given worker,
 * excluding skills already endorsed.
 *
 * @param {string} customerId
 * @param {string} workerId
 * @param {Array<{ customerId: any, workerId: any, skill: string, status: string }>} completedBookings
 * @param {Array<{ customerId: any, workerId: any, skill: string }>} existingEndorsements
 * @returns {string[]} List of eligible skills
 */
export function getCanEndorseSkills(
  customerId,
  workerId,
  completedBookings = [],
  existingEndorsements = []
) {
  const cId = customerId ? customerId.toString() : '';
  const wId = workerId ? workerId.toString() : '';

  const completedSkills = new Set();
  for (const b of completedBookings) {
    const bCustId = (b.customerId?._id || b.customerId)?.toString();
    const bWorkerId = (b.workerId?._id || b.workerId)?.toString();
    if (bCustId === cId && bWorkerId === wId && b.status === 'completed' && b.skill) {
      completedSkills.add(b.skill);
    }
  }

  const alreadyEndorsedSkills = new Set();
  for (const e of existingEndorsements) {
    const eCustId = (e.customerId?._id || e.customerId)?.toString();
    const eWorkerId = (e.workerId?._id || e.workerId)?.toString();
    if (eCustId === cId && eWorkerId === wId && e.skill) {
      alreadyEndorsedSkills.add(e.skill);
    }
  }

  const eligible = [];
  for (const skill of completedSkills) {
    if (!alreadyEndorsedSkills.has(skill)) {
      eligible.push(skill);
    }
  }

  return eligible.sort();
}
