import mongoose from '../backend/node_modules/mongoose/index.js';
import { validateEnv } from '../backend/src/config/env.js';
import { connectDB, disconnectDB } from '../backend/src/config/db.js';
import { removeSampleData, assertSeedSafety } from '../backend/src/seed/runner.js';

async function main() {
  const args = process.argv.slice(2);
  const isYes = args.includes('--yes');

  const config = validateEnv(process.env);
  const { dbName } = assertSeedSafety(config);

  if (!isYes) {
    console.log(`[seed-remove] DRY RUN: Target database is "${dbName}".`);
    console.log('[seed-remove] This command will delete only sample data (isSample true and dependent sample records). Real user data will never be touched.');
    console.log('[seed-remove] To execute removal, re-run with: npm run seed:remove -- --yes');
    process.exit(0);
  }

  try {
    await connectDB(config.MONGODB_URI);
    await removeSampleData(config);
    console.log('[seed-remove] Finished removing sample data successfully.');
  } catch (err) {
    console.error(`[seed-remove] FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

main();
