import mongoose from '../backend/node_modules/mongoose/index.js';
import { validateEnv } from '../backend/src/config/env.js';
import { connectDB, disconnectDB } from '../backend/src/config/db.js';
import { removeSampleData, runSeed, assertSeedSafety } from '../backend/src/seed/runner.js';
import path from 'node:path';

async function main() {
  const args = process.argv.slice(2);
  const isYes = args.includes('--yes');

  const config = validateEnv(process.env);
  const { dbName } = assertSeedSafety(config);

  if (!isYes) {
    console.log(`[demo-reset] DRY RUN: Target database is "${dbName}".`);
    console.log('[demo-reset] This command will remove all existing sample data and rebuild fresh deterministic sample data. Real data is never touched.');
    console.log('[demo-reset] To execute reset, re-run with: npm run demo:reset -- --yes');
    process.exit(0);
  }

  try {
    await connectDB(config.MONGODB_URI);
    console.log('[demo-reset] Step 1: Removing existing sample data...');
    await removeSampleData(config);

    console.log('[demo-reset] Step 2: Seeding fresh sample data...');
    const assetsDir = path.resolve('frontend', 'assets', 'sample');
    await runSeed(config, { assetsDir });
    console.log('[demo-reset] Demo reset complete.');
  } catch (err) {
    console.error(`[demo-reset] FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

main();
