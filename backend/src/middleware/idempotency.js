import crypto from 'node:crypto';
import { IdempotencyKey } from '../models/IdempotencyKey.js';
import { formatError, AppError } from '../utils/errors.js';
import { logAuditEvent } from '../utils/auditLogger.js';

/**
 * Creates idempotency middleware.
 * 
 * Rules (Requirement 1):
 * - Header: Idempotency-Key (8 to 80 characters: letters, digits, dash, underscore)
 * - Uses IdempotencyKey collection (userId, key, route, requestHash, state: 'processing'|'done', responseSnapshot, 24h TTL)
 * - First request records state: 'processing'
 * - A concurrent duplicate gets 409 REQUEST_IN_PROGRESS
 * - A finished duplicate replays the stored status and body with header Idempotent-Replay: true
 * - Same key with a different body gives 422 KEY_REUSED
 * - Failed (5xx) responses are not stored so client can retry
 * 
 * @param {{ required?: boolean }} options 
 */
export function idempotency(options = { required: false }) {
  return async function idempotencyMiddleware(req, res, next) {
    const rawKey = req.headers['idempotency-key'];

    if (!rawKey) {
      if (options.required) {
        return next(new AppError('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required for this operation', 400));
      }
      return next();
    }

    const key = String(rawKey).trim();
    if (key.length < 8 || key.length > 80 || !/^[A-Za-z0-9_-]+$/.test(key)) {
      return next(new AppError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8 to 80 characters containing letters, digits, dashes, and underscores only', 400));
    }

    const userId = req.user?._id;
    if (!userId) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required for idempotent requests', 401));
    }

    const route = req.baseUrl + req.path;
    // Canonical request body hash
    const bodyStr = JSON.stringify(req.body || {});
    const requestHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

    try {
      // 1. Attempt to insert processing record
      const record = await IdempotencyKey.create({
        userId,
        key,
        route,
        requestHash,
        state: 'processing'
      });

      // Hook into response finish to capture status and body
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        const statusCode = res.statusCode;

        // If successful or 4xx, mark as done and save response snapshot
        if (statusCode < 500) {
          IdempotencyKey.updateOne(
            { _id: record._id },
            {
              $set: {
                state: 'done',
                responseSnapshot: {
                  statusCode,
                  body
                }
              }
            }
          ).catch((err) => {
            req.log?.error({ err }, 'Failed to save idempotency response snapshot');
          });
        } else {
          // On 5xx, delete record so caller can retry safely
          IdempotencyKey.deleteOne({ _id: record._id }).catch(() => {});
        }

        return originalJson(body);
      };

      return next();
    } catch (err) {
      // Duplicate key error (userId + key + route collision)
      if (err.code === 11000) {
        const existing = await IdempotencyKey.findOne({ userId, key, route });
        if (!existing) {
          return next(new AppError('IDEMPOTENCY_ERROR', 'Idempotency conflict detected', 409));
        }

        // Check if request body matches
        if (existing.requestHash !== requestHash) {
          return next(new AppError('KEY_REUSED', 'Idempotency-Key has already been used with a different request payload', 422));
        }

        // If still processing, return 409
        if (existing.state === 'processing') {
          return res.status(409).json(formatError('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is currently being processed. Please retry shortly.'));
        }

        // Replay cached response
        if (existing.state === 'done' && existing.responseSnapshot) {
          logAuditEvent('idempotent_replay', {
            userId,
            key,
            route,
            ip: req.ip
          });
          res.setHeader('Idempotent-Replay', 'true');
          return res.status(existing.responseSnapshot.statusCode).json(existing.responseSnapshot.body);
        }
      }

      next(err);
    }
  };
}

