#!/usr/bin/env node
/**
 * backend/scripts/demo-refresh-free.js
 *
 * Recreates the 3 live Free Now sample windows when they have expired:
 * - Worker E1 (~7h remaining)
 * - Worker P1 (~3h remaining)
 * - Worker H1 (~40m remaining)
 *
 * Usage:
 *   node --env-file=.env scripts/demo-refresh-free.js --yes
 */

import mongoose from 'mongoose';
import { assertSeedSafety } from '../src/seed/runner.js';
import { User, Availability } from '../src/models/index.js';
import { withClock } from '../src/seed/clockTravel.js';
import { startFreeNowWindow } from '../src/services/freeNowService.js';

async function main() {
  const args = process.argv.slice(2);
  const isYes = args.includes('--yes');

  const config = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    MONGODB_URI: process.env.MONGODB_URI,
    DEMO_PASSWORD: process.env.DEMO_PASSWORD
  };

  const { dbName } = assertSeedSafety(config);

  if (!isYes) {
    console.log(`[demo-refresh-free] DRY RUN: Target database is "${dbName}".`);
    console.log('[demo-refresh-free] This command re-opens the 3 live Free Now sample windows (E1: 8h, P1: 4h, H1: 2h) without touching any other data.');
    console.log('[demo-refresh-free] To execute refresh, re-run with: npm run demo:refresh-free -- --yes');
    process.exit(0);
  }

  await mongoose.connect(config.MONGODB_URI);
  try {
    const e1 = await User.findOne({ email: 'suresh.menon.sample@example.com' });
    const p1 = await User.findOne({ email: 'shaji.mathew.sample@example.com' });
    const h1 = await User.findOne({ email: 'anoop.raj.sample@example.com' });

    if (!e1 || !p1 || !h1) {
      console.error('[demo-refresh-free] FAILED: Sample workers E1, P1, or H1 not found. Seed first using npm run seed -- --yes');
      process.exit(1);
    }

    const workerIds = [e1._id, p1._id, h1._id];
    await Availability.deleteMany({ workerId: { $in: workerIds }, active: true });

    const now = new Date();

    // 1. E1: 8 hours started 1 hour ago (~7 hours remaining)
    const e1Started = new Date(now.getTime() - 60 * 60 * 1000);
    await withClock(e1Started, async () => {
      await startFreeNowWindow(e1._id, { hours: 8 });
    });

    // 2. P1: 4 hours started 1 hour ago (~3 hours remaining)
    const p1Started = new Date(now.getTime() - 60 * 60 * 1000);
    await withClock(p1Started, async () => {
      await startFreeNowWindow(p1._id, { hours: 4 });
    });

    // 3. H1: 2 hours started 80 minutes ago (~40 minutes remaining)
    const h1Started = new Date(now.getTime() - 80 * 60 * 1000);
    await withClock(h1Started, async () => {
      await startFreeNowWindow(h1._id, { hours: 2 });
    });

    console.log('[demo-refresh-free] Successfully refreshed the 3 live Free Now windows.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[demo-refresh-free] FAILED:', err);
  process.exit(1);
});
