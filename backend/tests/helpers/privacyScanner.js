/**
 * Privacy Scanner test helper.
 * Recursively scans any object or array to ensure no forbidden security keys appear.
 * Forbidden: passwordHash, password, tokenVersion, lockUntil, lockLevel, failedLoginCount,
 * tokenHash, replacedByHash, raw tokens or unhashed secrets.
 * 
 * @param {any} target 
 * @param {string[]} [forbiddenKeys]
 * @throws {Error} if any forbidden key is detected
 */
export function assertNoSensitiveFields(target, optionsOrForbidden = {}) {
  let forbiddenKeys;
  let allowPhoneAndEmail = false;
  let allowPhone = false;
  let allowJobLocation = false;
  let allowEmployerName = false;
  let isPassportResponse = false;
  let allowDemoPassword = false;

  if (Array.isArray(optionsOrForbidden)) {
    forbiddenKeys = optionsOrForbidden;
  } else {
    allowPhoneAndEmail = Boolean(optionsOrForbidden.allowPhoneAndEmail);
    allowPhone = Boolean(optionsOrForbidden.allowPhone) || allowPhoneAndEmail;
    allowJobLocation = Boolean(optionsOrForbidden.allowJobLocation);
    allowEmployerName = Boolean(optionsOrForbidden.allowEmployerName);
    isPassportResponse = Boolean(optionsOrForbidden.isPassportResponse);
    allowDemoPassword = Boolean(optionsOrForbidden.allowDemoPassword);

    forbiddenKeys = [
      'passwordHash',
      'token',
      'tokenVersion',
      'lockUntil',
      'lockLevel',
      'failedLoginCount',
      'tokenHash',
      'replacedByHash',
      'startCodeEnc',
      'finishCodeEnc',
      'passportHead',
      'penaltyCounters',
      'startCodeLockUntil',
      'finishCodeLockUntil',
      'startCodeAttempts',
      'finishCodeAttempts',
      'bookingGuard',
      'cancelledConfirmedAt',
      'prevHash',
      'hash',
      'ipHash',
      'reportedUserId',
      'reporterId'
    ];

    if (!allowDemoPassword) {
      forbiddenKeys.push('password');
    }

    if (!allowJobLocation) {
      forbiddenKeys.push(
        'location',
        'coordinates',
        'lat',
        'lng',
        'latitude',
        'longitude',
        'searchLocation',
        'locationSnapshot',
        'startedGeo'
      );
    }

    if (!allowEmployerName) {
      forbiddenKeys.push('employerName');
    }

    // Phase B7 & Passport: bookingId is strictly forbidden in feed, post, follow, and passport responses
    // It is allowed on direct booking responses unless forbidden or passport response
    const allowBookingId = optionsOrForbidden.allowBookingId !== undefined ? Boolean(optionsOrForbidden.allowBookingId) : undefined;
    const forbidBookingId = Boolean(optionsOrForbidden.forbidBookingId);
    if (isPassportResponse || forbidBookingId) {
      forbiddenKeys.push('bookingId');
    }

    if (!allowPhone) {
      forbiddenKeys.push('phone');
    }

    if (!allowPhoneAndEmail) {
      forbiddenKeys.push('email');
    }
  }

  const violations = [];

  function scan(val, path = '') {
    if (!val || typeof val !== 'object') return;

    if (Array.isArray(val)) {
      val.forEach((item, idx) => scan(item, `${path}[${idx}]`));
      return;
    }

    for (const [key, value] of Object.entries(val)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Special allowance: jobLocation may contain lat and lng if allowJobLocation is true
      if (allowJobLocation && (key === 'lat' || key === 'lng') && path.endsWith('jobLocation')) {
        // permitted
      } else if (forbiddenKeys.includes(key)) {
        violations.push(`Forbidden field "${key}" detected at path "${currentPath}"`);
      }

      if (typeof value === 'object' && value !== null) {
        scan(value, currentPath);
      }
    }
  }

  scan(target);

  if (violations.length > 0) {
    throw new Error(`Privacy scan failed! Sensitive data leaked:\n${violations.join('\n')}`);
  }
}

/**
 * Asserts that NO response contains the actual 4-digit startCode or finishCode
 * (used everywhere outside of GET /bookings/:id/codes).
 */
export function assertNoRealBookingCodes(payload, startCode, finishCode) {
  if (!startCode && !finishCode) return;
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (startCode && payloadStr.includes(String(startCode))) {
    throw new Error(`Privacy scan failed! startCode "${startCode}" leaked in payload`);
  }
  if (finishCode && payloadStr.includes(String(finishCode))) {
    throw new Error(`Privacy scan failed! finishCode "${finishCode}" leaked in payload`);
  }
}

