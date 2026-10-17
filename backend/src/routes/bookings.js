/**
 * routes/bookings.js – B5 booking endpoints.
 *
 * Mounted at /api/v1/bookings
 *
 * POST   /bookings                  – create direct booking (customer)
 * GET    /bookings                  – list own bookings (both)
 * GET    /bookings/counts           – tab counts (both)
 * GET    /bookings/:id              – booking detail (participants)
 * GET    /bookings/:id/codes        – decrypt codes (customer only)
 * POST   /bookings/:id/confirm      – confirm (worker only)
 * POST   /bookings/:id/cancel       – cancel (either)
 * POST   /bookings/:id/start        – enter start code (worker)
 * POST   /bookings/:id/finish       – enter finish code (customer)
 * GET    /bookings/:id/receipt      – receipt (participants, completed)
 * POST   /bookings/:id/report       – report problem (worker, in_progress)
 */

import express from 'express';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { idempotency } from '../middleware/idempotency.js';
import { formatSuccess, formatError, AppError } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import {
  createDirectBooking,
  listBookings,
  getBookingCounts,
  getBookingDetail,
  getBookingCodes,
  confirmBooking,
  cancelBooking,
  startBooking,
  finishBooking,
  getBookingReceipt,
  reportBooking
} from '../services/bookingService.js';

export function createBookingsRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth, requireRole } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limiter: 20 booking creation requests per hour per customer
  const bookingCreationLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: 'Too many booking attempts. Please try again later.',
    keyGenerator: (req) => `booking_create:${req.user?._id?.toString() || req.ip}`
  }, isRateLimitEnabled);

  // Rate limiter: 30 code reveals per 10 minutes per user
  const codesLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: 'Too many code requests. Please try again later.',
    keyGenerator: (req) => `codes:${req.user?._id?.toString() || req.ip}`
  }, isRateLimitEnabled);

  // Rate limiter: 10 reports per hour
  const reportLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many report requests. Please try again later.',
    keyGenerator: (req) => `report:${req.user?._id?.toString() || req.ip}`
  }, isRateLimitEnabled);

  // Attach caller's IP to req.user for audit logging
  const attachIp = (req, _res, next) => {
    if (req.user) req.user._ip = req.ip;
    next();
  };

  // ── POST /bookings ──────────────────────────────────────────────────────
  router.post(
    '/',
    requireAuth,
    requireRole('customer'),
    attachIp,
    bookingCreationLimiter,
    idempotency({ required: true }),
    async (req, res, next) => {
      try {
        // Profile completeness required
        if (!req.user.profileComplete) {
          return next(new AppError('PROFILE_INCOMPLETE', 'Complete your profile before making a booking', 403));
        }

        const bookingSummary = await createDirectBooking(
          req.body,
          req.user,
          config,
          clock
        );

        return res.status(201).json(formatSuccess({ booking: bookingSummary }, 'Booking created'));
      } catch (err) {
        next(err);
      }
    }
  );

  // ── GET /bookings/counts ────────────────────────────────────────────────
  // Must come BEFORE /:id to avoid matching 'counts' as an ID
  router.get('/counts', requireAuth, attachIp, async (req, res, next) => {
    try {
      const counts = await getBookingCounts(req.user, clock);
      return res.status(200).json(formatSuccess({ counts }, 'Counts retrieved'));
    } catch (err) {
      next(err);
    }
  });

  // ── GET /bookings ────────────────────────────────────────────────────────
  router.get('/', requireAuth, attachIp, async (req, res, next) => {
    try {
      const result = await listBookings(req.query, req.user, clock);
      return res.status(200).json(formatSuccess(result, 'Bookings retrieved'));
    } catch (err) {
      if (err.statusCode && !(err instanceof AppError)) {
        return next(new AppError(err.code || 'BAD_REQUEST', err.message, err.statusCode, err.details));
      }
      next(err);
    }
  });

  // ── GET /bookings/:id ────────────────────────────────────────────────────
  router.get('/:id', requireAuth, attachIp, async (req, res, next) => {
    try {
      const detail = await getBookingDetail(req.params.id, req.user, clock);
      return res.status(200).json(formatSuccess({ booking: detail }, 'Booking retrieved'));
    } catch (err) {
      if (err.statusCode && !(err instanceof AppError)) {
        return next(new AppError(err.code || 'BAD_REQUEST', err.message, err.statusCode, err.details));
      }
      next(err);
    }
  });

  // ── GET /bookings/:id/codes ──────────────────────────────────────────────
  // Customer only; Cache-Control: no-store enforced here and globally by middleware
  router.get('/:id/codes', requireAuth, attachIp, codesLimiter, async (req, res, next) => {
    try {
      // Only customers can see codes
      if (req.user.role !== 'customer') {
        return next(new AppError('NOT_FOUND', 'Not found', 404));
      }

      const codes = await getBookingCodes(req.params.id, req.user, config, clock);

      // Enforce Cache-Control: no-store for this endpoint specifically
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(formatSuccess(codes, 'Codes retrieved'));
    } catch (err) {
      next(err);
    }
  });

  // ── POST /bookings/:id/confirm ───────────────────────────────────────────
  router.post('/:id/confirm', requireAuth, requireRole('worker'), attachIp, async (req, res, next) => {
    try {
      const detail = await confirmBooking(req.params.id, req.user, clock);
      return res.status(200).json(formatSuccess({ booking: detail }, 'Booking confirmed'));
    } catch (err) {
      next(err);
    }
  });

  // ── POST /bookings/:id/cancel ────────────────────────────────────────────
  router.post('/:id/cancel', requireAuth, attachIp, async (req, res, next) => {
    try {
      const result = await cancelBooking(req.params.id, req.body, req.user, clock);
      return res.status(200).json(formatSuccess(result, 'Booking cancelled'));
    } catch (err) {
      next(err);
    }
  });

  // ── POST /bookings/:id/start ─────────────────────────────────────────────
  router.post('/:id/start', requireAuth, requireRole('worker'), attachIp, async (req, res, next) => {
    try {
      const result = await startBooking(req.params.id, req.body, req.user, config, clock);
      return res.status(200).json(formatSuccess(result, 'Booking started'));
    } catch (err) {
      next(err);
    }
  });

  // ── POST /bookings/:id/finish ────────────────────────────────────────────
  router.post(
    '/:id/finish',
    requireAuth,
    requireRole('customer'),
    attachIp,
    idempotency({ required: false }),
    async (req, res, next) => {
      try {
        const receipt = await finishBooking(req.params.id, req.body, req.user, config, clock);
        return res.status(200).json(formatSuccess({ receipt }, 'Booking finished'));
      } catch (err) {
        next(err);
      }
    }
  );

  // ── GET /bookings/:id/receipt ────────────────────────────────────────────
  router.get('/:id/receipt', requireAuth, attachIp, async (req, res, next) => {
    try {
      const receipt = await getBookingReceipt(req.params.id, req.user, clock);
      return res.status(200).json(formatSuccess({ receipt }, 'Receipt retrieved'));
    } catch (err) {
      next(err);
    }
  });

  // ── POST /bookings/:id/report ────────────────────────────────────────────
  router.post('/:id/report', requireAuth, requireRole('worker'), attachIp, reportLimiter, async (req, res, next) => {
    try {
      const result = await reportBooking(req.params.id, req.body, req.user, clock);
      return res.status(200).json(formatSuccess(result, 'Report submitted'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
