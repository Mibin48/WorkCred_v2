import express from 'express';
import { formatSuccess, AppError } from '../utils/errors.js';
import { sanitizeUserMe } from '../utils/userHelpers.js';
import { validateProfileUpdateShape } from '../../../shared/profileValidators.js';
import { isProfileComplete } from '../../../shared/profileRules.js';
import { clock } from '../utils/clock.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { User } from '../models/User.js';
import { getLocalityByKey } from '../../../shared/localities.js';

export function createUsersRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;

  /**
   * GET /users/me
   * Requires Bearer access token.
   * Returns authenticated user's own data only:
   * id, role, name, email, phone, photoUrl, localityKey, localityName, hasExactLocation,
   * profileComplete, mustChangePassword (+ worker fields if role === 'worker').
   * Server computes profileComplete dynamically.
   * Never leaks passwordHash, failedLoginCount, lockUntil, lockLevel, tokenVersion, or exact coordinates.
   */
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = req.user;
      const computedComplete = isProfileComplete(user);
      if (user.profileComplete !== computedComplete) {
        user.profileComplete = computedComplete;
        await User.updateOne({ _id: user._id }, { $set: { profileComplete: computedComplete } });
      }

      return res.status(200).json(formatSuccess({ user: sanitizeUserMe(user) }, 'User profile retrieved'));
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /users/me
   * Requires Bearer access token.
   * Updates caller's own profile fields and recomputes profile completeness.
   */
  router.patch('/me', requireAuth, async (req, res, next) => {
    try {
      const user = req.user;

      const validationContext = {
        clock,
        cloudName: config.CLOUDINARY_CLOUD_NAME,
        nodeEnv: config.NODE_ENV
      };

      const shapeResult = validateProfileUpdateShape(req.body, user, validationContext);
      if (!shapeResult.valid) {
        if (shapeResult.isCustomerSendingWorkerField) {
          return next(new AppError('FIELD_NOT_ALLOWED_FOR_ROLE', shapeResult.errors.join('; '), 400));
        }
        if (shapeResult.forbiddenFieldName) {
          return next(new AppError('FORBIDDEN_FIELD', `Field '${shapeResult.forbiddenFieldName}' is not allowed to be modified`, 400, { field: shapeResult.forbiddenFieldName }));
        }
        return next(new AppError('VALIDATION_ERROR', shapeResult.errors.join('; '), 400, shapeResult.errors));
      }

      const updateData = shapeResult.data;
      const changedFieldNames = Object.keys(req.body);

      // Apply updates to user document
      for (const [key, val] of Object.entries(updateData)) {
        if (key === 'calendar') {
          if (!user.calendar) user.calendar = {};
          if (val.weekly) user.calendar.weekly = val.weekly;
          if (val.blockedDates) user.calendar.blockedDates = val.blockedDates;
        } else {
          user[key] = val;
        }
      }

      // Maintain derived fields (G1, G2, G3)
      if (user.role === 'worker') {
        // Effective hourly rate
        user.rateHourlyEffective = (user.hourlyRate && user.hourlyRate > 0)
          ? user.hourlyRate
          : (user.dailyRate && user.dailyRate > 0 ? Math.round(user.dailyRate / 8) : 0);

        // Main skill
        if (Array.isArray(user.skills) && user.skills.length > 0) {
          if (!user.mainSkill || !user.skills.includes(user.mainSkill)) {
            user.mainSkill = user.skills[0];
          }
        } else {
          user.mainSkill = null;
        }

        // Search location (centroid of localityKey, or [0, 0] if no locality)
        if (user.localityKey) {
          const loc = getLocalityByKey(user.localityKey);
          if (loc) {
            user.searchLocation = {
              type: 'Point',
              coordinates: [loc.lng, loc.lat]
            };
          }
        }
      }

      // Recompute profile completeness server-side
      user.profileComplete = isProfileComplete(user);

      await user.save();

      // Audit log changed field names ONLY (never values)
      logAuditEvent('profile_updated', {
        userId: user._id,
        role: user.role,
        changedFields: changedFieldNames,
        ip: req.ip
      });

      return res.status(200).json(formatSuccess({ user: sanitizeUserMe(user) }, 'Profile updated successfully'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
