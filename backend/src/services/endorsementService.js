/**
 * backend/src/services/endorsementService.js – Core service for customer endorsements.
 *
 * Rules:
 * - Customers only (workers get 403).
 * - Target worker must exist (404 if not found).
 * - Skill must be valid (400 if invalid).
 * - Caller must have at least one completed booking with that worker for that skill (403 NOT_ELIGIBLE).
 * - Already endorsed gives 409 ALREADY_ENDORSED.
 * - Endorsement counts per skill kept on worker document as endorsementCounts (Map) and updated
 *   in the SAME database transaction as the endorsement insert.
 * - Parallel duplicates give exactly one endorsement and one count increment (transaction + unique index).
 * - Rate limit: 30 per hour.
 * - Response: { workerId, skill, count } (the new total for that skill).
 */

import mongoose from 'mongoose';
import { Endorsement } from '../models/Endorsement.js';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { VALID_SKILLS } from '../../../shared/profileRules.js';

/**
 * Endorses a worker's skill.
 *
 * @param {object} params
 * @param {string} params.workerId
 * @param {string} params.skill
 * @param {object} params.customer Customer User document
 * @returns {Promise<{ workerId: string, skill: string, count: number }>}
 */
export async function createEndorsement({ workerId, skill, customer }) {
  if (customer.role !== 'customer') {
    throw new AppError('FORBIDDEN_ROLE', 'Only customers can endorse workers', 403);
  }

  if (!workerId || !mongoose.Types.ObjectId.isValid(workerId)) {
    throw new AppError('NOT_FOUND', 'Worker not found', 404);
  }

  const normalizedSkill = String(skill || '').trim().toLowerCase();
  if (!VALID_SKILLS.includes(normalizedSkill)) {
    throw new AppError('VALIDATION_ERROR', `Skill '${skill}' is not a recognized skill`, 400);
  }

  const worker = await User.findOne({
    _id: workerId,
    role: 'worker'
  });

  if (!worker) {
    throw new AppError('NOT_FOUND', 'Worker not found', 404);
  }

  // Check completed booking requirement
  const completedBooking = await Booking.findOne({
    customerId: customer._id,
    workerId: worker._id,
    skill: normalizedSkill,
    status: 'completed'
  });

  if (!completedBooking) {
    throw new AppError('NOT_ELIGIBLE', 'You can only endorse a worker for a skill after completing a job with them for that skill', 403);
  }

  // Check if already endorsed
  const existingEndorsement = await Endorsement.findOne({
    customerId: customer._id,
    workerId: worker._id,
    skill: normalizedSkill
  });

  if (existingEndorsement) {
    throw new AppError('ALREADY_ENDORSED', 'You have already endorsed this worker for this skill', 409);
  }

  // Atomic transaction: Insert Endorsement and increment endorsementCounts in the SAME transaction
  const session = await mongoose.startSession();
  let updatedCount = 0;

  try {
    await session.withTransaction(async () => {
      // Re-verify inside transaction to prevent parallel race conditions
      const raceExisting = await Endorsement.findOne({
        customerId: customer._id,
        workerId: worker._id,
        skill: normalizedSkill
      }).session(session);

      if (raceExisting) {
        throw new AppError('ALREADY_ENDORSED', 'You have already endorsed this worker for this skill', 409);
      }

      await Endorsement.create(
        [
          {
            customerId: customer._id,
            workerId: worker._id,
            skill: normalizedSkill
          }
        ],
        { session }
      );

      // Increment count on worker document
      const fieldPath = `endorsementCounts.${normalizedSkill}`;
      const updatedWorker = await User.findOneAndUpdate(
        { _id: worker._id },
        { $inc: { [fieldPath]: 1 } },
        { new: true, session }
      );

      const counts = updatedWorker.endorsementCounts instanceof Map
        ? Object.fromEntries(updatedWorker.endorsementCounts)
        : (updatedWorker.endorsementCounts || {});

      updatedCount = counts[normalizedSkill] || 1;
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError('ALREADY_ENDORSED', 'You have already endorsed this worker for this skill', 409);
    }
    throw err;
  } finally {
    session.endSession();
  }

  logAuditEvent('endorsed', {
    userId: customer._id,
    targetWorkerId: worker._id,
    skill: normalizedSkill,
    newCount: updatedCount
  });

  return {
    workerId: worker._id.toString(),
    skill: normalizedSkill,
    count: updatedCount
  };
}
