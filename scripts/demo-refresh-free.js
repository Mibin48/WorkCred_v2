#!/usr/bin/env node
/**
 * scripts/demo-refresh-free.js
 *
 * Recreates the 3 live Free Now sample windows when they have expired:
 * - Worker E1 (~7h remaining)
 * - Worker P1 (~3h remaining)
 * - Worker H1 (~40m remaining)
 *
 * Usage:
 *   node --env-file=backend/.env scripts/demo-refresh-free.js --yes
 */

import mongoose from '../backend/node_modules/mongoose/index.js';
import { assertSeedSafety } from '../backend/src/seed/runner.js';
import { User, Availability } from '../backend/src/models/index.js';
import { withClock } from '../backend/src/seed/clockTravel.js';
import { startFreeNowWindow } from '../backend/src/services/freeNowService.js';

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
    console.log(`[demo-refresh-free] DRY RUN: Would refresh the 3 Free Now sample windows in database "${dbName}".`);
    console.log(`To execute, re-run with the --yes flag: node --env-file=backend/.env scripts/demo-refresh-free.js --yes`);
    process.exit(0);
  }

  await mongoose.connect(config.MONGODB_URI);
  try {
    const workE1 = await User.findOne({ email: 'suresh.menon.sample@example.com', isSample: true });
    const workP1 = await User.findOne({ email: 'shaji.mathew.sample@example.com', isSample: true });
    const workH1 = await User.findOne({ email: 'anoop.raj.sample@example.com', isSample: true });

    if (!workE1 || !workP1 || !workH1) {
      console.error('[demo-refresh-free] Error: Sample workers E1, P1, or H1 not found. Has the database been seeded?');
      process.exit(1);
    }

    const sampleWorkerIds = [workE1._id, workP1._id, workH1._id];

    // Close any existing active availability windows for these sample workers
    await Availability.updateMany(
      { workerId: { $in: sampleWorkerIds }, active: true },
      { $set: { active: false, closedReason: 'refreshed', closedAt: new Date() } }
    );

    const runNow = new Date();

    // Worker E1: 8h window started 1 hour ago -> ~7h left
    await withClock(new Date(runNow.getTime() - 60 * 60 * 1000), async () => {
      await startFreeNowWindow({ workerId: workE1._id, hours: 8, user: workE1 });
    });

    // Worker P1: 4h window started 1 hour ago -> ~3h left
    await withClock(new Date(runNow.getTime() - 60 * 60 * 1000), async () => {
      await startFreeNowWindow({ workerId: workP1._id, hours: 4, user: workP1 });
    });

    // Worker H1: 2h window started 80 min ago -> ~40 min left
    await withClock(new Date(runNow.getTime() - 80 * 60 * 1000), async () => {
      await startFreeNowWindow({ workerId: workH1._id, hours: 2, user: workH1 });
    });

    console.log(`[demo-refresh-free] Successfully refreshed 3 Free Now windows in "${dbName}":`);
    console.log(`- Suresh Kumar (E1, Electrician, Kakkanad): ~7 hours remaining`);
    console.log(`- Anand Nair (P1, Plumber, Kaloor): ~3 hours remaining`);
    console.log(`- Deepak P (H1, Helper, Edappally): ~40 minutes remaining`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[demo-refresh-free] Unhandled error:', err.message);
  process.exit(1);
});
