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
export function assertNoSensitiveFields(target, forbiddenKeys = [
  'passwordHash',
  'password',
  'tokenVersion',
  'lockUntil',
  'lockLevel',
  'failedLoginCount',
  'tokenHash',
  'replacedByHash',
  'location',
  'coordinates',
  'lat',
  'lng'
]) {
  const violations = [];

  function scan(val, path = '') {
    if (!val || typeof val !== 'object') return;

    if (Array.isArray(val)) {
      val.forEach((item, idx) => scan(item, `${path}[${idx}]`));
      return;
    }

    for (const [key, value] of Object.entries(val)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (forbiddenKeys.includes(key)) {
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
