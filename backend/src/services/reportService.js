/**
 * backend/src/services/reportService.js – Core service for user and post reports.
 *
 * Rules:
 * - Logged-in users only.
 * - Targets: 'post', 'worker' (booking is handled by B5's own route; client sending booking gets 400).
 * - Reasons: 'spam', 'inappropriate', 'fake', 'unsafe', 'other'.
 * - Note: optional, max 200, trimmed, passes containsContactInfo.
 * - Unknown target gets identical 404.
 * - Reporting yourself returns 400 CANNOT_REPORT_SELF.
 * - Stored fields: reporterId, targetType, targetId, reportedUserId, reason, note, ipHash, createdAt.
 * - ipHash: HMAC-SHA256 of client IP using key derived from JWT_REFRESH_SECRET (never raw IP).
 * - Duplicate suppression: same reporter, target, and reason within 24 hours returns the same success
 *   without a second document.
 * - Explicit rule: "post stays visible while under review" (reports never hide anything automatically).
 * - Rate limit: 10 per hour.
 * - Response: "Report received. Support will review it." (no reference number, no target echo).
 */

import mongoose from 'mongoose';
import { Report } from '../models/Report.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import {
  validateReportInput,
  hashClientIp,
  REPORT_LIMITS
} from '../../../shared/reportRules.js';

/**
 * Creates or suppresses a report.
 *
 * @param {object} params
 * @param {object} params.body
 * @param {object} params.reporter Reporter User document
 * @param {string} params.clientIp Client IP address
 * @param {string} params.ipSalt JWT_REFRESH_SECRET or dedicated key
 * @returns {Promise<{ message: string }>}
 */
export async function createReport({ body, reporter, clientIp, ipSalt }) {
  const validation = validateReportInput(body);
  if (!validation.valid) {
    throw new AppError('VALIDATION_ERROR', validation.errors.join('; '), 400, validation.errors);
  }

  const { targetType, targetId, reason, note } = validation.data;

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new AppError('NOT_FOUND', 'Target not found', 404);
  }

  const targetObjectId = new mongoose.Types.ObjectId(targetId);

  // Self-report check: cannot report yourself
  if (targetObjectId.toString() === reporter._id.toString()) {
    throw new AppError('CANNOT_REPORT_SELF', 'You cannot report yourself', 400);
  }

  let reportedUserId = null;

  // Resolve target and author/worker
  if (targetType === 'post') {
    const post = await Post.findById(targetObjectId);
    if (!post) {
      throw new AppError('NOT_FOUND', 'Target not found', 404);
    }
    reportedUserId = post.workerId;
    if (reportedUserId.toString() === reporter._id.toString()) {
      throw new AppError('CANNOT_REPORT_SELF', 'You cannot report your own post', 400);
    }
  } else if (targetType === 'worker') {
    const worker = await User.findOne({ _id: targetObjectId, role: 'worker' });
    if (!worker) {
      throw new AppError('NOT_FOUND', 'Target not found', 404);
    }
    reportedUserId = worker._id;
    if (reportedUserId.toString() === reporter._id.toString()) {
      throw new AppError('CANNOT_REPORT_SELF', 'You cannot report yourself', 400);
    }
  }

  // Duplicate suppression: same reporter, target, reason within 24 hours
  const now = clock.now();
  const duplicateWindowStart = new Date(now.getTime() - REPORT_LIMITS.duplicateWindowMs);

  const existingReport = await Report.findOne({
    reporterId: reporter._id,
    targetType,
    targetId: targetObjectId,
    reason,
    createdAt: { $gte: duplicateWindowStart }
  });

  if (existingReport) {
    logAuditEvent('report_duplicate_suppressed', {
      userId: reporter._id,
      targetType,
      targetId: targetObjectId,
      reason
    });
    return { message: 'Report received. Support will review it.' };
  }

  const ipHash = hashClientIp(clientIp, ipSalt);

  await Report.create({
    targetType,
    targetId: targetObjectId,
    reportedUserId,
    reporterId: reporter._id,
    reason,
    note,
    ipHash
  });

  logAuditEvent('report_created', {
    userId: reporter._id,
    targetType,
    targetId: targetObjectId,
    reason
  });

  return { message: 'Report received. Support will review it.' };
}
