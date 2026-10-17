/**
 * shared/reportRules.js – Pure rules for reporting content and duplicate suppression.
 *
 * Rules:
 * - Targets: 'post', 'worker' (booking is handled by B5's own route; client sending booking gets 400).
 * - Reasons: 'spam', 'inappropriate', 'fake', 'unsafe', 'other'.
 * - Note: optional, max 200 chars NFC trimmed, must pass containsContactInfo.
 * - Duplicate window: 24 hours.
 */

import crypto from 'node:crypto';
import { containsContactInfo } from './containsContactInfo.js';

export const VALID_REPORT_TARGETS = ['post', 'worker'];
export const VALID_REPORT_REASONS = ['spam', 'inappropriate', 'fake', 'unsafe', 'other'];

export const REPORT_LIMITS = {
  maxNoteLength: 200,
  duplicateWindowMs: 24 * 60 * 60 * 1000
};

/**
 * Computes keyed HMAC-SHA256 hash of client IP for privacy-preserving storage.
 *
 * @param {string} ip Client IP address
 * @param {string} secret JWT_REFRESH_SECRET or dedicated key
 * @returns {string} 64-char hex string
 */
export function hashClientIp(ip, secret) {
  const normIp = String(ip || '').trim();
  const salt = secret || 'workcred_ip_default_salt';
  return crypto.createHmac('sha256', salt).update(normIp).digest('hex');
}

/**
 * Validates inputs for POST /reports.
 *
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[], data?: { targetType: string, targetId: string, reason: string, note: string } }}
 */
export function validateReportInput(body) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  // 1. targetType
  const targetType = String(body.targetType || '').trim().toLowerCase();
  if (targetType === 'booking') {
    errors.push("Bookings must be reported through the booking report endpoint '/api/v1/bookings/:id/report'");
  } else if (!VALID_REPORT_TARGETS.includes(targetType)) {
    errors.push(`targetType must be one of: ${VALID_REPORT_TARGETS.join(', ')}`);
  }

  // 2. targetId
  const targetId = String(body.targetId || '').trim();
  if (!targetId) {
    errors.push('targetId is required');
  }

  // 3. reason
  const reason = String(body.reason || '').trim().toLowerCase();
  if (!VALID_REPORT_REASONS.includes(reason)) {
    errors.push(`reason must be one of: ${VALID_REPORT_REASONS.join(', ')}`);
  }

  // 4. note (optional)
  let note = '';
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    if (typeof body.note !== 'string') {
      errors.push('note must be a string');
    } else {
      note = body.note.trim().normalize('NFC').slice(0, REPORT_LIMITS.maxNoteLength);
      if (containsContactInfo(note)) {
        errors.push('note contains prohibited contact information (phone, email, social handle, or link)');
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      targetType,
      targetId,
      reason,
      note
    }
  };
}
