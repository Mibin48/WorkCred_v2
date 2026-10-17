/**
 * routes/passport.js – B5 Work Passport endpoints.
 *
 * Mounted at /api/v1
 *
 * GET   /passport/me              – worker's own full timeline
 * PATCH /passport/entries/:id     – toggle visible/maskEmployerName (worker)
 *
 * Worker profile passport endpoints are mounted in workers.js:
 * GET   /workers/:id/passport
 * GET   /workers/:id/passport/verify
 */

import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import {
  getMyPassport,
  patchPassportEntry
} from '../services/passportService.js';

export function createPassportRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;

  // ── GET /passport/me ─────────────────────────────────────────────────────
  router.get('/me', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const result = await getMyPassport(req.user, req.query);
      return res.status(200).json(formatSuccess(result, 'Passport retrieved'));
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /passport/entries/:id ──────────────────────────────────────────
  // :id is the Crockford base32 recordId (8 chars)
  router.patch('/entries/:id', requireAuth, requireRole('worker'), async (req, res, next) => {
    try {
      const result = await patchPassportEntry(req.params.id, req.body, req.user);
      return res.status(200).json(formatSuccess({ entry: result }, 'Entry updated'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
