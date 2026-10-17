/**
 * backend/src/routes/follows.js – Follow and save endpoints.
 *
 * Mounted at /api/v1/follows
 *
 * POST   /follows              – logged in, follow or save worker
 * DELETE /follows/:workerId    – logged in, remove follow or save
 * GET    /follows              – logged in, list follows or saves
 */

import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createFollow, removeFollow, listFollows } from '../services/followService.js';

export function createFollowsRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter for mutations: 120 per hour
  const followMutationLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 120,
    message: 'Too many follow/save actions. Limit is 120 per hour.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  // Rate limiter for reads: 120 per 10 minutes
  const followReadLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 120,
    message: 'Too many requests. Please try again later.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * POST /follows
   * Body: { workerId, type: 'follow' | 'save' }
   */
  router.post('/', requireAuth, followMutationLimiter, async (req, res, next) => {
    try {
      const result = await createFollow({
        body: req.body,
        caller: req.user
      });
      return res.status(200).json(formatSuccess(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /follows/:workerId?type=follow|save
   */
  router.delete('/:workerId', requireAuth, followMutationLimiter, async (req, res, next) => {
    try {
      const { type } = req.query;
      const result = await removeFollow({
        workerId: req.params.workerId,
        type,
        caller: req.user
      });
      return res.status(200).json(formatSuccess(result, result.message));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /follows?type=follow|save&limit=20&cursor=...
   */
  router.get('/', requireAuth, followReadLimiter, async (req, res, next) => {
    try {
      const { type, limit, cursor } = req.query;
      const result = await listFollows({
        type,
        limit,
        cursor,
        caller: req.user
      });
      return res.status(200).json(formatSuccess(result, 'Follows retrieved'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
