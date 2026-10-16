import express from 'express';
import crypto from 'node:crypto';
import { formatSuccess, formatError, AppError } from '../utils/errors.js';
import { buildCloudinarySignature } from '../utils/cloudinarySigner.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { logAuditEvent } from '../utils/auditLogger.js';

export function createUploadsRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter: 20 signed requests per user per hour
  const uploadsLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: 'Too many upload sign requests. Limit is 20 per hour.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * POST /uploads/sign
   * Logged in. Body: { purpose: "avatar" }
   * Returns Cloudinary parameters and SHA-1 signature.
   * If Cloudinary credentials are not configured, returns 503 UPLOADS_DISABLED.
   */
  router.post('/sign', requireAuth, uploadsLimiter, (req, res, next) => {
    try {
      // 1. Verify Cloudinary configuration
      const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, NODE_ENV } = config;
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        return res.status(503).json(formatError('UPLOADS_DISABLED', 'Photo uploads are not configured on this server.'));
      }

      // 2. Validate body
      const body = req.body;
      if (!body || typeof body !== 'object' || body.purpose !== 'avatar') {
        return next(new AppError('VALIDATION_ERROR', "purpose must be 'avatar'", 400));
      }

      const userId = req.user._id.toString();
      const nodeEnv = NODE_ENV || 'development';
      const folder = `workcred/${nodeEnv}/${userId}/avatar`;
      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = crypto.randomUUID();

      // Build parameters for signature
      // Cloudinary signs parameters in alphabetical order
      const signParams = {
        folder,
        public_id: publicId,
        timestamp
      };

      const signature = buildCloudinarySignature(signParams, CLOUDINARY_API_SECRET);

      logAuditEvent('upload_signed', {
        userId: req.user._id,
        role: req.user.role,
        ip: req.ip
      });

      return res.status(200).json(formatSuccess({
        cloudName: CLOUDINARY_CLOUD_NAME,
        apiKey: CLOUDINARY_API_KEY,
        timestamp,
        folder,
        publicId,
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`
      }, 'Upload signature generated successfully'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
