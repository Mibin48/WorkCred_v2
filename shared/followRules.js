/**
 * shared/followRules.js – Pure rules for following and saving workers.
 *
 * Rules:
 * - Allowed types: 'follow', 'save'.
 * - Cannot follow/save self.
 * - Caps: 500 follows, 500 saves per user.
 */

export const VALID_FOLLOW_TYPES = ['follow', 'save'];

/**
 * Validates follow input.
 *
 * @param {object} body
 * @param {string} callerId
 * @returns {{ valid: boolean, errors: string[], data?: { workerId: string, type: 'follow'|'save' } }}
 */
export function validateFollowInput(body, callerId) {
  const errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const workerId = String(body.workerId || '').trim();
  if (!workerId) {
    errors.push('workerId is required');
  } else if (callerId && workerId === callerId.toString()) {
    errors.push('CANNOT_FOLLOW_SELF');
  }

  const type = String(body.type || '').trim().toLowerCase();
  if (!VALID_FOLLOW_TYPES.includes(type)) {
    errors.push(`type must be 'follow' or 'save'`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      workerId,
      type
    }
  };
}
