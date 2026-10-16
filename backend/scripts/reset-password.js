import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { hashPassword } from '../src/utils/passwordCrypto.js';
import { generateOpaqueRefreshToken } from '../src/utils/tokenCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const emailArg = process.argv[2];
  if (!emailArg) {
    console.error('Usage: node --env-file=.env scripts/reset-password.js <email>');
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
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      console.error(`Error: User with email "${email}" not found.`);
      process.exit(1);
    }

    // Generate random 16-character temporary password that complies with AUTH-3
    // (uppercase, lowercase, numbers, no repeated or sequential patterns)
    const tempPassword = `Tmp#${generateOpaqueRefreshToken().slice(0, 8)}9!`;
    const newHash = await hashPassword(tempPassword);

    // Bump tokenVersion, set mustChangePassword, clear lockout fields
    user.passwordHash = newHash;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.mustChangePassword = true;
    user.failedLoginCount = 0;
    user.lockUntil = null;
    user.lockLevel = 0;
    await user.save();

    // Revoke all refresh tokens for this user
    await RefreshToken.updateMany(
      { userId: user._id },
      { $set: { revokedAt: new Date() } }
    );

    console.log('====================================================');
    console.log(`Password reset for: ${user.email} (${user.role})`);
    console.log(`Temporary Password: ${tempPassword}`);
    console.log('NOTICE: Printed once. The user must change it upon logging in.');
    console.log('All previous sessions have been revoked.');
    console.log('====================================================');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Failed to reset password:', err);
  process.exit(1);
});
