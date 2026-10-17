/**
 * backend/src/routes/endorsements.js – Endorsement endpoints.
 *
 * Mounted at /api/v1/endorsements
 *
 * POST /endorsements – customers only, endorse a worker for a skill
 */

import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createEndorsement } from '../services/endorsementService.js';

export function createEndorsementsRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter: 30 endorsements per hour
  const endorsementLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: 'Too many endorsement requests. Limit is 30 per hour.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * POST /endorsements
   * Customers only. Body: { workerId, skill }
   */
  router.post('/', requireAuth, requireRole('customer'), endorsementLimiter, async (req, res, next) => {
    try {
      const { workerId, skill } = req.body || {};
      const result = await createEndorsement({
        workerId,
        skill,
        customer: req.user
      });
      return res.status(200).json(formatSuccess(result, 'Endorsement recorded successfully'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
