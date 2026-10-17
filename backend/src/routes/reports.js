/**
 * backend/src/routes/reports.js – Content and worker report endpoints.
 *
 * Mounted at /api/v1/reports
 *
 * POST /reports – logged in, both roles, report post or worker
 */

import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createReport } from '../services/reportService.js';

export function createReportsRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter: 10 reports per hour
  const reportLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many reports submitted. Limit is 10 per hour.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * POST /reports
   * Logged in. Body: { targetType, targetId, reason, note }
   */
  router.post('/', requireAuth, reportLimiter, async (req, res, next) => {
    try {
      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const result = await createReport({
        body: req.body,
        reporter: req.user,
        clientIp,
        ipSalt: config.JWT_REFRESH_SECRET
      });
      return res.status(200).json(formatSuccess(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
