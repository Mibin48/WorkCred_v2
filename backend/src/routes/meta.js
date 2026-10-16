import express from 'express';
import { formatSuccess } from '../utils/errors.js';
import { VALID_SKILLS, WEEKLY_SLOT_OPTIONS, PROFILE_LIMITS } from '../../../shared/profileRules.js';
import { LOCALITIES } from '../../../shared/localities.js';

export function createMetaRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;

  /**
   * GET /meta
   * Logged in. Returns metadata for profiles and onboarding:
   * - skills list
   * - localities (key, name, cityKey - NEVER coordinates)
   * - weekly slot options
   * - profile limits
   */
  router.get('/', requireAuth, (req, res) => {
    // Sanitize localities: explicitly include key, name, cityKey only (no lat, lng)
    const sanitizedLocalities = LOCALITIES.map((loc) => ({
      key: loc.key,
      name: loc.name,
      cityKey: loc.cityKey
    }));

    const metaData = {
      skills: VALID_SKILLS,
      localities: sanitizedLocalities,
      weeklyOptions: WEEKLY_SLOT_OPTIONS,
      limits: {
        maxSkills: PROFILE_LIMITS.maxSkills,
        bio: PROFILE_LIMITS.maxBioLength,
        maxBioLength: PROFILE_LIMITS.maxBioLength,
        radiusMin: PROFILE_LIMITS.minRadiusKm,
        radiusMax: PROFILE_LIMITS.maxRadiusKm,
        minRate: PROFILE_LIMITS.minRate,
        maxRate: PROFILE_LIMITS.maxRate,
        maxBlockedDates: PROFILE_LIMITS.maxBlockedDates
      }
    };

    return res.status(200).json(formatSuccess(metaData, 'Metadata retrieved'));
  });

  return router;
}
