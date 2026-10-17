import express from 'express';
import { User } from '../models/User.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { formatSuccess, AppError } from '../utils/errors.js';

export function createDemoRouter(config) {
  const router = express.Router();
  const isRateLimitEnabled = config.RATE_LIMIT_ENABLED !== false;

  // Rate limit: 30 requests per 10 minutes per IP
  const demoLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: 'Too many requests for demo accounts'
  }, isRateLimitEnabled);

  /**
   * GET /api/v1/demo/accounts (public, no auth)
   *
   * Rules (Decision L6 and S1 requirement 3):
   * - Returns 404 unless ALL are true:
   *   1. NODE_ENV === 'development'
   *   2. config.DEMO_PASSWORD is set (at least 12 chars)
   *   3. Sample users exist in the database (User.countDocuments({ isSample: true }) > 0)
   * - Cache-Control: no-store
   * - Returns:
   *   {
   *     notice: "Sample accounts for development only",
   *     password: config.DEMO_PASSWORD,
   *     accounts: [
   *       { role: 'worker', name, email, note: '...' },
   *       ...
   *     ]
   *   }
   */
  router.get('/accounts', demoLimiter, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

      if (config.NODE_ENV !== 'development' || !config.DEMO_PASSWORD) {
        return next(new AppError('NOT_FOUND', 'Not found', 404));
      }

      const sampleCount = await User.countDocuments({ isSample: true });
      if (sampleCount === 0) {
        return next(new AppError('NOT_FOUND', 'Not found', 404));
      }

      const sampleUsers = await User.find({ isSample: true }).select('name email role');
      const userMap = new Map(sampleUsers.map((u) => [u.email, u]));

      // 4 workers and 3 customers representing core personas
      const accountCards = [
        {
          role: 'worker',
          name: 'Suresh Menon',
          email: 'suresh.menon.sample@example.com',
          note: 'Experienced electrician with 14 completed jobs, Passport history, and endorsements'
        },
        {
          role: 'worker',
          name: 'Naveen Prakash',
          email: 'naveen.prakash.sample@example.com',
          note: 'New cleaner with 0 jobs for testing empty-state flows'
        },
        {
          role: 'worker',
          name: 'Mini Soman',
          email: 'mini.soman.sample@example.com',
          note: 'Cook with 100% private records (visible: false) to test private-history privacy checks'
        },
        {
          role: 'worker',
          name: 'Sreejith Mohan',
          email: 'sreejith.mohan.sample@example.com',
          note: 'Helper with 0 completed jobs for empty profile stats testing'
        },
        {
          role: 'customer',
          name: 'Rahul Nambiar',
          email: 'rahul.nambiar.sample@example.com',
          note: 'Busy customer with bookings in every tab and posted jobs'
        },
        {
          role: 'customer',
          name: 'Deepa Kurian',
          email: 'deepa.kurian.sample@example.com',
          note: 'Customer with zero bookings for empty state verification'
        },
        {
          role: 'customer',
          name: 'Incomplete Customer',
          email: 'incomplete.customer.sample@example.com',
          note: 'Incomplete customer profile for onboarding demos'
        }
      ].filter((acc) => userMap.has(acc.email));

      return res.status(200).json(formatSuccess({
        notice: 'Sample accounts for development only',
        password: config.DEMO_PASSWORD,
        accounts: accountCards
      }, 'Sample demo accounts retrieved'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
