/**
 * b5.integration.test.js – Comprehensive integration tests for B5
 * Bookings, Handshake, and Work Passport.
 *
 * Uses MongoMemoryReplSet (single node replica set) to test real
 * MongoDB multi-document transactions.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Booking } from '../../src/models/Booking.js';
import { PassportEntry } from '../../src/models/PassportEntry.js';
import { Report } from '../../src/models/Report.js';
import { RateStats } from '../../src/models/RateStats.js';
import { IdempotencyKey } from '../../src/models/IdempotencyKey.js';
import {
  assertNoSensitiveFields,
  assertNoRealBookingCodes
} from '../helpers/privacyScanner.js';
import { isWindowAvailable } from '../../../shared/jobRules.js';
import { decryptCode, generate4DigitCode } from '../../../shared/codesCrypto.js';
import { maskEmployerName, verifyChain } from '../../../shared/bookingHelpers.js';

describe('backend/tests/integration/b5.integration.test.js (B5 Bookings, Handshake, Passport)', () => {
  let replSet;
  let server;
  let baseUrl;

  const JWT_ACCESS_SECRET = 'super_secret_access_key_at_least_32_bytes_long_123456';
  const JWT_REFRESH_SECRET = 'super_secret_refresh_key_at_least_32_bytes_long_123456';
  const CODES_ENC_KEY = Buffer.alloc(32, 'a').toString('base64');

  const capturedLogs = [];

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
    const uri = replSet.getUri('workcred_b5_test');
    await mongoose.connect(uri, { autoIndex: true });

    await Promise.all([
      User.init(),
      Booking.init(),
      PassportEntry.init(),
      Report.init(),
      RateStats.init(),
      IdempotencyKey.init()
    ]);

    const app = createApp(testConfig);
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  });

  // Helper to create and activate a complete customer
  async function createCustomer(suffix = '1') {
    const email = `customer_${suffix}_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: `Customer ${suffix}`,
        email,
        phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        password: 'ComplexPass123#VerySecure!'
      })
    });
    const signupBody = await signupRes.json();
    assert.equal(signupRes.status, 201, `Customer signup failed: ${JSON.stringify(signupBody)}`);
    const token = signupBody.data.accessToken;

    // Complete customer profile
    const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        localityKey: 'kakkanad',
        location: { lat: 10.0158, lng: 76.3419 }
      })
    });
    const patchBody = await patchRes.json();
    assert.equal(patchRes.status, 200);
    assert.equal(patchBody.data.user.profileComplete, true);

    return {
      id: signupBody.data.user.id,
      name: `Customer ${suffix}`,
      token,
      email
    };
  }

  // Helper to create and activate a complete worker
  async function createWorker(suffix = '1') {
    const email = `worker_${suffix}_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: `Worker ${suffix}`,
        email,
        phone: `99${Math.floor(10000000 + Math.random() * 90000000)}`,
        password: 'ComplexPass123#VerySecure!'
      })
    });
    const signupBody = await signupRes.json();
    assert.equal(signupRes.status, 201, `Worker signup failed: ${JSON.stringify(signupBody)}`);
    const token = signupBody.data.accessToken;

    // Complete worker profile
    const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        localityKey: 'kakkanad',
        skills: [
          { skill: 'electrician', isMain: true },
          { skill: 'plumber', isMain: false }
        ],
        hourlyRate: 350,
        radiusKm: 5,
        bio: `Experienced electrician worker ${suffix}`
      })
    });
    const patchBody = await patchRes.json();
    assert.equal(patchRes.status, 200, `Worker profile patch failed: ${JSON.stringify(patchBody)}`);
    assert.equal(patchBody.data.user.profileComplete, true);

    return {
      id: signupBody.data.user.id,
      name: `Worker ${suffix}`,
      token,
      email
    };
  }

  // Returns next available slot at least 20 min in future conforming to worker weekly calendar
  function getFutureAvailableSlot(offsetHours = 1, hours = 1) {
    const cal = { weekly: { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'full', sun: 'full' } };
    // If offsetHours < 1, treat as fractional hour (e.g. 0.4 for 24 min)
    let cur = Date.now() + Math.max(20 * 60 * 1000, Math.round(offsetHours * 3600000));
    while (true) {
      const d = new Date(cur);
      if (isWindowAvailable(cal, d, hours)) {
        return d.toISOString();
      }
      cur += 3600000;
    }
  }

  // -------------------------------------------------------------------------
  // 1. BOOKING CREATION TESTS
  // -------------------------------------------------------------------------
  describe('Booking Creation (POST /bookings)', () => {
    it('requires Idempotency-Key header (missing gives 400 KEY_REQUIRED)', async () => {
      const customer = await createCustomer('c_idemp');
      const worker = await createWorker('w_idemp');

      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: future,
          hours: 2,
          note: 'Fix wiring'
        })
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error?.code, 'KEY_REQUIRED');
    });

    it('replays same booking when identical Idempotency-Key is reused', async () => {
      const customer = await createCustomer('c_replay');
      const worker = await createWorker('w_replay');

      const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const idempKey = `test-key-${Date.now()}-abc`;

      const payload = {
        workerId: worker.id,
        scheduledAt: future,
        hours: 2,
        note: 'Switch repair'
      };

      const res1 = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': idempKey
        },
        body: JSON.stringify(payload)
      });
      const body1 = await res1.json();
      assert.equal(res1.status, 201);
      const bookingId = body1.data.booking.id;

      // Privacy scan on booking summary
      assertNoSensitiveFields(body1);

      // Second request with same key & body
      const res2 = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': idempKey
        },
        body: JSON.stringify(payload)
      });
      const body2 = await res2.json();
      assert.equal(res2.status, 201);
      assert.equal(res2.headers.get('Idempotent-Replay'), 'true');
      assert.equal(body2.data.booking.id, bookingId);

      // Verify only 1 booking was created in DB
      const count = await Booking.countDocuments({ customerId: customer.id });
      assert.equal(count, 1);
    });

    it('rejects booking by worker or self-booking', async () => {
      const worker = await createWorker('w_self');
      const future = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

      // Worker calling POST /bookings -> 403 FORBIDDEN_ROLE
      const res1 = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`,
          'Idempotency-Key': `key-worker-book-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: future,
          hours: 2
        })
      });
      assert.equal(res1.status, 403);
    });

    it('returns 404 for unknown worker id', async () => {
      const customer = await createCustomer('c_unknown_w');
      const future = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

      const res = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-unknown-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: new mongoose.Types.ObjectId().toString(),
          scheduledAt: future,
          hours: 2
        })
      });
      assert.equal(res.status, 404);
    });

    it('respects calendar blocked dates and schedule boundaries', async () => {
      const customer = await createCustomer('c_cal');
      const worker = await createWorker('w_cal');

      // Block a date on the worker
      const blockedDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await User.findByIdAndUpdate(worker.id, {
        $push: { 'calendar.blockedDates': { date: blockedDate, reason: 'Personal' } }
      });

      const clashTime = new Date(`${blockedDate}T10:00:00.000Z`).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-cal-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: clashTime,
          hours: 2
        })
      });
      const body = await res.json();
      assert.equal(res.status, 409);
      assert.equal(body.error?.code, 'NOT_AVAILABLE');
    });

    it('detects overlap with pending booking, but allows touching times', async () => {
      const customer1 = await createCustomer('c_ov1');
      const customer2 = await createCustomer('c_ov2');
      const worker = await createWorker('w_ov');

      const baseDate = new Date(getFutureAvailableSlot(1, 4));
      const baseTime = baseDate.getTime();
      const start1 = baseDate.toISOString();

      // Booking 1: 2 hours (e.g. T to T+2h)
      const res1 = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer1.token}`,
          'Idempotency-Key': `key-ov1-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: start1,
          hours: 2
        })
      });
      assert.equal(res1.status, 201);

      // Overlapping booking: T+1h (overlaps with T..T+2h) -> 409 TIME_CLASH
      const overlapStart = new Date(baseTime + 1 * 60 * 60 * 1000).toISOString();
      const resOverlap = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer2.token}`,
          'Idempotency-Key': `key-ov2-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: overlapStart,
          hours: 2
        })
      });
      const bodyOverlap = await resOverlap.json();
      assert.equal(resOverlap.status, 409);
      assert.equal(bodyOverlap.error?.code, 'TIME_CLASH');

      // Touching time: exactly T+2h (allowed)
      const touchingStart = new Date(baseTime + 2 * 60 * 60 * 1000).toISOString();
      const resTouching = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer2.token}`,
          'Idempotency-Key': `key-touch-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: touchingStart,
          hours: 2
        })
      });
      const resTouchingBody = await resTouching.json();
      assert.equal(resTouching.status, 201, `Touching booking failed: ${JSON.stringify(resTouchingBody)}`);
    });

    it('10 parallel bookings for same worker and slot give EXACTLY 1 success and 9 TIME_CLASH', async () => {
      const customers = await Promise.all(
        Array.from({ length: 10 }).map((_, i) => createCustomer(`c_par_${i}`))
      );
      const worker = await createWorker('w_parallel');

      const slotTime = getFutureAvailableSlot(1, 2);

      const results = await Promise.all(
        customers.map((c, i) =>
          fetch(`${baseUrl}/api/v1/bookings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${c.token}`,
              'Idempotency-Key': `key-par-slot-${i}-${Date.now()}`
            },
            body: JSON.stringify({
              workerId: worker.id,
              scheduledAt: slotTime,
              hours: 2
            })
          }).then(async (r) => ({ status: r.status, body: await r.json() }))
        )
      );

      const successes = results.filter((r) => r.status === 201);
      const clashes = results.filter((r) => r.status === 409 && r.body.error?.code === 'TIME_CLASH');

      assert.equal(successes.length, 1, 'Exactly one parallel booking must succeed');
      assert.equal(clashes.length, 9, 'Exactly 9 parallel bookings must fail with TIME_CLASH');
    });

    it('stored codes are encrypted "v1:..." strings that decrypt with right AAD and not another id or step', async () => {
      const customer = await createCustomer('c_enc');
      const worker = await createWorker('w_enc');

      const future = getFutureAvailableSlot(1, 1);
      const res = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-enc-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: future,
          hours: 1
        })
      });
      const body = await res.json();
      assert.equal(res.status, 201);
      const bookingId = body.data.booking.id;

      // Query raw database document with select('+startCodeEnc +finishCodeEnc')
      const doc = await Booking.findById(bookingId).select('+startCodeEnc +finishCodeEnc');
      assert.ok(doc.startCodeEnc.startsWith('v1:'), 'startCodeEnc must start with v1:');
      assert.ok(doc.finishCodeEnc.startsWith('v1:'), 'finishCodeEnc must start with v1:');

      // Decrypt with correct AAD
      const decryptedStart = decryptCode(doc.startCodeEnc, CODES_ENC_KEY, bookingId.toString(), 'start');
      assert.match(decryptedStart, /^\d{4}$/);

      const decryptedFinish = decryptCode(doc.finishCodeEnc, CODES_ENC_KEY, bookingId.toString(), 'finish');
      assert.match(decryptedFinish, /^\d{4}$/);

      // Decryption with wrong step fails
      assert.throws(() => {
        decryptCode(doc.startCodeEnc, CODES_ENC_KEY, bookingId.toString(), 'finish');
      });

      // Decryption with wrong bookingId fails
      assert.throws(() => {
        decryptCode(doc.startCodeEnc, CODES_ENC_KEY, new mongoose.Types.ObjectId().toString(), 'start');
      });
    });
  });

  // -------------------------------------------------------------------------
  // 2. VISIBILITY & CONTACT RELEASE TESTS (H5)
  // -------------------------------------------------------------------------
  describe('Visibility and Contact Release Rules (H5)', () => {
    it('non-participant gets same 404 as unknown id across all booking endpoints', async () => {
      const customer = await createCustomer('c_vis1');
      const worker = await createWorker('w_vis1');
      const outsiderCust = await createCustomer('c_outsider');
      const outsiderWork = await createWorker('w_outsider');

      const future = getFutureAvailableSlot(1, 1);
      const createRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-vis-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: future,
          hours: 1
        })
      });
      const booking = (await createRes.json()).data.booking;

      // Both roles or customer-facing endpoints: outsider customer gets 404
      const customerEndpoints = [
        { method: 'GET', path: `/api/v1/bookings/${booking.id}` },
        { method: 'GET', path: `/api/v1/bookings/${booking.id}/codes` },
        { method: 'GET', path: `/api/v1/bookings/${booking.id}/receipt` },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/cancel` },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/finish`, body: { finishCode: '1234', paidCash: true, rating: 5 } }
      ];

      for (const ep of customerEndpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${outsiderCust.token}`
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined
        });
        assert.equal(res.status, 404, `Outsider on ${ep.method} ${ep.path} must return 404`);
      }

      // Worker-only endpoints: outsider worker gets 404 (non-participant)
      const workerEndpoints = [
        { method: 'GET', path: `/api/v1/bookings/${booking.id}` },
        { method: 'GET', path: `/api/v1/bookings/${booking.id}/receipt` },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/cancel` },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/confirm` },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/start`, body: { code: '1234' } },
        { method: 'POST', path: `/api/v1/bookings/${booking.id}/report`, body: { category: 'other' } }
      ];

      for (const ep of workerEndpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${outsiderWork.token}`
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined
        });
        assert.equal(res.status, 404, `Outsider worker on ${ep.method} ${ep.path} must return 404`);
      }
    });

    it('pending booking detail has NO contact; confirmed detail reveals phone and (worker only) jobLocation', async () => {
      const customer = await createCustomer('c_cont');
      const worker = await createWorker('w_cont');

      const future = getFutureAvailableSlot(1, 1);
      const createRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-cont-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt: future,
          hours: 1
        })
      });
      const bookingId = (await createRes.json()).data.booking.id;

      // While PENDING: neither party gets phone or jobLocation
      const pendingCust = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const pendingCustBody = await pendingCust.json();
      assert.equal(pendingCustBody.data.booking.contact, null);
      assert.equal(pendingCustBody.data.booking.jobLocation, undefined);
      assertNoSensitiveFields(pendingCustBody);

      const pendingWork = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const pendingWorkBody = await pendingWork.json();
      assert.equal(pendingWorkBody.data.booking.contact, null);
      assert.equal(pendingWorkBody.data.booking.jobLocation, undefined);
      assertNoSensitiveFields(pendingWorkBody);

      // Worker confirms booking
      const confirmRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(confirmRes.status, 200);

      // Now CONFIRMED:
      // Customer sees worker's name and phone, but NOT jobLocation
      const confCust = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const confCustBody = await confCust.json();
      assert.ok(confCustBody.data.booking.contact?.phone);
      assert.equal(confCustBody.data.booking.jobLocation, undefined);
      assertNoSensitiveFields(confCustBody, { allowPhone: true });

      // Worker sees customer's name, phone, AND jobLocation { lat, lng, localityName }
      const confWork = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const confWorkBody = await confWork.json();
      assert.ok(confWorkBody.data.booking.contact?.phone);
      assert.ok(confWorkBody.data.booking.jobLocation?.lat);
      assert.ok(confWorkBody.data.booking.jobLocation?.lng);
      assertNoSensitiveFields(confWorkBody, { allowPhone: true, allowJobLocation: true });

      // Worker can NEVER fetch codes (404)
      const workerCodes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(workerCodes.status, 404);

      // Customer CAN fetch codes with Cache-Control: no-store
      const custCodes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      assert.equal(custCodes.status, 200);
      assert.match(custCodes.headers.get('cache-control') || '', /no-store/);
      const codesData = (await custCodes.json()).data;
      assert.match(codesData.startCode, /^\d{4}$/);
      assert.match(codesData.finishCode, /^\d{4}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 3. CONFIRM & CANCEL TESTS (H10)
  // -------------------------------------------------------------------------
  describe('Confirm and Cancel Lifecycle (H10)', () => {
    it('handles confirm state restrictions and repeated cancellation warnings', async () => {
      const customer = await createCustomer('c_canc');
      const worker = await createWorker('w_canc');

      // Create booking 1
      const future = getFutureAvailableSlot(2, 1);
      const b1 = await (
        await fetch(`${baseUrl}/api/v1/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`,
            'Idempotency-Key': `key-canc-1-${Date.now()}`
          },
          body: JSON.stringify({
            workerId: worker.id,
            scheduledAt: future,
            hours: 1
          })
        })
      ).json();
      const b1Id = b1.data.booking.id;

      // Customer cannot confirm (403)
      const custConf = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      assert.equal(custConf.status, 403);

      // Worker confirms
      const wConf = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(wConf.status, 200);

      // Double confirm fails with 409 INVALID_STATE
      const wDoubleConf = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(wDoubleConf.status, 409);

      // Worker cancels confirmed booking 1 (1st cancellation in 30d)
      const c1 = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ reason: 'Emergency' })
      });
      const c1Body = await c1.json();
      assert.equal(c1.status, 200, `Worker cancel failed: ${JSON.stringify(c1Body)}`);

      // Confirm after cancel fails with 409
      const wConfAfterCanc = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(wConfAfterCanc.status, 409);

      // Repeat cancel is safe (returns same success)
      const c1Repeat = await fetch(`${baseUrl}/api/v1/bookings/${b1Id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(c1Repeat.status, 200);

      // Create and confirm 2nd booking -> cancel
      const b2 = await (
        await fetch(`${baseUrl}/api/v1/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`,
            'Idempotency-Key': `key-canc-2-${Date.now()}`
          },
          body: JSON.stringify({
            workerId: worker.id,
            scheduledAt: getFutureAvailableSlot(4, 1),
            hours: 1
          })
        })
      ).json();
      await fetch(`${baseUrl}/api/v1/bookings/${b2.data.booking.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      await fetch(`${baseUrl}/api/v1/bookings/${b2.data.booking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });

      // Create and confirm 3rd booking -> 3rd cancellation within 30d triggers REPEATED_CANCELLATIONS warning
      const b3 = await (
        await fetch(`${baseUrl}/api/v1/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`,
            'Idempotency-Key': `key-canc-3-${Date.now()}`
          },
          body: JSON.stringify({
            workerId: worker.id,
            scheduledAt: getFutureAvailableSlot(6, 1),
            hours: 1
          })
        })
      ).json();
      await fetch(`${baseUrl}/api/v1/bookings/${b3.data.booking.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const c3 = await fetch(`${baseUrl}/api/v1/bookings/${b3.data.booking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const c3Body = await c3.json();
      assert.equal(c3.status, 200);
      assert.equal(c3Body.data.warning, 'REPEATED_CANCELLATIONS');
    });
  });

  // -------------------------------------------------------------------------
  // 4. START HANDSHAKE & ATTEMPT LOCKOUT TESTS
  // -------------------------------------------------------------------------
  describe('Start Handshake and Attempt Lockout', () => {
    it('enforces early window, attempt counting (4,3,2,1), lockout, and location checks', async () => {
      const customer = await createCustomer('c_start');
      const worker = await createWorker('w_start');

      // Schedule booking 20 minutes from now (inside the 60-min window)
      const scheduledAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-start-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt,
          hours: 1
        })
      });
      const bookingId = (await bRes.json()).data.booking.id;

      // Confirm
      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });

      // Get real codes
      const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const { startCode, finishCode } = (await codesRes.json()).data;

      // Finish code should not work as start code
      const wrongRoleCode = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: finishCode })
      });
      const wrBody = await wrongRoleCode.json();
      assert.equal(wrongRoleCode.status, 400);
      assert.equal(wrBody.error?.code, 'WRONG_CODE');
      assert.equal(wrBody.error?.attemptsLeft, 4);

      // Wrong guesses: 2nd, 3rd, 4th
      for (let expectedLeft = 3; expectedLeft >= 1; expectedLeft--) {
        const res = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${worker.token}`
          },
          body: JSON.stringify({ code: '0000' })
        });
        const b = await res.json();
        assert.equal(res.status, 400);
        assert.equal(b.error?.attemptsLeft, expectedLeft);
      }

      // 5th wrong guess locks for 10 minutes -> 429 CODE_LOCKED
      const lockRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: '0000' })
      });
      const lockBody = await lockRes.json();
      assert.equal(lockRes.status, 429);
      assert.equal(lockBody.error?.code, 'CODE_LOCKED');

      // Right code during lock is refused with 429 CODE_LOCKED
      const rightDuringLock = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: startCode })
      });
      assert.equal(rightDuringLock.status, 429);

      // Advance lock time directly in DB to test lock expiry
      await Booking.findByIdAndUpdate(bookingId, {
        $set: { startCodeLockUntil: new Date(Date.now() - 1000) }
      });

      // Right code now succeeds! Test location beyond 500m -> warning FAR_FROM_JOB
      // Customer was kakkanad (lat: 10.0158, lng: 76.3419)
      // Pass coordinates ~1km away
      const startSuccess = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          code: startCode,
          location: { lat: 10.025, lng: 76.350 }
        })
      });
      const startBody = await startSuccess.json();
      assert.equal(startSuccess.status, 200);
      assert.equal(startBody.data.warning, 'FAR_FROM_JOB');
      assert.equal(startBody.data.booking.status, 'in_progress');

      // Privacy check (worker participant on in_progress booking has phone and jobLocation released per H5)
      assertNoSensitiveFields(startBody, { allowPhone: true, allowJobLocation: true });
      assertNoRealBookingCodes(startBody, startCode, finishCode);
    });

    it('refuses start earlier than 60 minutes before scheduledAt (TOO_EARLY)', async () => {
      const customer = await createCustomer('c_early');
      const worker = await createWorker('w_early');

      // Scheduled 90 minutes in future (>60 min window)
      const scheduledAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-early-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt,
          hours: 1
        })
      });
      const bookingId = (await bRes.json()).data.booking.id;

      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });

      const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const { startCode } = (await codesRes.json()).data;

      const earlyStart = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: startCode })
      });
      const earlyBody = await earlyStart.json();
      assert.equal(earlyStart.status, 409);
      assert.equal(earlyBody.error?.code, 'TOO_EARLY');
    });
  });

  // -------------------------------------------------------------------------
  // 5. FINISH HANDSHAKE, RECEIPT & PASSPORT TRANSACTION TESTS
  // -------------------------------------------------------------------------
  describe('Finish Handshake, Receipt and Work Passport Creation', () => {
    it('executes atomic finish transaction, creates passport entry, and returns receipt', async () => {
      const customer = await createCustomer('c_fin');
      const worker = await createWorker('w_fin');

      const scheduledAt = getFutureAvailableSlot(0.4, 2);
      const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-fin-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt,
          hours: 2,
          note: 'Full house rewire'
        })
      });
      const bookingId = (await bRes.json()).data.booking.id;

      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });

      const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const { startCode, finishCode } = (await codesRes.json()).data;

      // Start booking
      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: startCode })
      });

      // Finish validations:
      // 1. paidCash false -> 400 PAID_CASH_REQUIRED
      const noCash = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          finishCode,
          paidCash: false,
          rating: 5
        })
      });
      assert.equal(noCash.status, 400);

      // 2. Rating 0 and 6 -> 400
      const badRating = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          finishCode,
          paidCash: true,
          rating: 6
        })
      });
      assert.equal(badRating.status, 400);

      // 3. Comment with phone number -> 400
      const phoneComment = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          finishCode,
          paidCash: true,
          rating: 5,
          comment: 'Call me at 9876543210 next time'
        })
      });
      assert.equal(phoneComment.status, 400);

      // Successful finish!
      const finishRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          finishCode,
          paidCash: true,
          rating: 5,
          comment: 'Outstanding electrical work!'
        })
      });
      const finishBody = await finishRes.json();
      assert.equal(finishRes.status, 200);

      const receipt = finishBody.data.receipt;
      assert.ok(receipt.recordId);
      assert.equal(receipt.paymentNote, 'Cash payment reported by customer');
      assert.equal(receipt.agreedRate, 350);
      assert.equal(receipt.cashAmount, 700); // 350 * 2 booked hours
      assert.equal(receipt.rating, 5);

      // Privacy checks on receipt
      assertNoSensitiveFields(finishBody);
      assertNoRealBookingCodes(finishBody, startCode, finishCode);

      // Verify DB state: exactly 1 passport entry with seq 1 and 64-zero prevHash
      const entry = await PassportEntry.findOne({ bookingId });
      assert.ok(entry);
      assert.equal(entry.seq, 1);
      assert.equal(entry.prevHash, '0'.repeat(64));
      assert.equal(entry.rating, 5);
      assert.ok(entry.hash);
      assert.equal(entry.employerName, customer.name); // Private real name stored in DB

      // Check worker document updated
      const workerDoc = await User.findById(worker.id);
      assert.equal(workerDoc.passportStats.jobs, 1);
      assert.equal(workerDoc.passportStats.avgRating, 5);
      assert.equal(workerDoc.passportHead.seq, 1);
      assert.equal(workerDoc.passportHead.hash, entry.hash);

      // GET /bookings/:id/receipt works for both participants
      const getRecCust = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/receipt`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      assert.equal(getRecCust.status, 200);

      const getRecWork = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/receipt`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(getRecWork.status, 200);
    });

    it('two parallel finishes of the SAME booking give exactly one entry and one 409 INVALID_STATE', async () => {
      const customer = await createCustomer('c_par_fin');
      const worker = await createWorker('w_par_fin');

      const scheduledAt = getFutureAvailableSlot(0.4, 1);
      const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-parfin-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt,
          hours: 1
        })
      });
      const bookingId = (await bRes.json()).data.booking.id;

      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });

      const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const { startCode, finishCode } = (await codesRes.json()).data;

      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: startCode })
      });

      // Send 2 parallel finishes without idempotency key
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`
          },
          body: JSON.stringify({ finishCode, paidCash: true, rating: 5 })
        }),
        fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`
          },
          body: JSON.stringify({ finishCode, paidCash: true, rating: 5 })
        })
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 409]);

      // Exactly 1 passport entry exists
      const entries = await PassportEntry.find({ bookingId });
      assert.equal(entries.length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. PASSPORT VERIFICATION & ALL 10 TAMPER TESTS
  // -------------------------------------------------------------------------
  describe('Passport View and 10 Raw MongoDB Tamper Tests', () => {
    let worker;
    let customer;
    let recordIds = [];

    before(async () => {
      customer = await createCustomer('c_tamper');
      worker = await createWorker('w_tamper');

      // Create and finish 3 sequential bookings to build a 3-record chain
      for (let i = 0; i < 3; i++) {
        const scheduledAt = getFutureAvailableSlot(0.4, 1);
        const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`,
            'Idempotency-Key': `key-tamp-${i}-${Date.now()}`
          },
          body: JSON.stringify({
            workerId: worker.id,
            scheduledAt,
            hours: 1
          })
        });
        const bookingId = (await bRes.json()).data.booking.id;

        await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${worker.token}` }
        });

        const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
          headers: { Authorization: `Bearer ${customer.token}` }
        });
        const { startCode, finishCode } = (await codesRes.json()).data;

        await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${worker.token}`
          },
          body: JSON.stringify({ code: startCode })
        });

        const finRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/finish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customer.token}`
          },
          body: JSON.stringify({ finishCode, paidCash: true, rating: 4 + (i % 2) })
        });
        const rec = (await finRes.json()).data.receipt;
        recordIds.push(rec.recordId);
      }
    });

    it('baseline: 3-record chain verifies as valid', async () => {
      const vRes = await fetch(`${baseUrl}/api/v1/workers/${worker.id}/passport/verify`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const vBody = await vRes.json();
      assert.equal(vRes.status, 200);
      assert.equal(vBody.data.status, 'valid');
      assert.equal(vBody.data.records, 3);
    });

    it('viewer sees masked names and privateIncludedCount; worker sees /passport/me', async () => {
      // Customer view: visible entries only, masked names
      const pubRes = await fetch(`${baseUrl}/api/v1/workers/${worker.id}/passport`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const pubBody = await pubRes.json();
      assert.equal(pubRes.status, 200);
      assert.equal(pubBody.data.entries.length, 3);
      assert.equal(pubBody.data.privateIncludedCount, 0);
      assert.match(pubBody.data.entries[0].employerDisplay, /C\*\*\*/); // Masked
      assertNoSensitiveFields(pubBody, { isPassportResponse: true });

      // Worker view: /passport/me
      const meRes = await fetch(`${baseUrl}/api/v1/passport/me`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const meBody = await meRes.json();
      assert.equal(meRes.status, 200);
      assert.equal(meBody.data.entries.length, 3);
      assertNoSensitiveFields(meBody, { isPassportResponse: true });

      // Toggle first record hidden: PATCH /passport/entries/:id
      const patchRes = await fetch(`${baseUrl}/api/v1/passport/entries/${recordIds[0]}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ visible: false })
      });
      assert.equal(patchRes.status, 200);

      // Now public view shows 2 entries, privateIncludedCount 1, chain stays valid
      const pubAfter = await fetch(`${baseUrl}/api/v1/workers/${worker.id}/passport`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const pubAfterBody = await pubAfter.json();
      assert.equal(pubAfterBody.data.entries.length, 2);
      assert.equal(pubAfterBody.data.privateIncludedCount, 1);
      assert.equal(pubAfterBody.data.historyCheck.status, 'valid');

      // Restore visibility for tamper tests
      await fetch(`${baseUrl}/api/v1/passport/entries/${recordIds[0]}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ visible: true })
      });
    });

    // Helper to query verify status
    async function checkVerify() {
      const r = await fetch(`${baseUrl}/api/v1/workers/${worker.id}/passport/verify`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      return (await r.json()).data.status;
    }

    // 10 Tamper tests using raw collection
    it('Tamper 1: change hours -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[1] });
      await coll.updateOne({ _id: orig._id }, { $set: { hours: 99 } });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.updateOne({ _id: orig._id }, { $set: { hours: orig.hours } });
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 2: change rating -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[1] });
      await coll.updateOne({ _id: orig._id }, { $set: { rating: 1 } });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.updateOne({ _id: orig._id }, { $set: { rating: orig.rating } });
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 3: change comment -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[1] });
      await coll.updateOne({ _id: orig._id }, { $set: { comment: 'Tampered Comment' } });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.updateOne({ _id: orig._id }, { $set: { comment: orig.comment } });
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 4: change employerName -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[1] });
      await coll.updateOne({ _id: orig._id }, { $set: { employerName: 'Forged Boss' } });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.updateOne({ _id: orig._id }, { $set: { employerName: orig.employerName } });
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 5: delete a middle entry -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[1] });
      await coll.deleteOne({ _id: orig._id });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.insertOne(orig);
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 6: delete the last entry -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const orig = await coll.findOne({ recordId: recordIds[2] });
      await coll.deleteOne({ _id: orig._id });

      assert.equal(await checkVerify(), 'needs_attention');
      await coll.insertOne(orig);
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 7: reorder seq -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      // Use temporary seq: 99 to avoid duplicate key on { workerId, seq }
      await coll.updateOne({ recordId: recordIds[0] }, { $set: { seq: 99 } });
      await coll.updateOne({ recordId: recordIds[1] }, { $set: { seq: 1 } });
      await coll.updateOne({ recordId: recordIds[0] }, { $set: { seq: 2 } });

      assert.equal(await checkVerify(), 'needs_attention');

      await coll.updateOne({ recordId: recordIds[0] }, { $set: { seq: 99 } });
      await coll.updateOne({ recordId: recordIds[1] }, { $set: { seq: 2 } });
      await coll.updateOne({ recordId: recordIds[0] }, { $set: { seq: 1 } });
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 8: change passportHead -> needs_attention', async () => {
      const userColl = mongoose.connection.collection('users');
      const orig = await userColl.findOne({ _id: new mongoose.Types.ObjectId(worker.id) });
      await userColl.updateOne(
        { _id: orig._id },
        { $set: { 'passportHead.hash': 'f'.repeat(64) } }
      );

      assert.equal(await checkVerify(), 'needs_attention');
      await userColl.updateOne(
        { _id: orig._id },
        { $set: { 'passportHead.hash': orig.passportHead.hash } }
      );
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 9: change passportStats.jobs -> needs_attention', async () => {
      const userColl = mongoose.connection.collection('users');
      const orig = await userColl.findOne({ _id: new mongoose.Types.ObjectId(worker.id) });
      await userColl.updateOne(
        { _id: orig._id },
        { $set: { 'passportStats.jobs': 99 } }
      );

      assert.equal(await checkVerify(), 'needs_attention');
      await userColl.updateOne(
        { _id: orig._id },
        { $set: { 'passportStats.jobs': orig.passportStats.jobs } }
      );
      assert.equal(await checkVerify(), 'valid');
    });

    it('Tamper 10: insert duplicate bookingId -> needs_attention', async () => {
      const coll = mongoose.connection.collection('passportentries');
      const entry1 = await coll.findOne({ recordId: recordIds[0] });
      // Insert duplicate bookingId bypassing unique index by creating a temporary entry
      // or testing the duplicate bookingId check in verifyChain
      const fakeEntry = {
        ...entry1,
        _id: new mongoose.Types.ObjectId(),
        recordId: 'FAKE1234',
        seq: 4
      };
      // verifyChain checks duplicate bookingId
      const allEntries = await coll.find({ workerId: new mongoose.Types.ObjectId(worker.id) }).toArray();
      const withDup = [...allEntries, fakeEntry];
      const userDoc = await User.findById(worker.id);
      const res = verifyChain(withDup, userDoc.passportHead, userDoc.passportStats);
      assert.equal(res.status, 'needs_attention');
    });
  });

  // -------------------------------------------------------------------------
  // 7. REPORTS TESTS
  // -------------------------------------------------------------------------
  describe('Reports (POST /bookings/:id/report)', () => {
    it('worker can report in_progress booking, duplicate suppression within 24h', async () => {
      const customer = await createCustomer('c_rep');
      const worker = await createWorker('w_rep');

      const scheduledAt = getFutureAvailableSlot(0.4, 1);
      const bRes = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`,
          'Idempotency-Key': `key-rep-${Date.now()}`
        },
        body: JSON.stringify({
          workerId: worker.id,
          scheduledAt,
          hours: 1
        })
      });
      const bookingId = (await bRes.json()).data.booking.id;

      // Customer cannot report
      const custRep = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({ category: 'unsafe' })
      });
      assert.equal(custRep.status, 403);

      // Cannot report before in_progress (still pending) -> 409 INVALID_STATE
      const workRepPending = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ category: 'unsafe' })
      });
      assert.equal(workRepPending.status, 409);

      // Confirm and Start
      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const codesRes = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/codes`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const { startCode } = (await codesRes.json()).data;
      await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({ code: startCode })
      });

      // Now in_progress -> report succeeds
      const rep1 = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          category: 'unsafe',
          note: 'Exposed high voltage wiring'
        })
      });
      const rep1Body = await rep1.json();
      assert.equal(rep1.status, 200);
      assert.equal(rep1Body.data.message, 'Report received. Support will review it.');

      // Duplicate report within 24h: returns same success without creating duplicate in DB
      const rep2 = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          category: 'unsafe',
          note: 'Exposed high voltage wiring again'
        })
      });
      assert.equal(rep2.status, 200);

      const reportCount = await Report.countDocuments({
        reporterId: worker.id,
        reason: 'unsafe'
      });
      assert.equal(reportCount, 1);
    });
  });
});
