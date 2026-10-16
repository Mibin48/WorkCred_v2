import express from 'express';
import { RateStats } from '../models/RateStats.js';
import { formatSuccess, AppError } from '../utils/errors.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { VALID_SKILLS } from '../../../shared/profileRules.js';
import { getLocalityByKey, LOCALITIES } from '../../../shared/localities.js';
import { SAMPLE_BASELINES, fairLabel, pickSource } from '../../../shared/compassMath.js';

export function createCompassRouter(config, authMiddleware) {
  const router = express.Router();
  const { requireAuth } = authMiddleware;
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limit: 60 requests per 10 minutes per user
  const compassLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    message: 'Too many compass requests. Please try again later.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip
  }, isRateLimitEnabled);

  /**
   * GET /compass
   * Logged in.
   * Query: skill (required), localityKey (optional, defaults to caller's), rate (optional, per hour).
   * 
   * 3-tier fallback:
   * 1. Locality row if sampleSize >= 5
   * 2. City row if sampleSize >= 5
   * 3. Sample baseline from shared/compassMath.js
   * 
   * Response:
   * {
   *   skill, localityKey, p25, median, p75, sampleSize,
   *   source: 'locality'|'city'|'baseline',
   *   isSample: boolean,
   *   note: "Based on sample rates for now" (when baseline),
   *   label: 'low'|'fair'|'high' (only when rate sent)
   * }
   */
  router.get('/', requireAuth, compassLimiter, async (req, res, next) => {
    try {
      const { skill, localityKey: queryLocality, rate: rawRate } = req.query;

      // 1. Validate skill
      if (!skill || typeof skill !== 'string') {
        return next(new AppError('VALIDATION_ERROR', 'skill query parameter is required', 400));
      }
      const normalizedSkill = skill.trim().toLowerCase();
      if (!VALID_SKILLS.includes(normalizedSkill)) {
        return next(new AppError('VALIDATION_ERROR', `skill '${skill}' is not a recognized skill`, 400));
      }

      // 2. Resolve localityKey (query > user's localityKey > default to first locality)
      let targetLocalityKey = queryLocality ? String(queryLocality).trim() : req.user?.localityKey;
      if (!targetLocalityKey) {
        targetLocalityKey = LOCALITIES[0].key;
      }

      const locDoc = getLocalityByKey(targetLocalityKey);
      if (!locDoc) {
        return next(new AppError('VALIDATION_ERROR', `localityKey '${targetLocalityKey}' is not recognized`, 400));
      }
      targetLocalityKey = locDoc.key;
      const cityKey = locDoc.cityKey;

      // 3. Optional rate to evaluate
      let rateNumber = null;
      if (rawRate !== undefined && rawRate !== null && rawRate !== '') {
        const parsed = Number(rawRate);
        if (Number.isNaN(parsed) || parsed < 0) {
          return next(new AppError('VALIDATION_ERROR', 'rate must be a positive number', 400));
        }
        rateNumber = parsed;
      }

      // 4. Fetch locality and city stats from DB
      const [localityDoc, cityDoc] = await Promise.all([
        RateStats.findOne({ skill: normalizedSkill, localityKey: targetLocalityKey }),
        RateStats.findOne({ skill: normalizedSkill, localityKey: `city:${cityKey}` })
      ]);

      const baseline = SAMPLE_BASELINES[normalizedSkill] || SAMPLE_BASELINES.other;
      const baselineStats = {
        p25: baseline.p25,
        median: baseline.median,
        p75: baseline.p75,
        sampleSize: 0
      };

      const sourceResolution = pickSource(localityDoc, cityDoc, baselineStats);
      const chosen = sourceResolution.data;

      const responseData = {
        skill: normalizedSkill,
        localityKey: targetLocalityKey,
        p25: chosen.p25,
        median: chosen.median,
        p75: chosen.p75,
        sampleSize: chosen.sampleSize || 0,
        source: sourceResolution.source,
        isSample: sourceResolution.isSample
      };

      if (sourceResolution.isSample) {
        responseData.note = 'Based on sample rates for now';
      }

      if (rateNumber !== null) {
        responseData.label = fairLabel(rateNumber, chosen);
      }

      return res.status(200).json(formatSuccess(responseData, 'Fair Rate Compass guidance retrieved'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Helper to fetch fair rate hint for a skill and locality.
 * Used by jobs router.
 */
export async function getFairRateInfo(skill, localityKey, offeredRate = null) {
  const normalizedSkill = String(skill || 'other').trim().toLowerCase();
  const targetLocalityKey = localityKey || null;

  const loc = targetLocalityKey ? getLocalityByKey(targetLocalityKey) : null;
  const cityKey = loc ? loc.cityKey : null;

  const [localityDoc, cityDoc] = await Promise.all([
    targetLocalityKey ? RateStats.findOne({ skill: normalizedSkill, localityKey: targetLocalityKey }).lean() : null,
    cityKey ? RateStats.findOne({ skill: normalizedSkill, localityKey: `city:${cityKey}` }).lean() : null
  ]);

  const baseline = SAMPLE_BASELINES[normalizedSkill] || SAMPLE_BASELINES.other;
  const baselineStats = {
    p25: baseline.p25,
    median: baseline.median,
    p75: baseline.p75,
    sampleSize: 0
  };

  const sourceResolution = pickSource(localityDoc, cityDoc, baselineStats);
  const chosen = sourceResolution.data;

  const res = {
    p25: chosen.p25,
    median: chosen.median,
    p75: chosen.p75,
    sampleSize: chosen.sampleSize || 0,
    source: sourceResolution.source,
    isSample: sourceResolution.isSample,
    label: offeredRate !== null ? fairLabel(offeredRate, chosen) : undefined
  };

  return res;
}

