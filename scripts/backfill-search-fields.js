import mongoose from 'mongoose';
import { User } from '../backend/src/models/User.js';
import { getLocalityByKey } from '../shared/localities.js';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required. Run with: node --env-file=.env scripts/backfill-search-fields.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB. Starting backfill...');

  const workers = await User.find({ role: 'worker' });
  let updatedCount = 0;

  for (const worker of workers) {
    let changed = false;

    // 1. rateHourlyEffective (G1)
    const effective = (worker.hourlyRate && worker.hourlyRate > 0)
      ? worker.hourlyRate
      : (worker.dailyRate && worker.dailyRate > 0 ? Math.round(worker.dailyRate / 8) : 0);

    if (worker.rateHourlyEffective !== effective) {
      worker.rateHourlyEffective = effective;
      changed = true;
    }

    // 2. mainSkill (G3)
    if (Array.isArray(worker.skills) && worker.skills.length > 0) {
      if (!worker.mainSkill || !worker.skills.includes(worker.mainSkill)) {
        worker.mainSkill = worker.skills[0];
        changed = true;
      }
    }

    // 3. searchLocation (G2)
    if (worker.localityKey) {
      const loc = getLocalityByKey(worker.localityKey);
      if (loc) {
        const coords = [loc.lng, loc.lat];
        if (
          !worker.searchLocation ||
          !worker.searchLocation.coordinates ||
          worker.searchLocation.coordinates[0] !== coords[0] ||
          worker.searchLocation.coordinates[1] !== coords[1]
        ) {
          worker.searchLocation = {
            type: 'Point',
            coordinates: coords
          };
          changed = true;
        }
      }
    }

    if (changed) {
      await worker.save();
      updatedCount++;
    }
  }

  console.log(`Backfill complete: ${updatedCount} worker(s) updated out of ${workers.length} total worker(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
