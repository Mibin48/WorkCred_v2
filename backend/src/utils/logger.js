import pino from 'pino';

/**
 * Masks sensitive email addresses: ravi@example.com -> r***i@example.com
 * @param {string} email 
 * @returns {string}
 */
export function maskEmail(email) {
  if (typeof email !== 'string') return email;
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Masks sensitive phone numbers: 9876543210 -> 98****3210
 * @param {string} phone 
 * @returns {string}
 */
export function maskPhone(phone) {
  if (typeof phone !== 'string') return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '****';
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}

export function createLogger(env = process.env.NODE_ENV, level = process.env.LOG_LEVEL || 'info') {
  const isDev = env === 'development';

  return pino({
    level,
    redact: {
      paths: [
        'password',
        'passwordHash',
        'token',
        'accessToken',
        'refreshToken',
        'cookie',
        'cookies',
        '*.password',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        'req.headers.cookie',
        'req.headers.authorization',
        'codes',
        'startCode',
        'finishCode',
        'startCodeEnc',
        'finishCodeEnc'
      ],
      censor: '[REDACTED]'
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  });
}

export const logger = createLogger();
