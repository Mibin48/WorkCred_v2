const COMMON_PASSWORDS = new Set([
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'letmein123',
  'admin123',
  'welcome123',
  'workcred',
  'workcred123',
  'iloveyou',
  'monkey123',
  'dragon123'
]);

/**
 * Checks if password contains repeated patterns (e.g. "aaaaa", "11111")
 * or simple sequential patterns (e.g. "12345", "abcdef").
 * @param {string} password 
 * @returns {boolean}
 */
function hasRepeatedOrSequential(password) {
  const lower = password.toLowerCase();

  // 4 or more identical consecutive characters
  if (/(.)\1{3,}/.test(lower)) {
    return true;
  }

  // 4 or more sequential characters (ascending or descending)
  for (let i = 0; i <= lower.length - 4; i++) {
    const c1 = lower.charCodeAt(i);
    const c2 = lower.charCodeAt(i + 1);
    const c3 = lower.charCodeAt(i + 2);
    const c4 = lower.charCodeAt(i + 3);

    if (c2 === c1 + 1 && c3 === c2 + 1 && c4 === c3 + 1) return true;
    if (c2 === c1 - 1 && c3 === c2 - 1 && c4 === c3 - 1) return true;
  }

  return false;
}

/**
 * Validates password according to PRD section 6.1 AUTH-3 and Security Spec:
 * - 8 to 64 characters
 * - not a common password
 * - not the phone number
 * - not the user name
 * - not the email local prefix
 * - no repeated or sequential patterns
 *
 * @param {string} password 
 * @param {object} [context] { name, phone, email }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePassword(password, context = {}) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 64) {
    return { valid: false, error: 'Password cannot exceed 64 characters' };
  }

  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    return { valid: false, error: 'Password is too common' };
  }

  if (context.phone) {
    const phoneDigits = String(context.phone).replace(/\D/g, '');
    if (phoneDigits.length >= 6 && lower.includes(phoneDigits.toLowerCase())) {
      return { valid: false, error: 'Password cannot contain your phone number' };
    }
  }

  if (context.name) {
    const nameParts = String(context.name).toLowerCase().split(/\s+/).filter(p => p.length >= 3);
    for (const part of nameParts) {
      if (lower.includes(part)) {
        return { valid: false, error: 'Password cannot contain your name' };
      }
    }
  }

  if (context.email) {
    const emailPrefix = String(context.email).split('@')[0].toLowerCase();
    if (emailPrefix.length >= 3 && lower.includes(emailPrefix)) {
      return { valid: false, error: 'Password cannot contain your email prefix' };
    }
  }

  if (hasRepeatedOrSequential(password)) {
    return { valid: false, error: 'Password cannot contain repeated or sequential patterns' };
  }

  return { valid: true };
}
