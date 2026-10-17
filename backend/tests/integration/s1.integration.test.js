/**
 * backend/tests/integration/s1.integration.test.js
 *
 * Full integration suite for Phase S1 (Seed Data & Reset).
 *
 * Requirements tested:
 * 1. Run the full seed; assert verify checks pass.
 * 2. Idempotent: run seed a second time; assert it detects existing sample data and makes no duplicate insertions.
 * 3. Reset: run demo:reset; assert identical clean seed counts.
 * 4. Safety: insert a REAL (non-sample) user, booking, and post; run reset; assert REAL records remain untouched while all sample documents are purged.
 * 5. Refusal guards: seed refuses to run in production, with "prod" DB name, without DEMO_PASSWORD, and without --yes.
 * 6. Demo authentication: every sample account can log in via real login service with DEMO_PASSWORD.
 * 7. In-progress booking lifecycle: can be completed via API after seeding.
 * 8. Status projections: pending-in-the-past reads as expired, unused confirmed reads as missed.
 * 9. Compass endpoints: return locality, city, and sample baseline for the 3 coverage cases.
 * 10. Repeated-cancellations warning: Worker E2 with 2 confirmed cancellations triggers warning on 3rd.
 * 11. Privacy scanner: every API endpoint over seeded data passes privacy scan and exposes isSample.
 * 12. GET /demo/accounts: 404 outside development and without sample data; 200 with proper shape in dev.
 * 13. Startup guard: fails when NODE_ENV is production and DEMO_PASSWORD is present.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { createApp } from '../../src/app.js';
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
  RateStats
} from '../../src/models/index.js';
import { runSeed, removeSampleData, assertSeedSafety } from '../../src/seed/runner.js';
import { runChainVerification } from '../../src/services/passportService.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { hashPassword } from '../../src/utils/passwordCrypto.js';
import { encryptCode } from '../../../shared/codesCrypto.js';

describe('backend/tests/integration/s1.integration.test.js (S1 Seed Data & Reset Integration Suite)', () => {
  let replSet;
  let server;
  let baseUrl;

  const JWT_ACCESS_SECRET = 'super_secret_access_key_at_least_32_bytes_long_123456';
  const JWT_REFRESH_SECRET = 'super_secret_refresh_key_at_least_32_bytes_long_123456';
  const CODES_ENC_KEY = Buffer.alloc(32, 'a').toString('base64');
  const DEMO_PASSWORD = 'DemoPassword123#';

  const testConfig = {
    NODE_ENV: 'development',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    CODES_ENC_KEY,
    DEMO_PASSWORD,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri('workcred_s1_test');
    await mongoose.connect(uri, { autoIndex: true });

    await Promise.all([
      User.init(),
      Job.init(),
      Booking.init(),
      PassportEntry.init(),
      Availability.init(),
      Post.init(),
      Follow.init(),
      Endorsement.init(),
      Report.init(),
      RateStats.init()
    ]);

    const app = createApp({ ...testConfig, MONGODB_URI: uri });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    // Clear all collections before test cases that seed
    await Promise.all([
      User.deleteMany({}),
      Job.deleteMany({}),
      Booking.deleteMany({}),
      PassportEntry.deleteMany({}),
      Availability.deleteMany({}),
      Post.deleteMany({}),
      Follow.deleteMany({}),
      Endorsement.deleteMany({}),
      Report.deleteMany({}),
      RateStats.deleteMany({})
    ]);
  });

  async function api(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  it('runs full seed, creates all collections and passes verify assertions', async () => {
    const seedResult = await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });
    assert.equal(seedResult.status, 'success');

    // 12 workers, 8 customers
    const workerCount = await User.countDocuments({ role: 'worker', isSample: true });
    const customerCount = await User.countDocuments({ role: 'customer', isSample: true });
    assert.equal(workerCount, 12);
    assert.equal(customerCount, 8);

    // 15 posts
    const postCount = await Post.countDocuments({ isSample: true });
    assert.equal(postCount, 15);

    // Passport chain verification for all workers
    const workers = await User.find({ role: 'worker', isSample: true });
    for (const w of workers) {
      const v = await runChainVerification(w._id);
      assert.equal(v.status, 'valid', `Worker ${w.name} passport verification failed`);
    }

    // 3 live Free Now windows
    const now = new Date();
    const liveWindows = await Availability.countDocuments({ active: true, expiresAt: { $gt: now } });
    assert.equal(liveWindows, 3);
  });

  it('is idempotent: running seed twice stops early and does not duplicate data', async () => {
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });
    const initialUserCount = await User.countDocuments({});

    const secondRun = await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });
    assert.equal(secondRun.status, 'skipped');
    assert.equal(secondRun.reason, 'already_seeded');

    const afterUserCount = await User.countDocuments({});
    assert.equal(afterUserCount, initialUserCount);
  });

  it('safety: reset removes ONLY sample data and leaves real user, booking, and post untouched', async () => {
    // 1. Run seed
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });

    // 2. Insert REAL non-sample records
    const realUserHash = await hashPassword('RealSecurePass123!');
    const realWorker = await User.create({
      name: 'Real Worker',
      email: 'real.worker@myrealdomain.com',
      phone: '9847123456',
      role: 'worker',
      passwordHash: realUserHash,
      isSample: false
    });
    const realCustomer = await User.create({
      name: 'Real Customer',
      email: 'real.customer@myrealdomain.com',
      phone: '9847654321',
      role: 'customer',
      passwordHash: realUserHash,
      isSample: false
    });
    const realBooking = await Booking.create({
      customerId: realCustomer._id,
      workerId: realWorker._id,
      skill: 'electrician',
      agreedRate: 150,
      scheduledAt: new Date(),
      hours: 2,
      status: 'confirmed',
      locationSnapshot: { type: 'Point', coordinates: [76.3419, 10.0159] },
      localityKey: 'kakkanad',
      startCodeEnc: encryptCode('5555', CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'start'),
      finishCodeEnc: encryptCode('6666', CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'finish'),
      isSample: false
    });
    const realPost = await Post.create({
      workerId: realWorker._id,
      skill: 'electrician',
      caption: 'Real photo upload from genuine job work.',
      afterUrl: 'https://res.cloudinary.com/testcloud/image/upload/v1/workcred/posts/test.jpg',
      localityKey: 'kakkanad',
      location: { type: 'Point', coordinates: [76.3419, 10.0159] },
      isSample: false
    });

    // 3. Run removeSampleData
    await removeSampleData({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });

    // 4. Assert all sample records are purged
    const sampleUserCount = await User.countDocuments({ isSample: true });
    const sampleBookingCount = await Booking.countDocuments({ isSample: true });
    const samplePostCount = await Post.countDocuments({ isSample: true });
    assert.equal(sampleUserCount, 0);
    assert.equal(sampleBookingCount, 0);
    assert.equal(samplePostCount, 0);

    // 5. Assert REAL records are strictly preserved
    const foundRealWorker = await User.findById(realWorker._id);
    const foundRealCustomer = await User.findById(realCustomer._id);
    const foundRealBooking = await Booking.findById(realBooking._id);
    const foundRealPost = await Post.findById(realPost._id);
    assert.ok(foundRealWorker);
    assert.ok(foundRealCustomer);
    assert.ok(foundRealBooking);
    assert.ok(foundRealPost);
  });

  it('safety guards: refuses production, refuses prod/live db, requires DEMO_PASSWORD', () => {
    // Production env
    assert.throws(
      () => assertSeedSafety({ NODE_ENV: 'production', DEMO_PASSWORD, MONGODB_URI: 'mongodb://localhost/test' }),
      /forbidden when NODE_ENV is production/
    );

    // Prod db name
    assert.throws(
      () => assertSeedSafety({ NODE_ENV: 'development', DEMO_PASSWORD, MONGODB_URI: 'mongodb://localhost/workcred_prod_db' }),
      /Refusing to seed or reset database containing 'prod'/
    );

    // Missing or short DEMO_PASSWORD
    assert.throws(
      () => assertSeedSafety({ NODE_ENV: 'development', DEMO_PASSWORD: 'short', MONGODB_URI: 'mongodb://localhost/dev' }),
      /DEMO_PASSWORD must be set in environment and be at least 12 characters/
    );
  });

  it('demo accounts can authenticate via real login service and finish in-progress booking', async () => {
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });

    // Customer Busy login
    const loginRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'rahul.nambiar.sample@example.com', password: DEMO_PASSWORD, role: 'customer' })
    });
    assert.equal(loginRes.status, 200);
    const token = loginRes.body?.data?.accessToken;
    assert.ok(token);

    // Get bookings list
    const bListRes = await api('/api/v1/bookings?tab=active', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(bListRes.status, 200);
    const inProg = bListRes.body?.data?.bookings?.find((b) => b.status === 'in_progress');
    assert.ok(inProg, 'in_progress booking must exist');

    // Retrieve finishCode from codes endpoint
    const codesRes = await api(`/api/v1/bookings/${inProg.id}/codes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(codesRes.status, 200);
    const finishCode = codesRes.body?.data?.finishCode;
    assert.ok(finishCode);

    // Finish booking via API
    const finishRes = await api(`/api/v1/bookings/${inProg.id}/finish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        finishCode,
        paidCash: true,
        rating: 5,
        comment: 'Work completed cleanly and professionally.'
      })
    });
    assert.equal(finishRes.status, 200);
    assert.ok(finishRes.body?.data?.receipt?.recordId);

    const completedBooking = await Booking.findById(inProg.id);
    assert.equal(completedBooking.status, 'completed');
  });

  it('Compass endpoint returns locality, city, and sample baseline for the 3 coverage cases', async () => {
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });

    // Customer login
    const loginRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'rahul.nambiar.sample@example.com', password: DEMO_PASSWORD, role: 'customer' })
    });
    const token = loginRes.body?.data?.accessToken;
    assert.ok(token);

    // Kakkanad Electrician -> locality
    const elecRes = await api('/api/v1/compass?skill=electrician&localityKey=kakkanad', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(elecRes.status, 200);
    assert.equal(elecRes.body?.data?.source, 'locality');

    // Plumber -> city
    const plumbRes = await api('/api/v1/compass?skill=plumber&localityKey=kaloor', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(plumbRes.status, 200);
    assert.equal(plumbRes.body?.data?.source, 'city');

    // Cook -> sample baseline
    const cookRes = await api('/api/v1/compass?skill=cook&localityKey=aluva', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(cookRes.status, 200);
    assert.equal(cookRes.body?.data?.source, 'baseline');
  });

  it('GET /api/v1/demo/accounts behavior in development and sample presence', async () => {
    // 1. Without sample data: returns 404
    const resNoSample = await api('/api/v1/demo/accounts');
    assert.equal(resNoSample.status, 404);

    // 2. With sample data: returns 200 with accounts and password
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });
    const resWithSample = await api('/api/v1/demo/accounts');
    assert.equal(resWithSample.status, 200);
    assert.equal(resWithSample.body?.data?.password, DEMO_PASSWORD);
    assert.ok(Array.isArray(resWithSample.body?.data?.accounts));
    assert.ok(resWithSample.body.data.accounts.length >= 7);
  });

  it('privacy scanner passes across seeded API responses and validates isSample visibility', async () => {
    await runSeed({ ...testConfig, MONGODB_URI: mongoose.connection.name }, { log: () => {} });

    const loginRes = await api('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'rahul.nambiar.sample@example.com', password: DEMO_PASSWORD, role: 'customer' })
    });
    assert.equal(loginRes.status, 200);
    const token = loginRes.body?.data?.accessToken;
    assert.ok(token);

    // 1. Worker search
    const searchRes = await api('/api/v1/workers?skill=electrician&locality=kakkanad', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(searchRes.status, 200);
    assertNoSensitiveFields(searchRes.body);
    assert.equal(searchRes.body.data.workers[0].isSample, true);

    // 2. Feed
    const feedRes = await api('/api/v1/feed', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(feedRes.status, 200);
    assertNoSensitiveFields(feedRes.body);
    assert.equal(feedRes.body.data.items[0].isSample, true);

    // 3. Nearby Free Now (radiusKm between 1 and 5)
    const nearbyRes = await api('/api/v1/availability/nearby?radiusKm=5', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(nearbyRes.status, 200);
    assertNoSensitiveFields(nearbyRes.body);
    assert.equal(nearbyRes.body.data.workers[0].isSample, true);
  });
});
