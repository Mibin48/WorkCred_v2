import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error('Usage: node --env-file=.env scripts/unlock-account.js <email>');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not defined in environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`Error: User with email "${email}" not found.`);
      process.exit(1);
    }

    user.failedLoginCount = 0;
    user.lockUntil = null;
    user.lockLevel = 0;
    await user.save();

    console.log('====================================================');
    console.log(`Account unlocked successfully for: ${user.email} (${user.role})`);
    console.log('failedLoginCount, lockUntil, and lockLevel have been reset to 0/null.');
    console.log('====================================================');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Failed to unlock account:', err);
  process.exit(1);
});
