import express from 'express';
import { formatSuccess } from '../utils/errors.js';
import { sanitizeUserMe } from '../utils/userHelpers.js';

export function createUsersRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;

  /**
   * GET /users/me
   * Requires Bearer access token.
   * Returns authenticated user's own data only:
   * id, role, name, email, phone, photoUrl, profileComplete, mustChangePassword.
   * Never leaks passwordHash, failedLoginCount, lockUntil, lockLevel, tokenVersion.
   */
  router.get('/me', requireAuth, (req, res) => {
    return res.status(200).json(formatSuccess(sanitizeUserMe(req.user), 'User profile retrieved'));
  });

  return router;
}
