/**
 * backend/src/routes/posts.js – Work posts endpoints.
 *
 * Mounted at /api/v1/posts
 *
 * POST   /posts        – workers only, create post
 * GET    /posts/mine   – workers only, list own posts newest first
 * DELETE /posts/:id    – workers only, hard delete own post
 */

import express from 'express';
import mongoose from 'mongoose';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createPost, deletePost, formatPostResponse } from '../services/postService.js';
import { Post } from '../models/Post.js';
import { decodeFeedCursor, encodeFeedCursor } from '../../../shared/feedCursor.js';

export function createPostsRouter(config, authMiddleware, idempotencyMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;
  const idempotency = idempotencyMiddleware ? idempotencyMiddleware.idempotency : (_opts) => (_req, _res, next) => next();

  // Rate limiter for post creation: 10 per hour
  const postLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many posts created. Please try again later.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * POST /posts
   * Workers only, profileComplete required.
   * Optional idempotency key supported.
   */
  router.post('/', requireAuth, requireRole('worker'), postLimiter, idempotency({ required: false }), async (req, res, next) => {
    try {
      const result = await createPost({
        body: req.body,
        user: req.user,
        config
      });

      return res.status(201).json(formatSuccess({ post: result }, 'Post created successfully'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /posts/mine
   * Workers only. Own posts newest first, cursor pagination (limit 1 to 50, default 20).
   */
  router.get('/mine', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const user = req.user;
      const parsedLimit = Number(req.query.limit) || 20;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return next(new AppError('VALIDATION_ERROR', 'limit must be between 1 and 50', 400));
      }

      let cursorFilter = null;
      if (req.query.cursor) {
        const cursorData = decodeFeedCursor(req.query.cursor, config.JWT_REFRESH_SECRET);
        if (!cursorData) {
          return next(new AppError('BAD_CURSOR', 'Invalid or tampered pagination cursor', 400));
        }
        const cursorObjId = new mongoose.Types.ObjectId(cursorData.id);
        const cursorDate = cursorData.createdAt;

        cursorFilter = {
          $or: [
            { createdAt: { $lt: cursorDate } },
            { createdAt: cursorDate, _id: { $lt: cursorObjId } }
          ]
        };
      }

      const query = { workerId: user._id };
      if (cursorFilter) {
        query.$and = [cursorFilter];
      }

      const docs = await Post.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(parsedLimit + 1);

      const hasNext = docs.length > parsedLimit;
      const pageDocs = hasNext ? docs.slice(0, parsedLimit) : docs;

      const posts = pageDocs.map((post) =>
        formatPostResponse(post, user, { isFollowing: false, isSaved: false, isMine: true })
      );

      let nextCursor = null;
      if (hasNext && pageDocs.length > 0) {
        const lastDoc = pageDocs[pageDocs.length - 1];
        nextCursor = encodeFeedCursor(
          { id: lastDoc._id.toString(), createdAt: lastDoc.createdAt },
          config.JWT_REFRESH_SECRET
        );
      }

      return res.status(200).json(formatSuccess({ posts, nextCursor }, 'Own posts retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /posts/:id
   * Workers only, owner only (anyone else gets identical 404).
   * Safe to repeat.
   */
  router.delete('/:id', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const result = await deletePost(req.params.id, req.user);
      return res.status(200).json(formatSuccess(result, 'Post deleted successfully'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
