export const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
export const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Validates a person's display name.
 * @param {string} name 
 * @returns {boolean}
 */
export function isValidName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

/**
 * Validates an email address.
 * @param {string} email 
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Validates 10-digit Indian phone number starting with 6, 7, 8, or 9.
 * @param {string} phone 
 * @returns {boolean}
 */
export function isValidIndianPhone(phone) {
  if (typeof phone !== 'string') return false;
  let digits = phone.trim().replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  return INDIAN_PHONE_REGEX.test(digits);
}

/**
 * Validates signup payload shape strictly rejecting unknown fields.
 * @param {object} body 
 * @returns {{ valid: boolean, errors: string[], data?: object }}
 */
export function validateSignupShape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be an object'] };
  }

  const allowedKeys = new Set(['role', 'name', 'email', 'phone', 'password']);
  const errors = [];

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  if (!body.role || !['worker', 'customer'].includes(body.role)) {
    errors.push('Role must be either "worker" or "customer"');
  }

  if (!isValidName(body.name)) {
    errors.push('Name must be between 2 and 100 characters');
  }

  if (!isValidEmail(body.email)) {
    errors.push('Invalid email format');
  }

  if (!isValidIndianPhone(body.phone)) {
    errors.push('Phone must be a valid 10-digit Indian mobile number starting with 6-9');
  }

  if (typeof body.password !== 'string' || body.password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      role: body.role,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim().replace(/\D/g, ''),
      password: body.password
    }
  };
}

/**
 * Validates login payload shape strictly rejecting unknown fields.
 * @param {object} body 
 * @returns {{ valid: boolean, errors: string[], data?: object }}
 */
export function validateLoginShape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be an object'] };
  }

  const allowedKeys = new Set(['email', 'password', 'role']);
  const errors = [];

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  if (!isValidEmail(body.email)) {
    errors.push('Invalid email format');
  }

  if (typeof body.password !== 'string' || body.password.length === 0) {
    errors.push('Password is required');
  }

  if (!body.role || !['worker', 'customer'].includes(body.role)) {
    errors.push('Role must be either "worker" or "customer"');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      email: body.email.trim().toLowerCase(),
      password: body.password,
      role: body.role
    }
  };
}

/**
 * Validates password change shape.
 * @param {object} body 
 * @returns {{ valid: boolean, errors: string[], data?: object }}
 */
export function validatePasswordChangeShape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be an object'] };
  }

  const allowedKeys = new Set(['currentPassword', 'newPassword']);
  const errors = [];

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  if (typeof body.currentPassword !== 'string' || body.currentPassword.length === 0) {
    errors.push('Current password is required');
  }

  if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
    errors.push('New password must be at least 8 characters');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword
    }
  };
}
