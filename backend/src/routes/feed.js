/**
 * backend/src/routes/feed.js – Unified feed endpoint.
 *
 * Mounted at /api/v1/feed
 *
 * GET /feed – logged in, both roles, tab = nearby | following, cursor pagination
 */

import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { getFeed } from '../services/feedService.js';

export function createFeedRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limit: 120 reads per 10 minutes per user
  const feedLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 120,
    message: 'Too many feed requests. Please try again later.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * GET /feed
   * Query: tab (nearby | following, default nearby), limit (1 to 50, default 20), cursor
   */
  router.get('/', requireAuth, feedLimiter, async (req, res, next) => {
    try {
      const { tab, limit, cursor } = req.query;
      const result = await getFeed({
        user: req.user,
        tab,
        limit,
        cursor,
        cursorSecret: config.JWT_REFRESH_SECRET
      });

      return res.status(200).json(formatSuccess(result, 'Feed retrieved'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
