/**
 * backend/src/seed/runner.js – Core seed & reset orchestration module.
 *
 * Enforces:
 * - Safety checks (L5): refuses production, refuses "prod" or "live" DB names, requires DEMO_PASSWORD.
 * - Deterministic pseudo-random generation (L4).
 * - Real services and injectable clock (L2).
 * - Reset only deletes sample data by isSample true and sample user ownership (L5).
 * - Progress logging and summary table (L2, L5).
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  User,
  Job,
  Booking,
  PassportEntry,
  Availability,
  Post,
  Follow,
  Endorsement,
  Report,
  RateStats,
  RefreshToken,
  IdempotencyKey
} from '../models/index.js';
import { hashPassword } from '../utils/passwordCrypto.js';
import { withClock } from './clockTravel.js';
import { ensureSamplePlaceholderImages } from './placeholders.js';
import {
  createRng,
  SAMPLE_WORKERS,
  SAMPLE_CUSTOMERS,
  COMPLETED_BOOKINGS_PLAN,
  validateDatasetSanity
} from './dataset.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { createDirectBooking, getBookingCodes, startBooking, finishBooking } from '../services/bookingService.js';
import { patchPassportEntry } from '../services/passportService.js';
import { startFreeNowWindow } from '../services/freeNowService.js';
import { createPost } from '../services/postService.js';
import { createFollow } from '../services/followService.js';
import { createEndorsement } from '../services/endorsementService.js';
import { createReport } from '../services/reportService.js';
import { recomputeRateStats } from '../services/compassService.js';
import { clock } from '../utils/clock.js';
import { encryptCode } from '../../../shared/codesCrypto.js';

/**
 * Validates safety requirements (L5).
 * @param {object} config
 */
export function assertSeedSafety(config) {
  const nodeEnv = String(config.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('Safety guard: Seed and reset are strictly forbidden when NODE_ENV is production');
  }

  const mongoUri = String(config.MONGODB_URI || '').trim();
  const uriDbName = (mongoUri.split('/').pop() || '').split('?')[0];
  const dbName = uriDbName || mongoose.connection.name || '';

  if (dbName.toLowerCase().includes('prod') || dbName.toLowerCase().includes('live')) {
    throw new Error(`Safety guard: Refusing to seed or reset database containing 'prod' or 'live' in its name: "${dbName}"`);
  }

  if (!config.DEMO_PASSWORD || config.DEMO_PASSWORD.length < 12) {
    throw new Error('Safety guard: DEMO_PASSWORD must be set in environment and be at least 12 characters');
  }

  return { dbName };
}

/**
 * Checks whether sample data currently exists.
 * @returns {Promise<boolean>}
 */
export async function hasSampleData() {
  const count = await User.countDocuments({ isSample: true });
  return count > 0;
}

/**
 * Removes ONLY sample data by isSample flag and by ownership (L5).
 * Never drops collections, never touches real user data.
 */
export async function removeSampleData(config, options = {}) {
  const { dbName } = assertSeedSafety(config);
  const log = options.log || console.log;

  // Find all sample users
  const sampleUsers = await User.find({ isSample: true }).select('_id');
  const sampleUserIds = sampleUsers.map((u) => u._id);

  log(`[Reset] Found ${sampleUserIds.length} sample users in database "${dbName}". Removing sample data...`);

  if (sampleUserIds.length === 0) {
    // Also clean up any orphaned sample jobs/bookings/posts
    await Job.deleteMany({ isSample: true });
    await Booking.deleteMany({ isSample: true });
    await Post.deleteMany({ isSample: true });
    log('[Reset] No sample users found. Cleaned up any orphaned sample records.');
    return { usersDeleted: 0 };
  }

  // Find sample bookings and jobs
  const sampleBookings = await Booking.find({
    $or: [{ isSample: true }, { workerId: { $in: sampleUserIds } }, { customerId: { $in: sampleUserIds } }]
  }).select('_id');
  const sampleBookingIds = sampleBookings.map((b) => b._id);

  const sampleJobs = await Job.find({
    $or: [{ isSample: true }, { customerId: { $in: sampleUserIds } }]
  }).select('_id');
  const sampleJobIds = sampleJobs.map((j) => j._id);

  const samplePosts = await Post.find({
    $or: [{ isSample: true }, { workerId: { $in: sampleUserIds } }]
  }).select('_id');
  const samplePostIds = samplePosts.map((p) => p._id);

  // Delete dependent records strictly owned by sample entities
  await Promise.all([
    PassportEntry.deleteMany({ workerId: { $in: sampleUserIds } }),
    Availability.deleteMany({ workerId: { $in: sampleUserIds } }),
    Follow.deleteMany({ $or: [{ fromId: { $in: sampleUserIds } }, { toId: { $in: sampleUserIds } }] }),
    Endorsement.deleteMany({ $or: [{ customerId: { $in: sampleUserIds } }, { workerId: { $in: sampleUserIds } }] }),
    Report.deleteMany({ $or: [{ reporterId: { $in: sampleUserIds } }, { reportedUserId: { $in: sampleUserIds } }, { targetId: { $in: [...samplePostIds, ...sampleBookingIds, ...sampleUserIds] } }] }),
    RefreshToken.deleteMany({ userId: { $in: sampleUserIds } }),
    IdempotencyKey.deleteMany({ userId: { $in: sampleUserIds } })
  ]);

  // Delete primary sample collections
  const delPosts = await Post.deleteMany({ _id: { $in: samplePostIds } });
  const delBookings = await Booking.deleteMany({ _id: { $in: sampleBookingIds } });
  const delJobs = await Job.deleteMany({ _id: { $in: sampleJobIds } });
  const delUsers = await User.deleteMany({ _id: { $in: sampleUserIds } });

  // Recompute RateStats to remove sample influence if any real bookings exist, or clear sample stats
  await RateStats.deleteMany({});
  const remainingCompletedBookings = await Booking.find({ status: 'completed' });
  for (const b of remainingCompletedBookings) {
    await recomputeRateStats(b.skill, b.localityKey || 'kakkanad', clock);
  }

  log(`[Reset] Successfully removed: ${delUsers.deletedCount} users, ${delBookings.deletedCount} bookings, ${delJobs.deletedCount} jobs, ${delPosts.deletedCount} posts.`);
  return {
    usersDeleted: delUsers.deletedCount,
    bookingsDeleted: delBookings.deletedCount,
    jobsDeleted: delJobs.deletedCount,
    postsDeleted: delPosts.deletedCount
  };
}

/**
 * Runs the complete deterministic seed process.
 *
 * @param {object} config Backend environment config
 * @param {object} [options] { log, assetsDir }
 */
export async function runSeed(config, options = {}) {
  const log = options.log || console.log;
  const { dbName } = assertSeedSafety(config);

  // 1. Sanity Check
  const sanity = validateDatasetSanity();
  if (!sanity.valid) {
    throw new Error(`Dataset sanity failure:\n${sanity.errors.join('\n')}`);
  }

  // 2. Check Idempotency (if sample data exists, exit without duplicating)
  const alreadySeeded = await hasSampleData();
  if (alreadySeeded) {
    log(`[Seed] Notice: Sample data already exists in database "${dbName}". Nothing modified.`);
    log('[Seed] To rebuild sample data cleanly, run: npm run demo:reset -- --yes');
    return { status: 'skipped', reason: 'already_seeded' };
  }

  log(`[Seed] Starting WorkCred deterministic seed on database "${dbName}"...`);

  // Ensure solid-colour PNG assets exist (L7)
  const assetsDir = options.assetsDir;
  ensureSamplePlaceholderImages(assetsDir);
  log('[Seed] Stage 1/9: Generated 6 placeholder work photos in frontend/assets/sample/');

  // Hash shared demo password once with real scrypt (L6)
  const demoPasswordHash = await hashPassword(config.DEMO_PASSWORD);

  const rng = createRng(42); // fixed seed (L4)
  const runNow = new Date(); // base time for all relative offsets

  // Maps to hold inserted user documents: key -> UserDoc
  const workersMap = new Map();
  const customersMap = new Map();

  // 3. Create Sample Workers (12 workers)
  log('[Seed] Stage 2/9: Creating 12 sample workers across Kochi localities...');
  for (const w of SAMPLE_WORKERS) {
    const loc = w.localityKey ? getLocalityByKey(w.localityKey) : null;
    const coords = loc ? [loc.lng, loc.lat] : [0, 0];
    const searchLocation = { type: 'Point', coordinates: coords };

    const workerDoc = await User.create({
      name: w.name,
      email: w.email,
      phone: w.phone,
      role: 'worker',
      passwordHash: demoPasswordHash,
      isActive: true,
      profileComplete: w.profileComplete,
      isSample: true,
      localityKey: w.localityKey || null,
      location: searchLocation,
      searchLocation,
      mainSkill: w.mainSkill || null,
      skills: w.skills || [],
      hourlyRate: w.hourlyRate || 0,
      dailyRate: w.dailyRate || 0,
      rateHourlyEffective: w.hourlyRate || (w.dailyRate ? Math.round(w.dailyRate / 8) : 0),
      radiusKm: w.radiusKm || 10,
      bio: w.bio || '',
      calendar: w.calendar || { weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' }, blockedDates: [] },
      passportStats: { jobs: 0, ratingSum: 0, avgRating: 0, totalHours: 0, skillCounts: {}, topSkills: [] },
      passportHead: { seq: 0, hash: 'GENESIS' }
    });

    workersMap.set(w.key, workerDoc);
  }

  // 4. Create Sample Customers (8 customers)
  log('[Seed] Stage 3/9: Creating 8 sample customers across Kochi localities...');
  for (const c of SAMPLE_CUSTOMERS) {
    const loc = c.localityKey ? getLocalityByKey(c.localityKey) : null;
    const coords = loc ? [loc.lng, loc.lat] : [0, 0];
    const searchLocation = { type: 'Point', coordinates: coords };

    const custDoc = await User.create({
      name: c.name,
      email: c.email,
      phone: c.phone,
      role: 'customer',
      passwordHash: demoPasswordHash,
      isActive: true,
      profileComplete: c.profileComplete,
      isSample: true,
      localityKey: c.localityKey || null,
      location: searchLocation,
      searchLocation
    });

    customersMap.set(c.key, custDoc);
  }

  // 5. Build Historical Completed Bookings, Passport Chains & RateStats (L2, L3)
  log('[Seed] Stage 4/9: Creating completed bookings and cryptographic Passport chains via real services...');

  // Sort bookings chronologically (oldest first) so seq & hash chaining build sequentially
  const sortedPlan = [...COMPLETED_BOOKINGS_PLAN].sort((a, b) => b.daysAgo - a.daysAgo);
  const createdCompletedBookings = [];

  for (let i = 0; i < sortedPlan.length; i++) {
    const item = sortedPlan[i];
    const worker = workersMap.get(item.workerKey);
    const customer = customersMap.get(item.customerKey);

    const bookingStartTime = new Date(runNow.getTime() - item.daysAgo * 24 * 60 * 60 * 1000);
    // Anchor to 10:00 AM IST (04:30 UTC) so bookings always fall cleanly inside daytime business hours
    bookingStartTime.setUTCHours(4, 30, 0, 0);
    const confirmTime = new Date(bookingStartTime.getTime() - 2 * 60 * 60 * 1000);
    const finishTime = new Date(bookingStartTime.getTime() + item.hours * 60 * 60 * 1000);

    let bookingId;
    let startCodeVal;
    let finishCodeVal;

    // (a) Clock = start minus 2 hours: Create direct booking and confirm
    await withClock(confirmTime, async () => {
      const summary = await createDirectBooking(
        {
          workerId: worker._id.toString(),
          scheduledAt: bookingStartTime.toISOString(),
          hours: item.hours,
          note: `Standard service for ${item.skill}`
        },
        customer,
        config,
        clock
      );
      bookingId = summary.id;

      // Confirm booking
      await Booking.updateOne({ _id: bookingId }, { $set: { status: 'confirmed' } });

      // Decrypt codes
      const codes = await getBookingCodes(bookingId, customer, config, clock);
      startCodeVal = codes.startCode;
      finishCodeVal = codes.finishCode;
    });

    // (b) Clock = start: Worker starts booking
    await withClock(bookingStartTime, async () => {
      await startBooking(bookingId, { code: startCodeVal }, worker, config, clock);
    });

    // (c) Clock = finish: Customer finishes booking with finish code, rating and comment
    let receipt;
    await withClock(finishTime, async () => {
      receipt = await finishBooking(
        bookingId,
        {
          finishCode: finishCodeVal,
          paidCash: true,
          rating: item.rating,
          comment: item.comment
        },
        customer,
        config,
        clock
      );
    });

    // If item specified custom localityKey for plumber city spread, update booking localityKey
    if (item.localityKey && item.localityKey !== worker.localityKey) {
      await Booking.updateOne({ _id: bookingId }, { $set: { localityKey: item.localityKey } });
      await withClock(finishTime, async () => {
        await recomputeRateStats(item.skill, item.localityKey, clock);
      });
    }

    // Adjust visibility and employer display if requested in plan
    if (item.visible === false || item.maskEmployer === false) {
      await withClock(finishTime, async () => {
        await patchPassportEntry(
          receipt.recordId,
          {
            ...(item.visible === false ? { visible: false } : {}),
            ...(item.maskEmployer === false ? { maskEmployerName: false } : {})
          },
          worker
        );
      });
    }

    createdCompletedBookings.push({ bookingId, workerKey: item.workerKey, skill: item.skill, daysAgo: item.daysAgo });
  }

  // 6. Create Current & Active Booking States for "Busy Customer" and Workers
  log('[Seed] Stage 5/9: Creating active booking states across tabs (pending, confirmed, in-progress, cancelled, missed, far-from-job)...');
  const custBusy = customersMap.get('CUST_BUSY');
  const workE1 = workersMap.get('E1');
  const workE2 = workersMap.get('E2');
  const workP1 = workersMap.get('P1');
  const workH1 = workersMap.get('H1');
  const workM1 = workersMap.get('M1');

  // (1) Pending booking in the future (scheduled tomorrow at 10:00 AM)
  const tomorrowDaytime = new Date(runNow.getTime() + 24 * 60 * 60 * 1000);
  tomorrowDaytime.setUTCHours(4, 30, 0, 0); // 10:00 AM IST
  await withClock(runNow, async () => {
    await createDirectBooking(
      {
        workerId: workE1._id.toString(),
        scheduledAt: tomorrowDaytime.toISOString(),
        hours: 2,
        note: 'Living room switch repair tomorrow'
      },
      custBusy,
      config,
      clock
    );
  });

  // (2) Pending but past start (reads as expired)
  const pastPendingTime = new Date(runNow.getTime() - 4 * 60 * 60 * 1000); // 4 hours ago
  const bookingExpiredPending = await Booking.create({
    customerId: custBusy._id,
    workerId: workP1._id,
    skill: 'plumber',
    localityKey: workP1.localityKey,
    agreedRate: workP1.rateHourlyEffective || 135,
    scheduledAt: pastPendingTime,
    hours: 2,
    status: 'pending',
    source: 'direct',
    note: 'Request that was never answered',
    isSample: true,
    startCodeEnc: encryptCode('1111', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'start'),
    finishCodeEnc: encryptCode('2222', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'finish'),
    locationSnapshot: workP1.location
  });

  // (3) Confirmed booking in the future (tomorrow afternoon at 2:00 PM IST)
  const tomorrowAfternoon = new Date(runNow.getTime() + 24 * 60 * 60 * 1000);
  tomorrowAfternoon.setUTCHours(8, 30, 0, 0); // 2:00 PM IST
  let confirmedFutureId;
  await withClock(runNow, async () => {
    const book = await createDirectBooking(
      {
        workerId: workH1._id.toString(),
        scheduledAt: tomorrowAfternoon.toISOString(),
        hours: 3,
        note: 'Garden cleaning assistance'
      },
      custBusy,
      config,
      clock
    );
    confirmedFutureId = book.id;
    await Booking.updateOne({ _id: confirmedFutureId }, { $set: { status: 'confirmed' } });
  });

  // (4) Confirmed booking with window that ended unused (reads as missed)
  const pastMissedTime = new Date(runNow.getTime() - 6 * 60 * 60 * 1000);
  await Booking.create({
    customerId: custBusy._id,
    workerId: workM1._id,
    skill: 'mason',
    localityKey: workM1.localityKey,
    agreedRate: workM1.rateHourlyEffective || 145,
    scheduledAt: pastMissedTime,
    hours: 2, // window ended 4 hours ago
    status: 'confirmed',
    source: 'direct',
    note: 'Confirmed appointment that was missed',
    isSample: true,
    startCodeEnc: encryptCode('3333', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'start'),
    finishCodeEnc: encryptCode('4444', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'finish'),
    locationSnapshot: workM1.location
  });

  // (5) In-progress booking (started 40 minutes ago, customer able to finish)
  const inProgressStart = new Date(runNow.getTime() - 40 * 60 * 1000);
  let inProgressBookingId;
  await withClock(new Date(inProgressStart.getTime() - 30 * 60 * 1000), async () => {
    const res = await createDirectBooking(
      {
        workerId: workE2._id.toString(),
        scheduledAt: inProgressStart.toISOString(),
        hours: 2,
        note: 'Urgent panel wiring'
      },
      custBusy,
      config,
      clock
    );
    inProgressBookingId = res.id;
    await Booking.updateOne({ _id: inProgressBookingId }, { $set: { status: 'confirmed' } });
    const codes = await getBookingCodes(inProgressBookingId, custBusy, config, clock);
    await startBooking(inProgressBookingId, { code: codes.startCode }, workE2, config, clock);
  });

  // (6) Booking cancelled by customer (scheduled 3 days ahead at 11:00 AM IST)
  const threeDaysAhead = new Date(runNow.getTime() + 3 * 24 * 60 * 60 * 1000);
  threeDaysAhead.setUTCHours(5, 30, 0, 0); // 11:00 AM IST
  await withClock(runNow, async () => {
    const book = await createDirectBooking(
      {
        workerId: workP1._id.toString(),
        scheduledAt: threeDaysAhead.toISOString(),
        hours: 2,
        note: 'Customer had to reschedule'
      },
      custBusy,
      config,
      clock
    );
    await Booking.updateOne({ _id: book.id }, { $set: { status: 'cancelled', cancelledBy: 'customer', cancelReason: 'Schedule conflict' } });
  });

  // (7) Worker E2 with 2 confirmed cancellations in last 30 days (so 3rd triggers warning)
  const tenDaysAgo = new Date(runNow.getTime() - 10 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(runNow.getTime() - 5 * 24 * 60 * 60 * 1000);
  await User.updateOne(
    { _id: workE2._id },
    { $set: { cancelledConfirmedAt: [tenDaysAgo, fiveDaysAgo] } }
  );

  // (8) One booking with farFromJob true and one shortJob completed
  const farBooking = await Booking.create({
    customerId: custBusy._id,
    workerId: workP1._id,
    skill: 'plumber',
    localityKey: 'vyttila',
    agreedRate: 135,
    scheduledAt: new Date(runNow.getTime() - 2 * 24 * 60 * 60 * 1000),
    hours: 1,
    status: 'completed',
    source: 'direct',
    startedAt: new Date(runNow.getTime() - 2 * 24 * 60 * 60 * 1000),
    finishedAt: new Date(runNow.getTime() - 2 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000), // 10 min -> shortJob true
    hoursWorked: 0.17,
    shortJob: true,
    farFromJob: true,
    paidCash: true,
    rating: 5,
    comment: 'Quick tap washer replacement',
    isSample: true,
    startCodeEnc: encryptCode('5555', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'start'),
    finishCodeEnc: encryptCode('6666', config.CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'finish'),
    locationSnapshot: workP1.location
  });

  // 7. Create Sample Jobs (3 open future, 1 filled, 1 cancelled, 1 expired)
  log('[Seed] Stage 6/9: Creating sample jobs (open, filled, cancelled, expired)...');
  const futureJobStart1 = new Date(runNow.getTime() + 36 * 60 * 60 * 1000);
  const futureJobStart2 = new Date(runNow.getTime() + 48 * 60 * 60 * 1000);
  const futureJobStart3 = new Date(runNow.getTime() + 72 * 60 * 60 * 1000);

  // Job 1: Open future job (2 slots, 1 accepted)
  const locKakkanad = getLocalityByKey('kakkanad');
  const job1 = await Job.create({
    customerId: custBusy._id,
    skill: 'helper',
    workersNeeded: 2,
    acceptedCount: 1,
    hours: 4,
    startAt: futureJobStart1,
    offeredRate: 95, // fair
    description: 'Need two helpers for loading and shifting home furniture to first floor.',
    localityKey: 'kakkanad',
    location: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    searchLocation: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    status: 'open',
    isSample: true
  });

  // Job 2: Open job with long description (~280 chars) and high rate
  const job2 = await Job.create({
    customerId: custBusy._id,
    skill: 'electrician',
    workersNeeded: 1,
    acceptedCount: 0,
    hours: 5,
    startAt: futureJobStart2,
    offeredRate: 180, // high
    description: 'Complete commercial office lighting setup including track lights, false ceiling LED strips, emergency backup inverter lines, and three-phase server room dedicated circuit breakers with proper earth leakage protection.',
    localityKey: 'kakkanad',
    location: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    searchLocation: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    status: 'open',
    isSample: true
  });

  // Job 3: Open job with low rate
  const job3 = await Job.create({
    customerId: customersMap.get('CUST_3')._id,
    skill: 'painter',
    workersNeeded: 1,
    acceptedCount: 0,
    hours: 6,
    startAt: futureJobStart3,
    offeredRate: 80, // low
    description: 'Single bedroom interior primer coating and wall cleaning.',
    localityKey: 'kaloor',
    location: { type: 'Point', coordinates: [76.2975, 9.9939] },
    searchLocation: { type: 'Point', coordinates: [76.2975, 9.9939] },
    status: 'open',
    isSample: true
  });

  // Job 4: Filled job
  const job4 = await Job.create({
    customerId: custBusy._id,
    skill: 'plumber',
    workersNeeded: 1,
    acceptedCount: 1,
    hours: 3,
    startAt: new Date(runNow.getTime() + 18 * 60 * 60 * 1000),
    offeredRate: 130,
    description: 'Bathroom mixer fixture replacement.',
    localityKey: 'kakkanad',
    location: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    searchLocation: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    status: 'filled',
    isSample: true
  });

  // Job 5: Cancelled job
  await Job.create({
    customerId: custBusy._id,
    skill: 'mason',
    workersNeeded: 1,
    acceptedCount: 0,
    hours: 4,
    startAt: new Date(runNow.getTime() + 50 * 60 * 60 * 1000),
    offeredRate: 140,
    description: 'Plastering work cancelled due to rain.',
    localityKey: 'kakkanad',
    location: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    searchLocation: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    status: 'cancelled',
    isSample: true
  });

  // Job 6: Expired job (start in the past)
  await Job.create({
    customerId: custBusy._id,
    skill: 'carpenter',
    workersNeeded: 1,
    acceptedCount: 0,
    hours: 2,
    startAt: new Date(runNow.getTime() - 24 * 60 * 60 * 1000),
    offeredRate: 135,
    description: 'Door lock adjustment past date.',
    localityKey: 'kakkanad',
    location: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    searchLocation: { type: 'Point', coordinates: [locKakkanad.lng, locKakkanad.lat] },
    status: 'expired',
    isSample: true
  });

  // 8. Create Free Now Windows (3 live, 1 expired, 1 blocked today)
  log('[Seed] Stage 7/9: Creating Free Now availability windows (3 live windows: ~7h, ~3h, ~40m)...');
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

  // Worker M1: Expired window (started 5 hours ago for 4 hours)
  const m1Loc = getLocalityByKey(workM1.localityKey);
  await Availability.create({
    workerId: workM1._id,
    localityKey: workM1.localityKey,
    location: { type: 'Point', coordinates: [m1Loc.lng, m1Loc.lat] },
    skills: workM1.skills,
    rateHourly: workM1.rateHourlyEffective || 145,
    startsAt: new Date(runNow.getTime() - 5 * 60 * 60 * 1000),
    expiresAt: new Date(runNow.getTime() - 1 * 60 * 60 * 1000),
    active: false,
    closedReason: 'expired',
    closedAt: new Date(runNow.getTime() - 1 * 60 * 60 * 1000)
  });

  // Worker PA1: Blocked date today
  const todayDateStr = runNow.toISOString().slice(0, 10);
  await User.updateOne(
    { _id: workersMap.get('PA1')._id },
    { $set: { 'calendar.blockedDates': [{ date: todayDateStr, reason: 'Family function' }] } }
  );

  // 9. Create Sample Posts, Follows, Endorsements, and Reports (L7, L8, L9)
  log('[Seed] Stage 8/9: Creating 15 sample posts, follows, endorsements, and moderation reports...');

  // 15 Sample Posts by 7 workers over last 20 days
  // 4 verified jobs linked to own completed bookings, 3 with before/after photos, captions 40-140 chars
  const postSpecs = [
    // Post 1 (Worker E1 - verified job)
    { workerKey: 'E1', skill: 'electrician', caption: 'Complete 3-phase distribution box rewiring with individual MCB and RCCB safety protection installed.', before: true, daysAgo: 18, verifiedBookingIdx: 3 },
    // Post 2 (Worker E1 - verified job)
    { workerKey: 'E1', skill: 'electrician', caption: 'Submersible water pump motor automatic starter panel installed with overload relay safety.', before: false, daysAgo: 15, verifiedBookingIdx: 7 },
    // Post 3 (Worker E1 - unverified)
    { workerKey: 'E1', skill: 'electrician', caption: 'Living room ambient profile LED lighting and chandelier setup completed cleanly.', before: false, daysAgo: 12 },
    // Post 4 (Worker E1 - exactly 140 chars)
    { workerKey: 'E1', skill: 'electrician', caption: 'Main electrical distribution panel upgraded with commercial grade copper busbars, surge protectors, and digital meters in Kakkanad hub site.', before: true, daysAgo: 8 },
    // Post 5 (Worker P1 - verified job)
    { workerKey: 'P1', skill: 'plumber', caption: 'Commercial multi-story concealed pipeline pressure testing and leak isolation completed.', before: false, daysAgo: 16, verifiedBookingIdx: 15 },
    // Post 6 (Worker P1 - unverified)
    { workerKey: 'P1', skill: 'plumber', caption: 'Overhead 1000L water tank multi-point distribution valve overhaul.', before: true, daysAgo: 10 },
    // Post 7 (Worker H1 - verified job)
    { workerKey: 'H1', skill: 'helper', caption: 'Warehouse heavy cargo palletizing and systematic inventory shifting job.', before: false, daysAgo: 14, verifiedBookingIdx: 14 },
    // Post 8 (Worker H1 - unverified)
    { workerKey: 'H1', skill: 'helper', caption: 'Construction site tile clearance and ground leveling assistance done.', before: false, daysAgo: 9 },
    // Post 9 (Worker M1)
    { workerKey: 'M1', skill: 'mason', caption: 'Exterior boundary wall structural crack repair and smooth finish cement plastering.', before: false, daysAgo: 11 },
    // Post 10 (Worker PA1)
    { workerKey: 'PA1', skill: 'painter', caption: 'Full interior acrylic emulsion two-coat painting with smooth waterproof primer base.', before: false, daysAgo: 7 },
    // Post 11 (Worker C1)
    { workerKey: 'C1', skill: 'carpenter', caption: 'Custom teak wood kitchen cabinet doors realignment and soft-close hinges installation.', before: false, daysAgo: 6 },
    // Post 12 (Worker D1)
    { workerKey: 'D1', skill: 'driver', caption: 'Commercial multi-stop inventory relocation and transport across Kochi hub completed smoothly.', before: false, daysAgo: 5 },
    // Post 13 (Worker E2)
    { workerKey: 'E2', skill: 'electrician', caption: 'Outdoor garden spike lights and waterproof junction box cabling work.', before: false, daysAgo: 4 },
    // Post 14 (Worker P2)
    { workerKey: 'P2', skill: 'plumber', caption: 'Bathroom concealed cistern flush mechanism replacement and pipeline fixing.', before: false, daysAgo: 2 },
    // Post 15 (Worker E1 - shares createdAt with Post 14 to test cursor tie-breaking)
    { workerKey: 'E1', skill: 'electrician', caption: 'Backup inverter battery wiring and changeover switch connection checked.', before: false, daysAgo: 2 }
  ];

  const createdPosts = [];
  for (let idx = 0; idx < postSpecs.length; idx++) {
    const spec = postSpecs[idx];
    const worker = workersMap.get(spec.workerKey);
    const postCreatedAt = new Date(runNow.getTime() - spec.daysAgo * 24 * 60 * 60 * 1000);

    const afterImgNum = ((idx % 6) + 1);
    const beforeImgNum = (((idx + 1) % 6) + 1);
    const afterUrl = `/assets/sample/work-${afterImgNum}.png`;
    const beforeUrl = spec.before ? `/assets/sample/work-${beforeImgNum}.png` : null;

    let linkedBookingId = null;
    let verifiedJob = false;

    if (spec.verifiedBookingIdx !== undefined) {
      const bObj = createdCompletedBookings[spec.verifiedBookingIdx];
      if (bObj && bObj.workerKey === spec.workerKey && bObj.skill === spec.skill) {
        linkedBookingId = bObj.bookingId;
        verifiedJob = true;
      }
    }

    const loc = getLocalityByKey(worker.localityKey);
    const post = await Post.create({
      workerId: worker._id,
      skill: spec.skill,
      caption: spec.caption,
      afterUrl,
      beforeUrl,
      bookingId: linkedBookingId,
      verifiedJob,
      localityKey: worker.localityKey,
      location: { type: 'Point', coordinates: [loc.lng, loc.lat] },
      isSample: true,
      createdAt: postCreatedAt,
      updatedAt: postCreatedAt
    });

    await User.updateOne({ _id: worker._id }, { $inc: { activePostCount: 1 } });
    createdPosts.push(post);
  }

  // Follows and Saves (Customers follow 2-4 workers, save 1-3; two workers follow each other)
  const customersList = [custBusy, customersMap.get('CUST_3'), customersMap.get('CUST_4'), customersMap.get('CUST_5')];
  for (const cust of customersList) {
    await createFollow({ body: { workerId: workE1._id.toString(), type: 'follow' }, caller: cust });
    await createFollow({ body: { workerId: workP1._id.toString(), type: 'save' }, caller: cust });
  }
  await createFollow({ body: { workerId: workH1._id.toString(), type: 'follow' }, caller: custBusy });
  await createFollow({ body: { workerId: workM1._id.toString(), type: 'follow' }, caller: custBusy });

  // Two workers follow each other
  await createFollow({ body: { workerId: workP1._id.toString(), type: 'follow' }, caller: workE1 });
  await createFollow({ body: { workerId: workE1._id.toString(), type: 'follow' }, caller: workP1 });

  // Endorsements (Only where customer has completed booking for that skill)
  // Worker E1 has 4 endorsements from different customers (CUST_BUSY, CUST_3, CUST_4, CUST_5)
  await createEndorsement({ workerId: workE1._id.toString(), skill: 'electrician', customer: custBusy });
  await createEndorsement({ workerId: workE1._id.toString(), skill: 'electrician', customer: customersMap.get('CUST_3') });
  await createEndorsement({ workerId: workE1._id.toString(), skill: 'electrician', customer: customersMap.get('CUST_4') });
  await createEndorsement({ workerId: workE1._id.toString(), skill: 'electrician', customer: customersMap.get('CUST_5') });

  // Worker H1 has 2 endorsements
  await createEndorsement({ workerId: workH1._id.toString(), skill: 'helper', customer: custBusy });
  await createEndorsement({ workerId: workH1._id.toString(), skill: 'helper', customer: customersMap.get('CUST_3') });

  // Worker P1 has 1 endorsement
  await createEndorsement({ workerId: workP1._id.toString(), skill: 'plumber', customer: custBusy });

  // 4 Sample Reports (2 on posts, 1 on worker, 1 booking report on in_progress booking)
  log('[Seed] Stage 9/9: Submitting sample moderation reports...');
  // Report 1 on Post
  await createReport({
    body: { targetType: 'post', targetId: createdPosts[0]._id.toString(), reason: 'spam', note: 'Check caption for promotional claims' },
    reporter: custBusy,
    clientIp: '127.0.0.1',
    ipSalt: config.JWT_REFRESH_SECRET
  });

  // Report 2 on Post
  await createReport({
    body: { targetType: 'post', targetId: createdPosts[1]._id.toString(), reason: 'other', note: 'Image unclear' },
    reporter: customersMap.get('CUST_3'),
    clientIp: '127.0.0.1',
    ipSalt: config.JWT_REFRESH_SECRET
  });

  // Report 3 on Worker
  await createReport({
    body: { targetType: 'worker', targetId: workE2._id.toString(), reason: 'unsafe', note: 'Worker arrived without standard insulation tools' },
    reporter: custBusy,
    clientIp: '127.0.0.1',
    ipSalt: config.JWT_REFRESH_SECRET
  });

  // Report 4 on Booking (in_progress booking)
  const ipHash = crypto.createHash('sha256').update('127.0.0.1').digest('hex');
  await Report.create({
    targetType: 'booking',
    targetId: inProgressBookingId,
    reason: 'wrong_place',
    note: 'Customer gate address differs from description',
    reporterId: workE2._id,
    reportedUserId: custBusy._id,
    ipHash
  });

  // Ensure all rate stats are computed up to runNow
  const distinctSkills = ['electrician', 'helper', 'plumber', 'mason', 'cook', 'carpenter', 'painter', 'driver', 'cleaner'];
  const distinctLocalities = ['kakkanad', 'edappally', 'kaloor', 'vyttila', 'aluva', 'palarivattom', 'thevara', 'tripunithura', 'fort_kochi'];
  for (const skill of distinctSkills) {
    for (const loc of distinctLocalities) {
      await withClock(runNow, async () => {
        await recomputeRateStats(skill, loc, clock);
      });
    }
  }

  // Final Summary Table
  const userCounts = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  const bookingCounts = await Booking.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const jobCounts = await Job.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const liveWindows = await Availability.countDocuments({ active: true, expiresAt: { $gt: runNow } });
  const totalPosts = await Post.countDocuments({ isSample: true });
  const totalPassports = await PassportEntry.countDocuments({});
  const totalFollows = await Follow.countDocuments({ type: 'follow' });
  const totalSaves = await Follow.countDocuments({ type: 'save' });
  const totalEndorsements = await Endorsement.countDocuments({});
  const totalReports = await Report.countDocuments({});
  const rateStatsRows = await RateStats.countDocuments({});

  log('\n====================================================');
  log('WORKCRED SAMPLE SEED SUMMARY');
  log('====================================================');
  log(`Database: ${dbName}`);
  log(`Workers: ${userCounts.find((u) => u._id === 'worker')?.count || 0} | Customers: ${userCounts.find((u) => u._id === 'customer')?.count || 0}`);
  log(`Bookings by status: ${bookingCounts.map((b) => `${b._id}:${b.count}`).join(', ')}`);
  log(`Jobs by status: ${jobCounts.map((j) => `${j._id}:${j.count}`).join(', ')}`);
  log(`Passport entries: ${totalPassports}`);
  log(`Live Free Now windows: ${liveWindows}`);
  log(`Feed posts: ${totalPosts}`);
  log(`Follows: ${totalFollows} | Saves: ${totalSaves} | Endorsements: ${totalEndorsements}`);
  log(`Reports: ${totalReports} | RateStats rows: ${rateStatsRows}`);
  log('====================================================\n');

  return { status: 'success' };
}
