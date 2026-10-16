import rateLimit from 'express-rate-limit';
import { formatError, ErrorCodes } from '../utils/errors.js';

/**
 * Creates an express-rate-limit middleware or a no-op middleware if rate limiting is disabled.
 * @param {object} options
 * @param {boolean} isEnabled
 */
export function createRateLimiter(options = {}, isEnabled = true) {
  if (!isEnabled) {
    return (req, res, next) => next();
  }

  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests, please try again later.'
  } = options;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json(formatError(ErrorCodes.TOO_MANY_REQUESTS, message));
    }
  });
}
