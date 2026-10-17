const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URI',
  'FRONTEND_ORIGINS',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CODES_ENC_KEY',
  'LOG_LEVEL',
  'TRUST_PROXY',
  'RATE_LIMIT_ENABLED'
];

/**
 * Validates environment variables.
 * @param {Record<string, string|undefined>} envSource 
 * @returns {{
 *   NODE_ENV: string,
 *   PORT: number,
 *   MONGODB_URI: string,
 *   FRONTEND_ORIGINS: string[],
 *   JWT_ACCESS_SECRET: string,
 *   JWT_REFRESH_SECRET: string,
 *   CODES_ENC_KEY: string,
 *   LOG_LEVEL: string,
 *   TRUST_PROXY: boolean,
 *   RATE_LIMIT_ENABLED: boolean
 * }}
 */
export function validateEnv(envSource = process.env) {
  const missing = [];
  const invalid = [];

  for (const name of REQUIRED_VARS) {
    const val = envSource[name];
    if (val === undefined || val === null || String(val).trim() === '') {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Environment validation failed. Missing required variables: ${missing.join(', ')}`);
  }

  const nodeEnv = envSource.NODE_ENV.trim();
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    invalid.push('NODE_ENV (must be development, test, or production)');
  }

  const port = Number.parseInt(envSource.PORT, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    invalid.push('PORT (must be a valid integer between 1 and 65535)');
  }

  const mongoUri = envSource.MONGODB_URI.trim();
  // Must be a valid URI and contain a database name in the path
  try {
    const parsed = new URL(mongoUri.startsWith('mongodb') ? mongoUri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://') : mongoUri);
    const pathname = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (!pathname || pathname.trim() === '') {
      invalid.push('MONGODB_URI (connection string must include the database name in the path)');
    }
  } catch {
    invalid.push('MONGODB_URI (invalid connection string URI format)');
  }

  const origins = envSource.FRONTEND_ORIGINS.split(',')
    .map(o => o.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.some(o => o.includes('*'))) {
    invalid.push('FRONTEND_ORIGINS (must be comma-separated list of exact origins without wildcards)');
  }

  if (envSource.JWT_ACCESS_SECRET.length < 32) {
    invalid.push('JWT_ACCESS_SECRET (must be at least 32 characters)');
  }

  if (envSource.JWT_REFRESH_SECRET.length < 32) {
    invalid.push('JWT_REFRESH_SECRET (must be at least 32 characters)');
  }

  // CODES_ENC_KEY must decode to exactly 32 bytes
  try {
    const keyBuf = Buffer.from(envSource.CODES_ENC_KEY, 'base64');
    if (keyBuf.length !== 32) {
      invalid.push('CODES_ENC_KEY (base64 string must decode to exactly 32 bytes)');
    }
  } catch {
    invalid.push('CODES_ENC_KEY (must be valid base64)');
  }

  const validLogLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  const logLevel = envSource.LOG_LEVEL.trim().toLowerCase();
  if (!validLogLevels.includes(logLevel)) {
    invalid.push(`LOG_LEVEL (must be one of: ${validLogLevels.join(', ')})`);
  }

  const trustProxyStr = envSource.TRUST_PROXY.trim().toLowerCase();
  const trustProxy = trustProxyStr === 'true' || trustProxyStr === '1';

  const rateLimitEnabledStr = envSource.RATE_LIMIT_ENABLED.trim().toLowerCase();
  const rateLimitEnabled = rateLimitEnabledStr === 'true' || rateLimitEnabledStr === '1';

  // Optional Cloudinary variables: all three or none
  const cName = envSource.CLOUDINARY_CLOUD_NAME ? String(envSource.CLOUDINARY_CLOUD_NAME).trim() : '';
  const cKey = envSource.CLOUDINARY_API_KEY ? String(envSource.CLOUDINARY_API_KEY).trim() : '';
  const cSecret = envSource.CLOUDINARY_API_SECRET ? String(envSource.CLOUDINARY_API_SECRET).trim() : '';

  const cCount = (cName ? 1 : 0) + (cKey ? 1 : 0) + (cSecret ? 1 : 0);
  if (cCount > 0 && cCount < 3) {
    const missingCloudinary = [];
    if (!cName) missingCloudinary.push('CLOUDINARY_CLOUD_NAME');
    if (!cKey) missingCloudinary.push('CLOUDINARY_API_KEY');
    if (!cSecret) missingCloudinary.push('CLOUDINARY_API_SECRET');
    invalid.push(`Cloudinary configuration incomplete. Missing: ${missingCloudinary.join(', ')}`);
  }

  // DEMO_PASSWORD: development only, at least 12 chars if set, fails startup in production
  const demoPassword = envSource.DEMO_PASSWORD ? String(envSource.DEMO_PASSWORD).trim() : '';
  if (nodeEnv === 'production' && demoPassword) {
    invalid.push('DEMO_PASSWORD (DEMO_PASSWORD must never be set in production)');
  } else if (demoPassword && demoPassword.length < 12) {
    invalid.push('DEMO_PASSWORD (must be at least 12 characters)');
  }

  if (invalid.length > 0) {
    throw new Error(`Environment validation failed. Invalid variables: ${invalid.join(', ')}`);
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    MONGODB_URI: mongoUri,
    FRONTEND_ORIGINS: origins,
    JWT_ACCESS_SECRET: envSource.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: envSource.JWT_REFRESH_SECRET,
    CODES_ENC_KEY: envSource.CODES_ENC_KEY,
    LOG_LEVEL: logLevel,
    TRUST_PROXY: trustProxy,
    RATE_LIMIT_ENABLED: rateLimitEnabled,
    CLOUDINARY_CLOUD_NAME: cName || null,
    CLOUDINARY_API_KEY: cKey || null,
    CLOUDINARY_API_SECRET: cSecret || null,
    DEMO_PASSWORD: demoPassword || null
  };
}
