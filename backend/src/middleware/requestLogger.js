import { clock } from '../utils/clock.js';
import { logger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const start = clock.nowMs();

  res.on('finish', () => {
    const duration = clock.nowMs() - start;
    const userId = req.user?._id || req.user?.id || null;

    logger.info({
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      ms: duration,
      userId
    }, `${req.method} ${req.originalUrl || req.url} ${res.statusCode} in ${duration}ms`);
  });

  next();
}
