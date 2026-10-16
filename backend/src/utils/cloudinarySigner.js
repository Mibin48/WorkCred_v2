import crypto from 'node:crypto';

/**
 * Builds canonical query parameter string and generates SHA-1 signature for Cloudinary upload.
 * Follows Cloudinary documentation:
 * 1. Filter out signature, api_key, resource_type, and file parameters.
 * 2. Sort remaining parameter keys lexicographically.
 * 3. Join as key=value&key2=value2.
 * 4. Append api_secret.
 * 5. Compute SHA-1 hex digest.
 * 
 * @param {Record<string, any>} params 
 * @param {string} apiSecret 
 * @returns {string} SHA-1 hex signature
 */
export function buildCloudinarySignature(params, apiSecret) {
  if (!apiSecret || typeof apiSecret !== 'string') {
    throw new Error('apiSecret must be a non-empty string');
  }

  // Filter out signature, api_key, resource_type, file
  const excludedKeys = new Set(['signature', 'api_key', 'resource_type', 'file']);
  const filteredKeys = Object.keys(params).filter((key) => {
    return !excludedKeys.has(key) && params[key] !== undefined && params[key] !== null && params[key] !== '';
  });

  // Sort keys alphabetically
  filteredKeys.sort();

  // Create query string: key=val&key2=val2
  const serialized = filteredKeys
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const stringToSign = `${serialized}${apiSecret}`;
  return crypto.createHash('sha1').update(stringToSign).digest('hex');
}
