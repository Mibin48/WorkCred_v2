/**
 * backend/tests/integration/b6.integration.test.js – Comprehensive integration tests for B6
 * Free Now and Realtime (Socket.io).
 *
 * Uses MongoMemoryReplSet and socket.io-client against a real listening HTTP server.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { io as Client } from 'socket.io-client';

import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Booking } from '../../src/models/Booking.js';
import { Availability } from '../../src/models/Availability.js';
import { Job } from '../../src/models/Job.js';
import { RateStats } from '../../src/models/RateStats.js';
import { IdempotencyKey } from '../../src/models/IdempotencyKey.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { clock } from '../../src/utils/clock.js';
import {
  initRealtime,
  closeRealtime,
  sweepOnce,
  revalidateAll,
  eventBus,
  getSocketServer
} from '../../src/realtime/index.js';
import { resetConnectionLimits } from '../../src/realtime/socketServer.js';
import { clearAllExpiryTimers } from '../../src/services/freeNowService.js';
import { encodeCursor } from '../../../shared/jobRules.js';

describe('backend/tests/integration/b6.integration.test.js (B6 Free Now and Realtime)', () => {
  let replSet;
  let server;
  let baseUrl;

  const JWT_ACCESS_SECRET = 'super_secret_access_key_at_least_32_bytes_long_123456';
  const JWT_REFRESH_SECRET = 'super_secret_refresh_key_at_least_32_bytes_long_123456';
  const CODES_ENC_KEY = Buffer.alloc(32, 'a').toString('base64');

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    CODES_ENC_KEY,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri('workcred_b6_test');
    await mongoose.connect(uri, { autoIndex: true });

    await Promise.all([
      User.init(),
      Booking.init(),
      Availability.init(),
      Job.init(),
      RateStats.init(),
      IdempotencyKey.init()
    ]);

    const app = createApp(testConfig);
    server = http.createServer(app);
    initRealtime(server, testConfig);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    closeRealtime();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
    clock.restore();
  });

  beforeEach(async () => {
    clock.restore();
    resetConnectionLimits();
    clearAllExpiryTimers();
    await Availability.deleteMany({});
  });

  // Helper: creates a user via API
  async function createUser({ role = 'worker', suffix = '1', skills = ['electrician'], localityKey = 'kakkanad', radiusKm = 5, hourlyRate = 400 }) {
    const email = `${role}_${suffix}_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Test ${role} ${suffix}`,
        email,
        phone: '9845012345',
        password: 'ComplexPassword123#Secure',
        role
      })
    });
    const signupData = await signupRes.json();
    const token = signupData.data.accessToken;
    const userId = signupData.data.user.id;

    if (role === 'worker') {
      const skillsPayload = skills.map((s, idx) => 
        (typeof s === 'string' ? { skill: s, isMain: idx === 0 } : s)
      );
      await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          skills: skillsPayload,
          hourlyRate,
          localityKey,
          radiusKm
        })
      });
    } else {
      await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          localityKey
        })
      });
    }

    const userDoc = await User.findById(userId);
    return { id: userId, token, userDoc, email };
  }

  // Helper: connects socket with token
  function connectSocket(token, options = {}) {
    return Client(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      ...options
    });
  }

  // Helper: wait for event on socket
  function waitForEvent(socket, eventName, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(eventName, onEvent);
        reject(new Error(`Timeout waiting for event "${eventName}"`));
      }, timeoutMs);

      function onEvent(data) {
        clearTimeout(timer);
        socket.off(eventName, onEvent);
        resolve(data);
      }
      socket.on(eventName, onEvent);
    });
  }

  // Helper: assert no event received within window
  function assertNoEvent(socket, eventName, waitMs = 300) {
    return new Promise((resolve, reject) => {
      const onEvent = (data) => {
        socket.off(eventName, onEvent);
        reject(new Error(`Unexpected event "${eventName}" received with payload: ${JSON.stringify(data)}`));
      };
      socket.on(eventName, onEvent);
      setTimeout(() => {
        socket.off(eventName, onEvent);
        resolve();
      }, waitMs);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Free Now API Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Free Now REST API', () => {
    it('hours 3 and 12 are rejected with 400', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn1' });
      for (const h of [3, 12, 1, 5, 0, -2]) {
        const res = await fetch(`${baseUrl}/api/v1/availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
          body: JSON.stringify({ hours: h })
        });
        assert.equal(res.status, 400);
      }
    });

    it('role authorization: workers only for write, customers only for nearby', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_role_w' });
      const customer = await createUser({ role: 'customer', suffix: 'fn_role_c' });

      // Customer trying to start window -> 403
      const postCust = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customer.token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(postCust.status, 403);

      // Customer trying to extend window -> 403
      const extCust = await fetch(`${baseUrl}/api/v1/availability/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customer.token}` },
        body: JSON.stringify({ hours: 1 })
      });
      assert.equal(extCust.status, 403);

      // Customer trying to delete window -> 403
      const delCust = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${customer.token}` }
      });
      assert.equal(delCust.status, 403);

      // Worker trying nearby -> 403
      const nearWork = await fetch(`${baseUrl}/api/v1/availability/nearby`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${worker.token}` }
      });
      assert.equal(nearWork.status, 403);
    });

    it('incomplete worker gets 403 PROFILE_INCOMPLETE', async () => {
      const incompleteWorker = await User.create({
        name: 'Incomplete Worker',
        email: `inc_${Date.now()}@example.com`,
        phone: '9845012349',
        passwordHash: 'scrypt$fake$hash',
        role: 'worker',
        profileComplete: false,
        isActive: true
      });
      const { signAccessToken } = await import('../../src/utils/tokenCrypto.js');
      const token = await signAccessToken({
        userId: incompleteWorker._id.toString(),
        role: 'worker',
        tokenVersion: 0
      }, testConfig.JWT_ACCESS_SECRET);

      const res = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error.code, 'PROFILE_INCOMPLETE');
    });

    it('one live window: second POST returns 409 ALREADY_FREE, and 10 parallel POSTs give exactly 1 success', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_parallel' });

      // 10 parallel POST requests
      const promises = Array.from({ length: 10 }).map(() =>
        fetch(`${baseUrl}/api/v1/availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
          body: JSON.stringify({ hours: 2 })
        })
      );

      const results = await Promise.all(promises);
      const statuses = results.map((r) => r.status);
      const successCount = statuses.filter((s) => s === 201).length;
      const alreadyFreeCount = statuses.filter((s) => s === 409).length;

      assert.equal(successCount, 1, 'Exactly one parallel creation must succeed');
      assert.equal(alreadyFreeCount, 9, 'Other 9 parallel requests must get 409 ALREADY_FREE');

      // Verify second sequential POST also gets 409
      const secondPost = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 4 })
      });
      assert.equal(secondPost.status, 409);
      const secondData = await secondPost.json();
      assert.equal(secondData.error.code, 'ALREADY_FREE');
      assert.ok(secondData.error.details?.window);
    });

    it('extend by 4 after 8 h works up to 12 h total; extending further returns 409 EXTEND_LIMIT', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_extend' });

      // Start 8 hour window
      const startRes = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 8 })
      });
      assert.equal(startRes.status, 201);
      const startData = await startRes.json();
      assert.equal(startData.data.window.totalHours, 8);
      assert.equal(startData.data.window.canExtendHours, 4);

      // Extend by 4 hours -> 12 hours total
      const ext4 = await fetch(`${baseUrl}/api/v1/availability/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 4 })
      });
      assert.equal(ext4.status, 200);
      const ext4Data = await ext4.json();
      assert.equal(ext4Data.data.window.totalHours, 12);
      assert.equal(ext4Data.data.window.canExtendHours, 0);

      // One more hour is refused with 409 EXTEND_LIMIT and remainingHours: 0
      const extExtra = await fetch(`${baseUrl}/api/v1/availability/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 1 })
      });
      assert.equal(extExtra.status, 409);
      const extExtraData = await extExtra.json();
      assert.equal(extExtraData.error.code, 'EXTEND_LIMIT');
      assert.equal(extExtraData.error.remainingHours, 0);
    });

    it('stop is safe to repeat', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_stop' });
      await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });

      const del1 = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${worker.token}` }
      });
      assert.equal(del1.status, 200);

      // Repeat stop on already stopped window
      const del2 = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${worker.token}` }
      });
      assert.equal(del2.status, 200);
    });

    it('blocked date gives 409 BLOCKED_TODAY, weekly pattern "off" does NOT block Free Now', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_cal' });
      const { getIndiaTimeParts } = await import('../../../shared/calendarRules.js');
      const { dateString, dayKey } = getIndiaTimeParts(clock.now());

      // Set weekly pattern to "off" for today: Free Now should still succeed (J3)
      await User.updateOne(
        { _id: worker.id },
        { $set: { [`calendar.weekly.${dayKey}`]: 'off' } }
      );
      const updatedUser = await User.findById(worker.id);

      const startWeeklyOff = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(startWeeklyOff.status, 201, 'Going Free Now overrides weekly pattern');

      // Stop window
      await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${worker.token}` }
      });

      // Block today's date in calendar
      await User.updateOne(
        { _id: worker.id },
        { $push: { 'calendar.blockedDates': { date: dateString, reason: 'Personal holiday' } } }
      );

      const startBlocked = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(startBlocked.status, 409);
      const blockedData = await startBlocked.json();
      assert.equal(blockedData.error.code, 'BLOCKED_TODAY');
    });

    it('worker with in_progress booking is blocked from going Free Now (409 JOB_IN_PROGRESS)', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_inp' });
      const customer = await createUser({ role: 'customer', suffix: 'fn_inpc' });

      // Create an in_progress booking for this worker
      await Booking.create({
        customerId: customer.id,
        workerId: worker.id,
        skill: 'electrician',
        localityKey: 'kakkanad',
        scheduledAt: new Date(Date.now() - 3600000),
        startedAt: new Date(Date.now() - 1800000),
        hours: 2,
        status: 'in_progress',
        agreedRate: 400,
        source: 'direct',
        startCodeEnc: 'enc',
        finishCodeEnc: 'enc'
      });

      const res = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.error.code, 'JOB_IN_PROGRESS');
    });

    it('nearby: distance order, pagination walk over 25 workers with heavy ties, read-time expiry', async () => {
      const customer = await createUser({ role: 'customer', suffix: 'near_cust', localityKey: 'kakkanad' });

      // Create 25 workers in Kakkanad and Edapally
      const workerIds = [];
      for (let i = 0; i < 25; i++) {
        const w = await createUser({
          role: 'worker',
          suffix: `tie_${i}`,
          skills: ['electrician'],
          localityKey: i < 15 ? 'kakkanad' : 'edapally',
          hourlyRate: 300 + (i % 5) * 50
        });
        workerIds.push(w.id);

        const res = await fetch(`${baseUrl}/api/v1/availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${w.token}` },
          body: JSON.stringify({ hours: 4 })
        });
        assert.equal(res.status, 201);
      }

      // Walk through all pages with limit=5
      const collectedIds = [];
      let cursor = null;

      for (let page = 0; page < 6; page++) {
        const url = new URL(`${baseUrl}/api/v1/availability/nearby`);
        url.searchParams.set('radiusKm', '5');
        url.searchParams.set('skill', 'electrician');
        url.searchParams.set('limit', '5');
        if (cursor) url.searchParams.set('cursor', cursor);

        const res = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${customer.token}` }
        });
        assert.equal(res.status, 200);
        const data = await res.json();

        // Privacy scan on response
        assertNoSensitiveFields(data);

        for (const w of data.data.workers) {
          collectedIds.push(w.workerId);
        }

        cursor = data.data.nextCursor;
        if (!cursor) break;
      }

      assert.equal(collectedIds.length, 25, 'All 25 workers must be returned');
      const uniqueIds = new Set(collectedIds);
      assert.equal(uniqueIds.size, 25, 'Every worker must be returned exactly once without repeats or gaps');

      // Tampered cursor gives 400 BAD_CURSOR
      const badCursorRes = await fetch(`${baseUrl}/api/v1/availability/nearby?cursor=garbageTamperedCursor123`, {
        headers: { 'Authorization': `Bearer ${customer.token}` }
      });
      assert.equal(badCursorRes.status, 400);
      const badCursorData = await badCursorRes.json();
      assert.equal(badCursorData.error.code, 'BAD_CURSOR');

      // Advance fake clock by 4 hours and 1 minute WITHOUT running sweeper
      clock.advanceMs(4 * 3600 * 1000 + 60000);

      // Verify read-time expiry: nearby list immediately returns 0 workers
      const expiredNearby = await fetch(`${baseUrl}/api/v1/availability/nearby`, {
        headers: { 'Authorization': `Bearer ${customer.token}` }
      });
      assert.equal(expiredNearby.status, 200);
      const expiredData = await expiredNearby.json();
      assert.equal(expiredData.data.workers.length, 0, 'Expired windows must disappear at read-time');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Booking from Free Now (BOOK-3)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Booking from Free Now (BOOK-3)', () => {
    it('creates booking with source freenow, closes window, second booking fails', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_book_w', hourlyRate: 400, localityKey: 'kakkanad' });
      const customer1 = await createUser({ role: 'customer', suffix: 'fn_book_c1', localityKey: 'kakkanad' });
      const customer2 = await createUser({ role: 'customer', suffix: 'fn_book_c2', localityKey: 'kakkanad' });

      // Worker goes Free Now (4 h)
      await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 4 })
      });

      // scheduledAt sent in Free Now booking request gives 400
      const resBad = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customer1.token}`,
          'Idempotency-Key': `fn_bad_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          hours: 2,
          fromFreeNow: true,
          scheduledAt: new Date(Date.now() + 3600000).toISOString()
        })
      });
      assert.equal(resBad.status, 400);

      // Valid Free Now booking: customer1 books worker
      const bookRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customer1.token}`,
          'Idempotency-Key': `fn_ok_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          hours: 2,
          fromFreeNow: true
        })
      });
      assert.equal(bookRes.status, 201);
      const bookData = await bookRes.json();
      assert.equal(bookData.data.booking.source, 'freenow');

      // Window is closed immediately upon booking creation
      const meRes = await fetch(`${baseUrl}/api/v1/availability/me`, {
        headers: { 'Authorization': `Bearer ${worker.token}` }
      });
      const meData = await meRes.json();
      assert.equal(meData.data.window, null, 'Free Now window must be closed after booking');

      // Second customer trying to book from Free Now gets 409 NOT_FREE_NOW
      const secondCustRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customer2.token}`,
          'Idempotency-Key': `fn_sec_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          hours: 2,
          fromFreeNow: true
        })
      });
      assert.equal(secondCustRes.status, 409);
      const secondCustData = await secondCustRes.json();
      assert.equal(secondCustData.error.code, 'NOT_FREE_NOW');
    });

    it('window ending in under 30 minutes gives 409 FREE_WINDOW_ENDS_SOON', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_ending_soon', localityKey: 'kakkanad' });
      const customer = await createUser({ role: 'customer', suffix: 'fn_ending_cust', localityKey: 'kakkanad' });

      // Worker goes Free Now for 2h
      await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });

      // Advance clock by 1 hour and 35 minutes (only 25 minutes left on window)
      clock.advanceMs(95 * 60 * 1000);

      const bookRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customer.token}`,
          'Idempotency-Key': `fn_ends_soon_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          hours: 1,
          fromFreeNow: true
        })
      });
      assert.equal(bookRes.status, 409);
      const bookData = await bookRes.json();
      assert.equal(bookData.error.code, 'FREE_WINDOW_ENDS_SOON');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Sweeper Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Free Now Sweeper', () => {
    it('sweepOnce closes expired windows and announces busy once', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'fn_sweep' });

      // Start 2 hour window
      await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ hours: 2 })
      });

      // Advance clock past 2 hours
      clock.advanceMs(2 * 3600 * 1000 + 1000);

      let busyAnnouncements = 0;
      const handler = () => { busyAnnouncements++; };
      eventBus.subscribe('radar:worker_busy', handler);

      // First sweep: closes 1 window and announces busy
      const closed1 = await sweepOnce(clock.now());
      assert.equal(closed1, 1);
      assert.equal(busyAnnouncements, 1);

      // Second sweep: already announced, returns 0
      const closed2 = await sweepOnce(clock.now());
      assert.equal(closed2, 0);
      assert.equal(busyAnnouncements, 1, 'Busy must not be announced twice');

      eventBus.unsubscribe('radar:worker_busy', handler);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Socket.io Connection & Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Socket Connection and Security', () => {
    it('no token in auth gives connect_error AUTH_REQUIRED', async () => {
      const socket = Client(baseUrl, {
        path: '/socket.io',
        transports: ['websocket'],
        auth: {}
      });

      const err = await new Promise((resolve) => socket.on('connect_error', resolve));
      assert.equal(err.message, 'AUTH_REQUIRED');
      socket.close();
    });

    it('token passed in URL query is rejected with AUTH_INVALID', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_q' });
      const socket = Client(baseUrl, {
        path: '/socket.io',
        transports: ['websocket'],
        query: { token: user.token }
      });

      const err = await new Promise((resolve) => socket.on('connect_error', resolve));
      assert.equal(err.message, 'AUTH_INVALID');
      socket.close();
    });

    it('valid token connects and receives "ready" event with serverTime', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_valid' });
      const socket = connectSocket(user.token);

      const readyData = await waitForEvent(socket, 'ready');
      assert.ok(readyData.serverTime);
      assertNoSensitiveFields(readyData);
      socket.close();
    });

    it('disabled user is rejected with AUTH_INVALID', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_disabled' });
      await User.updateOne({ _id: user.id }, { $set: { isActive: false } });

      const socket = connectSocket(user.token);
      const err = await new Promise((resolve) => socket.on('connect_error', resolve));
      assert.equal(err.message, 'AUTH_INVALID');
      socket.close();
    });

    it('tokenVersion mismatch is rejected with AUTH_INVALID', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_tv' });
      await User.updateOne({ _id: user.id }, { $inc: { tokenVersion: 1 } });

      const socket = connectSocket(user.token);
      const err = await new Promise((resolve) => socket.on('connect_error', resolve));
      assert.equal(err.message, 'AUTH_INVALID');
      socket.close();
    });

    it('6th simultaneous socket for same user is refused with TOO_MANY_CONNECTIONS', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_sim' });
      const sockets = [];

      for (let i = 0; i < 5; i++) {
        const s = connectSocket(user.token);
        await waitForEvent(s, 'ready');
        sockets.push(s);
      }

      // 6th connection attempt
      const sixth = connectSocket(user.token);
      const err = await new Promise((resolve) => sixth.on('connect_error', resolve));
      assert.equal(err.message, 'TOO_MANY_CONNECTIONS');

      for (const s of sockets) s.close();
      sixth.close();
    });

    it('unlisted Origin header is refused with AUTH_INVALID', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_origin' });
      const socket = connectSocket(user.token, {
        extraHeaders: { origin: 'http://malicious-site.example.com' }
      });

      const err = await new Promise((resolve) => socket.on('connect_error', resolve));
      assert.equal(err.message, 'AUTH_INVALID');
      socket.close();
    });

    it('client exceeding 10 events per minute is disconnected with RATE_LIMITED', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_rate' });
      const socket = connectSocket(user.token);
      await waitForEvent(socket, 'ready');

      // Send 11 events rapidly
      for (let i = 0; i < 11; i++) {
        socket.emit('rooms:refresh');
      }

      const disconnectReason = await new Promise((resolve) => socket.on('disconnect', resolve));
      assert.ok(disconnectReason);
      socket.close();
    });

    it('auth:refresh with a fresh token succeeds, different user token disconnects', async () => {
      const user1 = await createUser({ role: 'customer', suffix: 'sock_ref1' });
      const user2 = await createUser({ role: 'customer', suffix: 'sock_ref2' });
      const socket = connectSocket(user1.token);
      await waitForEvent(socket, 'ready');

      // 1. Refresh with fresh token for user1 -> success
      const { signAccessToken } = await import('../../src/utils/tokenCrypto.js');
      const freshToken1 = await signAccessToken({
        userId: user1.id,
        role: 'customer',
        tokenVersion: 0
      }, testConfig.JWT_ACCESS_SECRET);

      const ackResult = await new Promise((resolve) => {
        socket.emit('auth:refresh', { token: freshToken1 }, resolve);
      });
      assert.deepEqual(ackResult, { ok: true });

      // 2. Refresh with token belonging to user2 -> disconnected
      socket.emit('auth:refresh', { token: user2.token });
      const disconnectReason = await new Promise((resolve) => socket.on('disconnect', resolve));
      assert.ok(disconnectReason);
      socket.close();
    });

    it('revalidateAll disconnects user after password change (tokenVersion changed)', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_reval' });
      const socket = connectSocket(user.token);
      await waitForEvent(socket, 'ready');

      // Invalidate tokenVersion in DB
      await User.updateOne({ _id: user.id }, { $inc: { tokenVersion: 1 } });

      // Run revalidateAll
      await revalidateAll();

      const disconnectReason = await new Promise((resolve) => socket.on('disconnect', resolve));
      assert.ok(disconnectReason);
      socket.close();
    });

    it('expired token past 60 s grace disconnects socket via revalidateAll (fake clock)', async () => {
      const user = await createUser({ role: 'customer', suffix: 'sock_exp' });
      const socket = connectSocket(user.token);
      await waitForEvent(socket, 'ready');

      // Advance clock past token expiration (15 min) + 60 s grace = 16 min 10 s
      clock.advanceMs(16 * 60 * 1000 + 10000);

      await revalidateAll();

      const disconnectReason = await new Promise((resolve) => socket.on('disconnect', resolve));
      assert.ok(disconnectReason);
      socket.close();
    });

    it('rooms:refresh moves a user to new rooms after an area change', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'sock_room_mov', localityKey: 'kakkanad' });
      const socket = connectSocket(worker.token);
      await waitForEvent(socket, 'ready');

      // Change area to Aluva
      await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${worker.token}` },
        body: JSON.stringify({ localityKey: 'aluva' })
      });

      // Emit rooms:refresh
      socket.emit('rooms:refresh');
      await new Promise((r) => setTimeout(r, 200));

      // Server socket cachedData should now be Aluva
      const io = getSocketServer();
      const srvSocket = io.sockets.sockets.get(socket.id);
      assert.ok(srvSocket);
      assert.equal(srvSocket.cachedData.origin?.lat, 10.1076);
      socket.close();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Targeting & Real-Time Event Filtering (The Key Test)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Real-Time Targeting & Audience Filtering', () => {
    it('targets job:new, radar:worker_free, and booking events strictly to eligible parties', async () => {
      // Worker A: electrician, Kochi centre (kaloor), radius 5 km
      const workerA = await createUser({
        role: 'worker',
        suffix: 'targ_wA',
        skills: ['electrician'],
        localityKey: 'kaloor',
        radiusKm: 5
      });

      // Worker B: plumber, same area (kaloor)
      const workerB = await createUser({
        role: 'worker',
        suffix: 'targ_wB',
        skills: ['plumber'],
        localityKey: 'kaloor',
        radiusKm: 5
      });

      // Worker C: electrician, Aluva (15 km away), radius 2 km
      const workerC = await createUser({
        role: 'worker',
        suffix: 'targ_wC',
        skills: ['electrician'],
        localityKey: 'aluva',
        radiusKm: 2
      });

      // Customer D: near (kaloor)
      const customerD = await createUser({
        role: 'customer',
        suffix: 'targ_cD',
        localityKey: 'kaloor'
      });

      // Customer E: far (aluva)
      const customerE = await createUser({
        role: 'customer',
        suffix: 'targ_cE',
        localityKey: 'aluva'
      });

      // Customer F: same area (kaloor)
      const customerF = await createUser({
        role: 'customer',
        suffix: 'targ_cF',
        localityKey: 'kaloor'
      });

      // Connect sockets for all 6 parties
      const sockWA = connectSocket(workerA.token);
      const sockWB = connectSocket(workerB.token);
      const sockWC = connectSocket(workerC.token);
      const sockCD = connectSocket(customerD.token);
      const sockCE = connectSocket(customerE.token);
      const sockCF = connectSocket(customerF.token);

      await Promise.all([
        waitForEvent(sockWA, 'ready'),
        waitForEvent(sockWB, 'ready'),
        waitForEvent(sockWC, 'ready'),
        waitForEvent(sockCD, 'ready'),
        waitForEvent(sockCE, 'ready'),
        waitForEvent(sockCF, 'ready')
      ]);

      // --- Test 1: Customer F posts a job for an electrician ---
      const jobPromiseWA = waitForEvent(sockWA, 'job:new');

      const jobRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customerF.token}` },
        body: JSON.stringify({
          skill: 'electrician',
          workersNeeded: 1,
          hours: 2,
          startAt: new Date(Date.now() + 3600000).toISOString(),
          offeredRate: 400,
          description: 'Fix circuit breaker',
          localityKey: 'kaloor'
        })
      });
      assert.equal(jobRes.status, 201);
      const jobData = await jobRes.json();
      const jobId = jobData.data.job.id;

      // Worker A MUST receive job:new
      const receivedJob = await jobPromiseWA;
      assert.equal(receivedJob.jobId, jobId);
      assert.equal(receivedJob.skill, 'electrician');
      assertNoSensitiveFields(receivedJob);

      // Worker B (wrong skill), Worker C (out of radius), Customers D, E, F must NOT receive job:new
      await Promise.all([
        assertNoEvent(sockWB, 'job:new'),
        assertNoEvent(sockWC, 'job:new'),
        assertNoEvent(sockCD, 'job:new'),
        assertNoEvent(sockCE, 'job:new'),
        assertNoEvent(sockCF, 'job:new')
      ]);

      // --- Test 2: Worker A goes Free Now ---
      const radarPromiseCD = waitForEvent(sockCD, 'radar:worker_free');
      const radarPromiseCF = waitForEvent(sockCF, 'radar:worker_free');

      const freeRes = await fetch(`${baseUrl}/api/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${workerA.token}` },
        body: JSON.stringify({ hours: 2 })
      });
      assert.equal(freeRes.status, 201);

      // Near customers D and F receive radar:worker_free
      const radarCD = await radarPromiseCD;
      const radarCF = await radarPromiseCF;
      assert.equal(radarCD.workerId, workerA.id);
      assert.equal(radarCF.workerId, workerA.id);
      assertNoSensitiveFields(radarCD);
      assertNoSensitiveFields(radarCF);

      // Customer E (far away) and workers A, B, C must NOT receive radar:worker_free
      await Promise.all([
        assertNoEvent(sockCE, 'radar:worker_free'),
        assertNoEvent(sockWA, 'radar:worker_free'),
        assertNoEvent(sockWB, 'radar:worker_free'),
        assertNoEvent(sockWC, 'radar:worker_free')
      ]);

      // --- Test 3: Customer D creates a booking for Worker A from Free Now ---
      const reqPromiseWA = waitForEvent(sockWA, 'booking:request');
      const busyPromiseCD = waitForEvent(sockCD, 'radar:worker_busy');
      const busyPromiseCF = waitForEvent(sockCF, 'radar:worker_busy');

      const bookRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerD.token}`,
          'Idempotency-Key': `targ_book_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: workerA.id,
          hours: 1,
          fromFreeNow: true
        })
      });
      assert.equal(bookRes.status, 201);
      const bookingData = await bookRes.json();
      const bookingId = bookingData.data.booking.id;

      // Worker A receives booking:request
      const reqReceived = await reqPromiseWA;
      assert.equal(reqReceived.bookingId, bookingId);
      assertNoSensitiveFields(reqReceived);

      // Radar announces busy to near customers D and F
      const busyCD = await busyPromiseCD;
      const busyCF = await busyPromiseCF;
      assert.equal(busyCD.workerId, workerA.id);
      assert.equal(busyCF.workerId, workerA.id);
      assertNoSensitiveFields(busyCD);
      assertNoSensitiveFields(busyCF);

      // Customer D must NOT receive booking:request
      await assertNoEvent(sockCD, 'booking:request');

      // --- Test 4: Worker A confirms booking ---
      const confirmPromiseCD = waitForEvent(sockCD, 'booking:created');

      const confRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${workerA.token}` }
      });
      assert.equal(confRes.status, 200);

      // Customer D receives booking:created
      const confReceived = await confirmPromiseCD;
      assert.equal(confReceived.bookingId, bookingId);
      assertNoSensitiveFields(confReceived);

      // Worker A must NOT receive booking:created
      await assertNoEvent(sockWA, 'booking:created');

      // Clean up sockets
      sockWA.close();
      sockWB.close();
      sockWC.close();
      sockCD.close();
      sockCE.close();
      sockCF.close();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Emitting Failure Resiliency
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Emitting Failure Resiliency', () => {
    it('when bus subscriber throws, the booking request still succeeds and error is logged', async () => {
      const worker = await createUser({ role: 'worker', suffix: 'throw_w' });
      const customer = await createUser({ role: 'customer', suffix: 'throw_c' });

      // Add a throwing subscriber
      const faultyHandler = () => {
        throw new Error('Forced subscriber failure for resiliency test');
      };
      eventBus.subscribe('booking:request', faultyHandler);

      const bookRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customer.token}`,
          'Idempotency-Key': `resilient_${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          hours: 1,
          scheduledAt: new Date(Date.now() + 3600000).toISOString()
        })
      });

      assert.equal(bookRes.status, 201, 'Booking must succeed even if event emission throws');
      eventBus.unsubscribe('booking:request', faultyHandler);
    });
  });
});
