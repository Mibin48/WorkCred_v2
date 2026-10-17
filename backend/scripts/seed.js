import mongoose from 'mongoose';
import { validateEnv } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { runSeed, assertSeedSafety } from '../src/seed/runner.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

async function main() {
  const args = process.argv.slice(2);
  const isYes = args.includes('--yes');

  const config = validateEnv(process.env);
  const { dbName } = assertSeedSafety(config);

  if (!isYes) {
    console.log(`[seed] DRY RUN: Target database is "${dbName}".`);
    console.log('[seed] This command will seed 12 sample workers, 8 sample customers, realistic bookings in all states, verified Passport chains, posts, follows, endorsements, and live Free Now windows.');
    console.log('[seed] To execute the seed, re-run with: npm run seed -- --yes');
    process.exit(0);
  }

  try {
    await connectDB(config.MONGODB_URI);
    const assetsDir = path.resolve(ROOT, 'frontend', 'assets', 'sample');
    await runSeed(config, { assetsDir });
  } catch (err) {
    console.error(`[seed] FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

main();
