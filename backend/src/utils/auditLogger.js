import { logger, maskEmail } from './logger.js';

/**
 * Logs structured security audit events.
 * Only IDs and masked emails are recorded.
 * Passwords, tokens, cookies, codes, and request bodies are NEVER logged.
 * 
 * @param {'signup' | 'login' | 'login_failed' | 'refresh_reuse' | 'password_changed' | 'profile_updated' | 'upload_signed'} eventType 
 * @param {object} meta 
 * @param {string} [meta.userId]
 * @param {string} [meta.email]
 * @param {string} [meta.role]
 * @param {string} [meta.ip]
 * @param {string} [meta.reason]
 * @param {string} [meta.familyId]
 * @param {string[]} [meta.changedFields]
 */
export function logAuditEvent(eventType, meta = {}) {
  const auditPayload = {
    audit: true,
    event: eventType,
    timestamp: new Date().toISOString()
  };

  if (meta.userId) auditPayload.userId = meta.userId.toString();
  if (meta.email) auditPayload.email = maskEmail(meta.email);
  if (meta.role) auditPayload.role = meta.role;
  if (meta.ip) auditPayload.ip = meta.ip;
  if (meta.reason) auditPayload.reason = meta.reason;
  if (meta.familyId) auditPayload.familyId = meta.familyId;
  if (Array.isArray(meta.changedFields)) auditPayload.changedFields = meta.changedFields;

  logger.info(auditPayload, `AUDIT_EVENT: ${eventType}`);
}
