import express from 'express';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { AppError, formatSuccess } from '../utils/errors.js';
import { validateSignupShape, validateLoginShape, validatePasswordChangeShape } from '../../../shared/validators.js';
import { validatePassword } from '../../../shared/passwordRules.js';
import { hashPassword, verifyPassword, dummyVerifyPassword } from '../utils/passwordCrypto.js';
import {
  signAccessToken,
  generateOpaqueRefreshToken,
  hashRefreshToken,
  generateFamilyId,
  getRefreshCookieOptions,
  getClearCookieOptions,
  REFRESH_COOKIE_NAME,
  ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  REFRESH_MAX_SESSION_MS
} from '../utils/tokenCrypto.js';
import { sanitizeUserMe, checkAccountLockout, computeLockDuration } from '../utils/userHelpers.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

export function createAuthRouter(config, authMiddleware) {
  const router = express.Router();
  const isProd = config.NODE_ENV === 'production';
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  const { requireAuth, requireSameApp } = authMiddleware;

  // Rate Limiters per requirement 3
  // Signup: 5 per hour and 20 per day
  const signupHourLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many signup attempts from this IP, please try again in an hour.'
  }, isRateLimitEnabled);

  const signupDayLimiter = createRateLimiter({
    windowMs: 24 * 60 * 60 * 1000,
    max: 20,
    message: 'Daily signup limit exceeded from this IP, please try again tomorrow.'
  }, isRateLimitEnabled);

  // Login: 20 per 10 minutes
  const loginLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: 'Too many login attempts from this IP, please try again in 10 minutes.'
  }, isRateLimitEnabled);

  // Refresh limit: 60 per 15 minutes
  const refreshLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: 'Too many refresh requests, please slow down.'
  }, isRateLimitEnabled);

  // Password change limit: 10 per hour
  const passwordChangeLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many password change attempts, please try again later.'
  }, isRateLimitEnabled);

  /**
   * POST /auth/signup
   * Body: { role, name, email, phone, password }
   */
  router.post('/signup', signupHourLimiter, signupDayLimiter, async (req, res, next) => {
    try {
      const shapeResult = validateSignupShape(req.body);
      if (!shapeResult.valid) {
        return next(new AppError('VALIDATION_ERROR', shapeResult.errors.join('; '), 400, shapeResult.errors));
      }

      const { role, name, email, phone, password } = shapeResult.data;

      // Validate password rules (AUTH-3)
      const pwResult = validatePassword(password, { name, phone, email });
      if (!pwResult.valid) {
        return next(new AppError('WEAK_PASSWORD', pwResult.error || 'Password does not meet requirements', 400));
      }

      // Check duplicate email
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return next(new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409));
      }

      // Hash password with scrypt
      const passwordHash = await hashPassword(password);

      // Create user
      const user = new User({
        email,
        phone,
        role,
        name,
        passwordHash,
        failedLoginCount: 0,
        lockUntil: null,
        lockLevel: 0,
        tokenVersion: 0,
        profileComplete: false
      });
      await user.save();

      // Issue tokens
      const familyId = generateFamilyId();
      const rawRefreshToken = generateOpaqueRefreshToken();
      const tokenHash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await RefreshToken.create({
        userId: user._id,
        familyId,
        tokenHash,
        expiresAt: refreshExpiresAt
      });

      const accessToken = await signAccessToken({
        userId: user._id,
        role: user.role,
        tokenVersion: user.tokenVersion,
        sessionId: familyId
      }, config.JWT_ACCESS_SECRET);

      // Set cookie
      res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getRefreshCookieOptions(isProd));

      logAuditEvent('signup', {
        userId: user._id,
        email: user.email,
        role: user.role,
        ip: req.ip
      });

      return res.status(201).json(formatSuccess({
        user: sanitizeUserMe(user),
        accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS
      }, 'Account created successfully'));
    } catch (err) {
      if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
        return next(new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409));
      }
      next(err);
    }
  });

  /**
   * POST /auth/login
   * Body: { email, password, role }
   */
  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const shapeResult = validateLoginShape(req.body);
      if (!shapeResult.valid) {
        return next(new AppError('VALIDATION_ERROR', shapeResult.errors.join('; '), 400, shapeResult.errors));
      }

      const { email, password, role: requestedRole } = shapeResult.data;

      // Fetch user along with passwordHash
      const user = await User.findOne({ email }).select('+passwordHash');

      if (!user) {
        // Unknown email: perform dummy scrypt verification to match timing and prevent user enumeration
        await dummyVerifyPassword(password);
        logAuditEvent('login_failed', { email, reason: 'unknown_email', ip: req.ip });
        return next(new AppError('INVALID_CREDENTIALS', 'Email or password is wrong.', 401));
      }

      // Check lockout status BEFORE evaluating password
      const lockout = checkAccountLockout(user);
      if (lockout.locked) {
        logAuditEvent('login_failed', { userId: user._id, email: user.email, reason: 'account_locked', ip: req.ip });
        return next(new AppError(
          'ACCOUNT_LOCKED',
          `Account is temporarily locked. Please try again in ${lockout.remainingMinutes} minutes.`,
          429
        ));
      }

      // Verify password
      const passwordMatch = await verifyPassword(password, user.passwordHash);

      if (!passwordMatch) {
        // Increment failed attempts
        const newCount = (user.failedLoginCount || 0) + 1;
        let updateData = { failedLoginCount: newCount };

        if (newCount >= 5) {
          const { lockMinutes, nextLockLevel } = computeLockDuration(user.lockLevel || 0);
          updateData.lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
          updateData.lockLevel = nextLockLevel;
          updateData.failedLoginCount = 0; // reset count upon engaging lock

          await User.updateOne({ _id: user._id }, { $set: updateData });

          logAuditEvent('login_failed', {
            userId: user._id,
            email: user.email,
            reason: 'account_locked',
            ip: req.ip
          });

          return next(new AppError(
            'ACCOUNT_LOCKED',
            `Account is temporarily locked. Please try again in ${lockMinutes} minutes.`,
            429
          ));
        }

        await User.updateOne({ _id: user._id }, { $set: updateData });

        logAuditEvent('login_failed', {
          userId: user._id,
          email: user.email,
          reason: 'wrong_password',
          ip: req.ip
        });

        return next(new AppError('INVALID_CREDENTIALS', 'Email or password is wrong.', 401));
      }

      // Password is correct. Now verify active status
      if (!user.isActive) {
        return next(new AppError('ACCOUNT_DISABLED', 'Account is disabled. Contact support.', 403));
      }

      // Role check strictly AFTER password check
      if (user.role !== requestedRole) {
        return next(new AppError('ROLE_MISMATCH', `Account registered as ${user.role}. Please select the ${user.role} tab to log in.`, 403));
      }

      // Login Successful! Reset lockout fields and record lastLoginAt
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLoginCount: 0,
            lockUntil: null,
            lockLevel: 0,
            lastLoginAt: new Date()
          }
        }
      );

      // Create new refresh session family
      const familyId = generateFamilyId();
      const rawRefreshToken = generateOpaqueRefreshToken();
      const tokenHash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await RefreshToken.create({
        userId: user._id,
        familyId,
        tokenHash,
        expiresAt: refreshExpiresAt
      });

      const accessToken = await signAccessToken({
        userId: user._id,
        role: user.role,
        tokenVersion: user.tokenVersion,
        sessionId: familyId
      }, config.JWT_ACCESS_SECRET);

      res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getRefreshCookieOptions(isProd));

      logAuditEvent('login', {
        userId: user._id,
        email: user.email,
        role: user.role,
        ip: req.ip
      });

      return res.status(200).json(formatSuccess({
        user: sanitizeUserMe(user),
        accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS
      }, 'Logged in successfully'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /auth/refresh
   * Reads wc_rt cookie + headers X-Requested-With: WorkCred and Origin check.
   * Rotates the refresh token on every use. Revokes whole family on reuse.
   */
  router.post('/refresh', refreshLimiter, requireSameApp, async (req, res, next) => {
    try {
      const rawToken = req.cookies[REFRESH_COOKIE_NAME];
      if (!rawToken) {
        return next(new AppError('UNAUTHORIZED', 'Refresh token required', 401));
      }

      const tokenHash = hashRefreshToken(rawToken, config.JWT_REFRESH_SECRET);
      const existingTokenDoc = await RefreshToken.findOne({ tokenHash });

      if (!existingTokenDoc) {
        // Unknown token: clear cookie and return 401
        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));
        return next(new AppError('SESSION_INVALID', 'Invalid refresh session', 401));
      }

      // Check if token was already used (Reuse detection)
      if (existingTokenDoc.usedAt) {
        // Attack/Replay detected! Invalidate the ENTIRE token family immediately
        await RefreshToken.updateMany(
          { familyId: existingTokenDoc.familyId },
          { $set: { revokedAt: new Date() } }
        );

        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));

        logAuditEvent('refresh_reuse', {
          userId: existingTokenDoc.userId,
          familyId: existingTokenDoc.familyId,
          ip: req.ip
        });

        return next(new AppError('SESSION_INVALID', 'Refresh token reuse detected. All sessions in this family revoked.', 401));
      }

      // Check if token was revoked
      if (existingTokenDoc.revokedAt) {
        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));
        return next(new AppError('SESSION_INVALID', 'Refresh session is revoked', 401));
      }

      // Check expiry
      if (new Date(existingTokenDoc.expiresAt) <= new Date()) {
        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));
        return next(new AppError('SESSION_EXPIRED', 'Refresh session expired', 401));
      }

      // Find user and verify active status
      const user = await User.findById(existingTokenDoc.userId);
      if (!user || !user.isActive) {
        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));
        return next(new AppError('ACCOUNT_DISABLED', 'User account is missing or disabled', 403));
      }

      // Enforce 90-day absolute maximum from session family creation
      // Look up genesis session of this family
      const firstSessionInFamily = await RefreshToken.findOne({ familyId: existingTokenDoc.familyId }).sort({ createdAt: 1 });
      if (firstSessionInFamily) {
        const familyAgeMs = Date.now() - new Date(firstSessionInFamily.createdAt).getTime();
        if (familyAgeMs > REFRESH_MAX_SESSION_MS) {
          await RefreshToken.updateMany(
            { familyId: existingTokenDoc.familyId },
            { $set: { revokedAt: new Date() } }
          );
          res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));
          return next(new AppError('SESSION_EXPIRED', 'Maximum session duration reached. Please log in again.', 401));
        }
      }

      // Token rotation: mark old token as used
      const newRawRefreshToken = generateOpaqueRefreshToken();
      const newTokenHash = hashRefreshToken(newRawRefreshToken, config.JWT_REFRESH_SECRET);
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      existingTokenDoc.usedAt = new Date();
      existingTokenDoc.replacedByHash = newTokenHash;
      await existingTokenDoc.save();

      // Create new token in same family
      await RefreshToken.create({
        userId: user._id,
        familyId: existingTokenDoc.familyId,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt
      });

      // Sign new access token
      const newAccessToken = await signAccessToken({
        userId: user._id,
        role: user.role,
        tokenVersion: user.tokenVersion,
        sessionId: existingTokenDoc.familyId
      }, config.JWT_ACCESS_SECRET);

      // Set new cookie
      res.cookie(REFRESH_COOKIE_NAME, newRawRefreshToken, getRefreshCookieOptions(isProd));

      return res.status(200).json(formatSuccess({
        accessToken: newAccessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS
      }, 'Token refreshed successfully'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /auth/logout
   * Revokes that login family and clears cookie.
   * Requires X-Requested-With: WorkCred header and allowed Origin.
   */
  router.post('/logout', requireSameApp, async (req, res, next) => {
    try {
      const rawToken = req.cookies[REFRESH_COOKIE_NAME];
      if (rawToken) {
        const tokenHash = hashRefreshToken(rawToken, config.JWT_REFRESH_SECRET);
        const tokenDoc = await RefreshToken.findOne({ tokenHash });
        if (tokenDoc) {
          await RefreshToken.updateMany(
            { familyId: tokenDoc.familyId },
            { $set: { revokedAt: new Date() } }
          );
        }
      }

      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isProd));

      return res.status(200).json(formatSuccess({}, 'Logged out successfully'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /auth/password/change
   * Logged in user. Body: { currentPassword, newPassword }
   * Keeps current session, logs out all other devices, bumps tokenVersion.
   */
  router.post('/password/change', passwordChangeLimiter, requireAuth, async (req, res, next) => {
    try {
      const shapeResult = validatePasswordChangeShape(req.body);
      if (!shapeResult.valid) {
        return next(new AppError('VALIDATION_ERROR', shapeResult.errors.join('; '), 400, shapeResult.errors));
      }

      const { currentPassword, newPassword } = shapeResult.data;
      const user = await User.findById(req.user._id).select('+passwordHash');

      if (!user) {
        return next(new AppError('NOT_FOUND', 'User not found', 404));
      }

      const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isCurrentValid) {
        return next(new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 400));
      }

      // Validate new password rules
      const pwResult = validatePassword(newPassword, {
        name: user.name,
        phone: user.phone,
        email: user.email
      });
      if (!pwResult.valid) {
        return next(new AppError('WEAK_PASSWORD', pwResult.error || 'New password does not meet requirements', 400));
      }

      // Hash new password
      const newHash = await hashPassword(newPassword);

      // Increment tokenVersion so ALL old access tokens immediately die
      const newTokenVersion = (user.tokenVersion || 0) + 1;
      user.passwordHash = newHash;
      user.tokenVersion = newTokenVersion;
      user.mustChangePassword = false;
      await user.save();

      // Invalidate all existing refresh tokens for this user
      await RefreshToken.updateMany(
        { userId: user._id },
        { $set: { revokedAt: new Date() } }
      );

      // Generate a brand new refresh family for this active device session
      const newFamilyId = generateFamilyId();
      const rawRefreshToken = generateOpaqueRefreshToken();
      const tokenHash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await RefreshToken.create({
        userId: user._id,
        familyId: newFamilyId,
        tokenHash,
        expiresAt: refreshExpiresAt
      });

      // Issue fresh access token with bumped tokenVersion
      const newAccessToken = await signAccessToken({
        userId: user._id,
        role: user.role,
        tokenVersion: newTokenVersion,
        sessionId: newFamilyId
      }, config.JWT_ACCESS_SECRET);

      res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getRefreshCookieOptions(isProd));

      logAuditEvent('password_changed', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });

      return res.status(200).json(formatSuccess({
        accessToken: newAccessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS
      }, 'Password changed successfully. All other sessions have been logged out.'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
