import { verifyAccessToken } from '../utils/tokenCrypto.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';

/**
 * Creates authentication and authorization middleware initialized with app config.
 * 
 * @param {object} config
 * @param {string} config.JWT_ACCESS_SECRET
 * @param {string[]} config.FRONTEND_ORIGINS
 */
export function createAuthMiddleware(config) {
  const jwtAccessSecret = config.JWT_ACCESS_SECRET;
  const allowedOrigins = config.FRONTEND_ORIGINS || [];

  /**
   * Middleware to require a valid Bearer access token.
   * Loads user fresh from the database on every request and validates active status and tokenVersion.
   */
  async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    }

    let payload;
    try {
      payload = await verifyAccessToken(token, jwtAccessSecret);
    } catch {
      return next(new AppError('UNAUTHORIZED', 'Invalid or expired access token', 401));
    }

    const { sub: userId, tokenVersion } = payload;
    if (!userId) {
      return next(new AppError('UNAUTHORIZED', 'Invalid token claims', 401));
    }

    // Always fetch fresh user state from database to verify role, active status, and tokenVersion
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('UNAUTHORIZED', 'User not found', 401));
    }

    if (!user.isActive) {
      return next(new AppError('ACCOUNT_DISABLED', 'Account is disabled', 403));
    }

    if (user.tokenVersion !== tokenVersion) {
      return next(new AppError('SESSION_REVOKED', 'Session has been invalidated', 401));
    }

    req.user = user;
    req.authPayload = payload;
    next();
  }

  /**
   * Role authorization middleware: requireRole('worker', 'customer')
   * Rejects unauthorized roles with 403 FORBIDDEN.
   */
  function requireRole(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
      }

      if (!allowedRoles.includes(req.user.role)) {
        return next(new AppError('FORBIDDEN', 'You do not have permission to access this resource', 403));
      }

      next();
    };
  }

  /**
   * CSRF and Origin Protection Middleware for sensitive endpoints (refresh, logout):
   * Requires:
   * 1. Header `X-Requested-With: WorkCred`
   * 2. If Origin header is provided, it MUST be in FRONTEND_ORIGINS.
   */
  function requireSameApp(req, res, next) {
    const xRequestedWith = req.headers['x-requested-with'];
    if (xRequestedWith !== 'WorkCred') {
      return next(new AppError('BAD_ORIGIN', 'Missing or invalid X-Requested-With header', 403));
    }

    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.includes(origin)) {
        return next(new AppError('BAD_ORIGIN', 'Origin is not permitted', 403));
      }
    }

    next();
  }

  return {
    requireAuth,
    requireRole,
    requireSameApp
  };
}
