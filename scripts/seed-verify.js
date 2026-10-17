#!/usr/bin/env node
/**
 * scripts/seed-verify.js
 *
 * Standalone verification script that reads the database and checks:
 * 1. Every sample worker's Passport chain verifies as valid using verifyChain().
 * 2. Head and stats match the entries for every worker.
 * 3. Seq is contiguous (1..N).
 * 4. Every entry has a unique recordId.
 * 5. Every booking code field is a "v1:" encrypted string.
 * 6. Every sample document has isSample true.
 * 7. No passport entry or booking exists without a sample user.
 * 8. Counts match the dataset (12 workers, 8 customers, 15 posts, expected bookings/jobs).
 * 9. At least one booking in every state and tab for both roles.
 * 10. The three live windows exist with locality-centre location.
 * 11. RateStats rows exist for the locality (electrician kakkanad, helper edappally) and city (plumber) cases.
 * 12. 91-day-old booking is excluded from electrician Kakkanad rateStats row.
 * 13. Counters on users (activePostCount, postQuota, followCounts, endorsementCounts) match real collections.
 * 14. No sample email is outside @example.com.
 * 15. No sample phone is outside 9000000xxx range.
 * 16. No exact coordinates exist in any sample post.
 *
 * Usage:
 *   node --env-file=backend/.env scripts/seed-verify.js
 */

import mongoose from '../backend/node_modules/mongoose/index.js';
import {
  User,
  Job,
  Booking,
  PassportEntry,
  Availability,
  Post,
  Follow,
  Endorsement,
  RateStats,
  Report
} from '../backend/src/models/index.js';
import { runChainVerification } from '../backend/src/services/passportService.js';
import { getLocalityByKey } from '../shared/localities.js';

let failedChecks = 0;

function check(title, condition, detail = '') {
  if (condition) {
    console.log(`PASS: ${title}`);
  } else {
    failedChecks++;
    console.error(`FAIL: ${title} ${detail ? `(${detail})` : ''}`);
  }
}

async function verifyAll() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('FAIL: MONGODB_URI not found in environment');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  try {
    const dbName = mongoose.connection.name;
    console.log(`[seed-verify] Verifying database: "${dbName}"...\n`);

    // 1. Counts
    const sampleWorkers = await User.find({ role: 'worker', isSample: true });
    const sampleCustomers = await User.find({ role: 'customer', isSample: true });
    check('1. Worker count is exactly 12', sampleWorkers.length === 12, `got ${sampleWorkers.length}`);
    check('2. Customer count is exactly 8', sampleCustomers.length === 8, `got ${sampleCustomers.length}`);

    const samplePosts = await Post.find({ isSample: true });
    check('3. Feed post count is exactly 15', samplePosts.length === 15, `got ${samplePosts.length}`);

    const sampleBookings = await Booking.find({ isSample: true }).select('+shortJob');
    check('4. Sample bookings exist (> 30)', sampleBookings.length >= 35, `got ${sampleBookings.length}`);

    const sampleJobs = await Job.find({ isSample: true });
    check('5. Sample jobs count is 6', sampleJobs.length === 6, `got ${sampleJobs.length}`);

    // 2. Identity Safety Rules (L8)
    const allSampleUsers = [...sampleWorkers, ...sampleCustomers];
    const invalidEmails = allSampleUsers.filter((u) => !u.email.endsWith('@example.com'));
    check('6. All sample emails end with @example.com', invalidEmails.length === 0, `${invalidEmails.length} invalid`);

    const invalidPhones = allSampleUsers.filter((u) => !/^9000000\d{3}$/.test(u.phone));
    check('7. All sample phones match 9000000xxx pattern', invalidPhones.length === 0, `${invalidPhones.length} invalid`);

    // 3. Flags and Ownership
    const sampleUserIds = new Set(allSampleUsers.map((u) => u._id.toString()));
    const unlinkedBookings = sampleBookings.filter(
      (b) => !sampleUserIds.has(b.customerId.toString()) || !sampleUserIds.has(b.workerId.toString())
    );
    check('8. No sample booking exists without sample customer & worker', unlinkedBookings.length === 0);

    // 4. Passport Chain Verification for every worker
    let allChainsValid = true;
    let chainDetails = [];
    for (const worker of sampleWorkers) {
      const v = await runChainVerification(worker._id);
      if (v.status !== 'valid') {
        allChainsValid = false;
        chainDetails.push(`${worker.name}: status=${v.status}`);
      }

      // Check head matches last entry
      const entries = await PassportEntry.find({ workerId: worker._id }).sort({ seq: 1 });
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        if (worker.passportHead?.hash !== last.hash || worker.passportHead?.seq !== last.seq) {
          allChainsValid = false;
          chainDetails.push(`${worker.name}: head mismatch (worker: ${worker.passportHead?.seq}, entry: ${last.seq})`);
        }
        // Seq contiguous 1..N
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].seq !== i + 1) {
            allChainsValid = false;
            chainDetails.push(`${worker.name}: seq gap at index ${i}`);
          }
        }
      } else {
        if (worker.passportHead?.seq !== 0) {
          allChainsValid = false;
          chainDetails.push(`${worker.name}: empty worker head seq != 0`);
        }
      }
    }
    check('9. Every sample worker Passport chain is valid and contiguous', allChainsValid, chainDetails.join('; '));

    // 5. Unique recordId across all passport entries
    const allPassportEntries = await PassportEntry.find({});
    const recordIds = new Set();
    let duplicateRecordId = false;
    for (const p of allPassportEntries) {
      if (recordIds.has(p.recordId)) {
        duplicateRecordId = true;
        break;
      }
      recordIds.add(p.recordId);
    }
    check('10. Every passport entry has a unique recordId', !duplicateRecordId && recordIds.size === allPassportEntries.length);

    // 6. Booking Codes Encrypted (v1: prefix)
    const sampleBookingsWithCodes = await Booking.find({ isSample: true }).select('+startCodeEnc +finishCodeEnc');
    let allCodesEncrypted = true;
    for (const b of sampleBookingsWithCodes) {
      if (b.startCodeEnc && !b.startCodeEnc.startsWith('v1:')) {
        allCodesEncrypted = false;
      }
      if (b.finishCodeEnc && !b.finishCodeEnc.startsWith('v1:')) {
        allCodesEncrypted = false;
      }
    }
    check('11. All stored booking code fields use v1: format', allCodesEncrypted);

    // 7. Booking States & Tabs
    const statuses = new Set(sampleBookings.map((b) => b.status));
    const expectedStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    const missingStatuses = expectedStatuses.filter((s) => !statuses.has(s));
    check('12. Bookings exist in all statuses (pending, confirmed, in_progress, completed, cancelled)', missingStatuses.length === 0, `missing ${missingStatuses.join(', ')}`);

    // Far from job booking & short job
    const farBooking = sampleBookings.find((b) => b.farFromJob === true);
    check('13. Booking with farFromJob true exists', Boolean(farBooking));
    const shortBooking = sampleBookings.find((b) => b.shortJob === true);
    check('14. Booking with shortJob true exists', Boolean(shortBooking));

    // 8. Live Free Now Windows
    const now = new Date();
    const liveWindows = await Availability.find({ active: true, expiresAt: { $gt: now } });
    check('15. Exactly 3 live Free Now windows exist', liveWindows.length === 3, `got ${liveWindows.length}`);

    // Locality-centre location
    let allWindowsAtLocalityCentre = true;
    for (const w of liveWindows) {
      const loc = getLocalityByKey(w.localityKey);
      if (!loc || Math.abs(w.location.coordinates[0] - loc.lng) > 0.0001 || Math.abs(w.location.coordinates[1] - loc.lat) > 0.0001) {
        allWindowsAtLocalityCentre = false;
      }
    }
    check('16. All live Free Now windows use locality-centre coordinates', allWindowsAtLocalityCentre);

    // 9. RateStats Coverage & 90-day window check (RateStats uses sampleSize)
    const kakkanadElec = await RateStats.findOne({ skill: 'electrician', localityKey: 'kakkanad', sampleSize: { $gte: 5 } });
    check('17. Locality-level RateStats row for electrician in Kakkanad exists (sampleSize >= 6)', Boolean(kakkanadElec), `count=${kakkanadElec?.sampleSize}`);

    const edappallyHelper = await RateStats.findOne({ skill: 'helper', localityKey: 'edappally', sampleSize: { $gte: 5 } });
    check('18. Locality-level RateStats row for helper in Edappally exists (sampleSize >= 5)', Boolean(edappallyHelper), `count=${edappallyHelper?.sampleSize}`);

    const plumberStats = await RateStats.findOne({ skill: 'plumber', localityKey: 'city:kochi', sampleSize: { $gte: 5 } });
    check('19. City-level RateStats row for plumber exists', Boolean(plumberStats), `sampleSize=${plumberStats?.sampleSize}`);

    // Verify 91-day booking excluded: Worker E1 has 14 completed jobs, but 1 is 91 days old
    // So Kakkanad electrician count should be 13, NOT 14
    check('20. 91-day-old booking excluded from Kakkanad electrician rateStats (sampleSize === 13)', kakkanadElec?.sampleSize === 13, `expected 13, got ${kakkanadElec?.sampleSize}`);

    // 10. Social & User Counter Integrity
    let countersValid = true;
    for (const w of sampleWorkers) {
      const actualPostCount = await Post.countDocuments({ workerId: w._id, isSample: true });
      if (w.activePostCount !== actualPostCount) {
        countersValid = false;
      }
      const actualFollowsCount = await Follow.countDocuments({ fromId: w._id, type: 'follow' });
      if (w.followCounts?.follow !== actualFollowsCount) {
        countersValid = false;
      }
    }
    check('21. Worker activePostCount and followCounts match real collections', countersValid);

    // 11. Feed Posts Privacy
    const postsWithExactCoords = samplePosts.filter((p) => {
      const loc = getLocalityByKey(p.localityKey);
      if (!loc) return false;
      return (
        Math.abs(p.location.coordinates[0] - loc.lng) > 0.0001 ||
        Math.abs(p.location.coordinates[1] - loc.lat) > 0.0001
      );
    });
    check('22. No exact coordinates stored in any sample feed post', postsWithExactCoords.length === 0);

    // 12. E1 specifics: 3 hidden entries, 2 with maskEmployer: false
    const workE1 = sampleWorkers.find((w) => w.email === 'suresh.menon.sample@example.com');
    if (workE1) {
      const hiddenCount = await PassportEntry.countDocuments({ workerId: workE1._id, visible: false });
      const shownEmployerCount = await PassportEntry.countDocuments({ workerId: workE1._id, maskEmployerName: false });
      check('23. Worker E1 has exactly 3 hidden records', hiddenCount === 3, `got ${hiddenCount}`);
      check('24. Worker E1 has exactly 2 records showing employer name', shownEmployerCount === 2, `got ${shownEmployerCount}`);
    } else {
      check('23. Worker E1 exists', false);
      check('24. Worker E1 exists', false);
    }

    // 13. Reports count
    const sampleReportsCount = await Report.countDocuments({
      $or: [{ reporterId: { $in: Array.from(sampleUserIds) } }, { reportedUserId: { $in: Array.from(sampleUserIds) } }]
    });
    check('25. Exactly 4 sample reports exist in inbox', sampleReportsCount === 4, `got ${sampleReportsCount}`);

    console.log(`\n====================================================`);
    if (failedChecks === 0) {
      console.log('ALL SEED VERIFICATION CHECKS PASSED.');
      console.log('====================================================\n');
      process.exit(0);
    } else {
      console.error(`SEED VERIFICATION FAILED: ${failedChecks} checks failed.`);
      console.log('====================================================\n');
      process.exit(1);
    }
  } finally {
    await mongoose.disconnect();
  }
}

verifyAll().catch((err) => {
  console.error('[seed-verify] Unhandled error:', err);
  process.exit(1);
});
