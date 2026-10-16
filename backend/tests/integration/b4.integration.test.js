import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Job } from '../../src/models/Job.js';
import { Booking } from '../../src/models/Booking.js';
import { RateStats } from '../../src/models/RateStats.js';
import { IdempotencyKey } from '../../src/models/IdempotencyKey.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { clock } from '../../src/utils/clock.js';
import { recomputeRateStats } from '../../src/services/compassService.js';
import { decryptCode } from '../../../shared/codesCrypto.js';
import { getLocalityByKey } from '../../../shared/localities.js';

describe('B4 Search, Fair Rate Compass, Jobs Integration Suite', () => {
  let mongod;
  let server;
  let baseUrl;

  const CODES_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET: 'super_secret_access_key_at_least_32_bytes_long_123456',
    JWT_REFRESH_SECRET: 'super_secret_refresh_key_at_least_32_bytes_long_123456',
    CODES_ENC_KEY,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri() + 'workcred_b4_test';
    await mongoose.connect(uri);

    // Ensure 2dsphere indexes are built
    await Promise.all([
      User.init(),
      Job.init(),
      Booking.init(),
      RateStats.init(),
      IdempotencyKey.init()
    ]);

    const app = createApp(testConfig);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    clock.restore();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  async function registerAndLogin(role, name, email, phone) {
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        name,
        email,
        phone,
        password: 'K8#mQ2$vL9!pX5*jW4'
      })
    });
    const signupBody = await signupRes.json();
    assert.equal(signupRes.status, 201, `Signup failed: ${JSON.stringify(signupBody)}`);
    return {
      id: signupBody.data.user.id,
      token: signupBody.data.accessToken
    };
  }

  describe('1. Worker Search & Worker Profile Viewer', () => {
    let customerUser;
    let worker1, worker2;

    before(async () => {
      customerUser = await registerAndLogin('customer', 'Search Customer', 'scust@example.com', '9811122233');
      // Set customer locality to edapally
      const custPatchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({ localityKey: 'edapally' })
      });
      assert.equal(custPatchRes.status, 200);

      // Create 25 workers with heavy ties across rate, distance, and rating
      // Edapally coords: [76.3075, 10.0261]
      // Kaloor coords: [76.2995, 9.9984] (~3.5km)
      for (let i = 1; i <= 25; i++) {
        const email = `worker_search_${i}@example.com`;
        const phone = `98200000${String(i).padStart(2, '0')}`;
        const w = await registerAndLogin('worker', `Worker ${i}`, email, phone);

        const locality = i <= 15 ? 'edapally' : 'kaloor';
        const locDoc = getLocalityByKey(locality);

        // Daily rate only for odd workers to test hourlyEquivalent
        const hourlyRate = i % 2 === 0 ? 150 : null;
        const dailyRate = i % 2 !== 0 ? 1200 : null; // 1200 / 8 = 150 (ties)

        // Complete profile
        const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${w.token}`
          },
          body: JSON.stringify({
            localityKey: locality,
            skills: [{ skill: 'electrician', isMain: true }],
            hourlyRate,
            dailyRate,
            radiusKm: 10,
            bio: `Experienced electrician number ${i}`
          })
        });
        const patchBody = await patchRes.json();
        assert.equal(patchRes.status, 200, `Worker ${i} profile patch failed: ${JSON.stringify(patchBody)}`);

        // Set ratings for some workers via direct DB update to test minRating and rating sort
        if (i % 3 === 0) {
          await User.updateOne(
            { _id: w.id },
            { $set: { 'passportStats.avgRating': 4.5, 'passportStats.jobs': 5 } }
          );
        }

        if (i === 1) worker1 = w;
        if (i === 2) worker2 = w;
      }
    });

    it('rejects caller without area with 400 SET_AREA', async () => {
      const freshUser = await registerAndLogin('customer', 'No Area Cust', 'noarea@example.com', '9899988877');
      const res = await fetch(`${baseUrl}/api/v1/workers?skill=electrician`, {
        headers: { 'Authorization': `Bearer ${freshUser.token}` }
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, 'SET_AREA');
    });

    it('filters by skill and excludes caller from their own search', async () => {
      const res = await fetch(`${baseUrl}/api/v1/workers?skill=electrician`, {
        headers: { 'Authorization': `Bearer ${worker1.token}` }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assertNoSensitiveFields(body);

      const returnedIds = body.data.workers.map(w => w.id);
      assert.ok(!returnedIds.includes(worker1.id), 'Worker must not appear in own search');
    });

    it('filters by minRate and maxRate based on effective hourly rate', async () => {
      const res = await fetch(`${baseUrl}/api/v1/workers?skill=electrician&minRate=140&maxRate=160`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assertNoSensitiveFields(body);
      assert.ok(body.data.workers.length > 0);
      for (const w of body.data.workers) {
        assert.equal(w.rate.effectiveHourly, 150);
      }
    });

    it('minRating excludes unrated workers', async () => {
      const res = await fetch(`${baseUrl}/api/v1/workers?skill=electrician&minRating=4`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assertNoSensitiveFields(body);
      assert.ok(body.data.workers.length > 0);
      for (const w of body.data.workers) {
        assert.ok(w.rating !== null && w.rating >= 4);
      }
    });

    it('pagination walk with limit 2 over 25 workers collects every worker exactly once (ties handled)', async () => {
      const seenIds = new Set();
      let cursor = null;
      let pageCount = 0;

      while (true) {
        const url = `${baseUrl}/api/v1/workers?skill=electrician&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${customerUser.token}` }
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assertNoSensitiveFields(body);

        for (const w of body.data.workers) {
          assert.ok(!seenIds.has(w.id), `Duplicate worker ID in pagination: ${w.id}`);
          seenIds.add(w.id);
        }

        cursor = body.data.nextCursor;
        pageCount++;
        if (!cursor) break;
      }

      assert.equal(seenIds.size, 25, 'All 25 workers should be seen across pagination pages without skips');
      assert.ok(pageCount >= 13, 'Expected at least 13 pages with limit 2');
    });

    it('tampered cursor gives 400 BAD_CURSOR', async () => {
      const res = await fetch(`${baseUrl}/api/v1/workers?skill=electrician&cursor=tampered_cursor_123`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, 'BAD_CURSOR');
    });

    it('GET /workers/:id returns viewer profile with availabilitySummary and blocked count, no secrets', async () => {
      // Add blocked dates to worker1
      await User.updateOne(
        { _id: worker1.id },
        {
          $set: {
            'calendar.blockedDates': [
              { date: '2026-10-25', reason: 'Family function' },
              { date: '2026-10-28', reason: 'Doctor appointment' },
              { date: '2026-12-01', reason: 'Vacation' } // > 14 days ahead
            ]
          }
        }
      );

      const res = await fetch(`${baseUrl}/api/v1/workers/${worker1.id}`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assertNoSensitiveFields(body);

      const profile = body.data.worker;
      assert.equal(profile.id, worker1.id);
      assert.ok(profile.availabilitySummary);
      assert.equal(profile.availabilitySummary.weekly.length, 7);
      // Next 14 days should count the 2 dates in Oct, not Dec
      assert.equal(profile.availabilitySummary.blockedNext14DaysCount, 2);
      assert.ok(!profile.availabilitySummary.blockedDates, 'Blocked dates array must not be exposed');
    });

    it('GET /workers/:id returns 404 for unknown id, invalid id, or inactive worker', async () => {
      const r1 = await fetch(`${baseUrl}/api/v1/workers/invalid_hex_id`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(r1.status, 404);

      const r2 = await fetch(`${baseUrl}/api/v1/workers/000000000000000000000000`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(r2.status, 404);

      // Inactive worker gives 404
      await User.updateOne({ _id: worker2.id }, { $set: { isActive: false } });
      const r3 = await fetch(`${baseUrl}/api/v1/workers/${worker2.id}`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(r3.status, 404);
      await User.updateOne({ _id: worker2.id }, { $set: { isActive: true } });
    });
  });

  describe('2. Fair Rate Compass', () => {
    let authUser;

    before(async () => {
      authUser = await registerAndLogin('customer', 'Compass Customer', 'compcust@example.com', '9833344455');
      const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authUser.token}`
        },
        body: JSON.stringify({ localityKey: 'edapally' })
      });
      assert.equal(patchRes.status, 200);
    });

    it('returns SAMPLE baseline when no rateStats data exist', async () => {
      const res = await fetch(`${baseUrl}/api/v1/compass?skill=electrician&localityKey=edapally&rate=125`, {
        headers: { 'Authorization': `Bearer ${authUser.token}` }
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assertNoSensitiveFields(body);

      assert.equal(body.data.source, 'baseline');
      assert.equal(body.data.isSample, true);
      assert.equal(body.data.note, 'Based on sample rates for now');
      assert.equal(body.data.label, 'fair');
    });

    it('recomputeRateStats excludes 91-day-old bookings and includes 90-day-old bookings', async () => {
      const fixedNow = new Date('2026-10-20T10:00:00.000Z');
      clock.freeze(fixedNow);

      try {
        const workerUser = await registerAndLogin('worker', 'Booking Worker', 'bworker@example.com', '9844433322');
        const custId = new mongoose.Types.ObjectId(authUser.id);
        const workId = new mongoose.Types.ObjectId(workerUser.id);

        // Booking 1: finished 91 days ago (excluded)
        const date91DaysAgo = new Date(fixedNow.getTime() - 91 * 24 * 60 * 60 * 1000);
        await Booking.create({
          jobId: new mongoose.Types.ObjectId(),
          customerId: custId,
          workerId: workId,
          skill: 'plumber',
          localityKey: 'edapally',
          agreedRate: 50,
          scheduledAt: date91DaysAgo,
          hours: 2,
          status: 'completed',
          finishedAt: date91DaysAgo,
          locationSnapshot: { type: 'Point', coordinates: [76.3075, 10.0261] },
          startCodeEnc: 'dummy',
          finishCodeEnc: 'dummy'
        });

        // Bookings 2-6: finished 89 days ago (5 samples -> sampleSize = 5)
        const date89DaysAgo = new Date(fixedNow.getTime() - 89 * 24 * 60 * 60 * 1000);
        const rates = [120, 140, 160, 180, 200];
        for (const r of rates) {
          await Booking.create({
            jobId: new mongoose.Types.ObjectId(),
            customerId: custId,
            workerId: workId,
            skill: 'plumber',
            localityKey: 'edapally',
            agreedRate: r,
            scheduledAt: date89DaysAgo,
            hours: 2,
            status: 'completed',
            finishedAt: date89DaysAgo,
            locationSnapshot: { type: 'Point', coordinates: [76.3075, 10.0261] },
            startCodeEnc: 'dummy',
            finishCodeEnc: 'dummy'
          });
        }

        // Recompute stats
        await recomputeRateStats('plumber', 'edapally', clock);

        // Now query compass
        const res = await fetch(`${baseUrl}/api/v1/compass?skill=plumber&localityKey=edapally&rate=160`, {
          headers: { 'Authorization': `Bearer ${authUser.token}` }
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assertNoSensitiveFields(body);

        assert.equal(body.data.source, 'locality');
        assert.equal(body.data.sampleSize, 5);
        assert.equal(body.data.isSample, false);
        assert.equal(body.data.median, 160);
        assert.equal(body.data.label, 'fair');
      } finally {
        clock.restore();
      }
    });

    it('rejects unknown skill with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/compass?skill=astronaut&localityKey=edapally`, {
        headers: { 'Authorization': `Bearer ${authUser.token}` }
      });
      assert.equal(res.status, 400);
    });
  });

  describe('3. Jobs & Bookings Flow (Atomicity, Oversell Prevention, Codes)', () => {
    let customerUser;
    let worker1, worker2, worker3;

    function getNextMorningIST(dayOffset = 1, hourIST = 10) {
      // 10:00 AM IST = 04:30 UTC
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + dayOffset);
      d.setUTCHours(hourIST - 5, 30, 0, 0);
      return d.toISOString();
    }

    before(async () => {
      customerUser = await registerAndLogin('customer', 'Job Poster', 'jobpost@example.com', '9855566677');
      const custPatchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({ localityKey: 'edapally' })
      });
      assert.equal(custPatchRes.status, 200);

      worker1 = await registerAndLogin('worker', 'Job Worker 1', 'jw1@example.com', '9866677701');
      worker2 = await registerAndLogin('worker', 'Job Worker 2', 'jw2@example.com', '9866677702');
      worker3 = await registerAndLogin('worker', 'Job Worker 3', 'jw3@example.com', '9866677703');

      for (const w of [worker1, worker2, worker3]) {
        const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${w.token}`
          },
          body: JSON.stringify({
            localityKey: 'edapally',
            skills: [{ skill: 'mason', isMain: true }],
            hourlyRate: 150,
            radiusKm: 10
          })
        });
        assert.equal(patchRes.status, 200);
      }
    });

    it('customer posts a job and response includes Fair Price hint without coordinates', async () => {
      const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 2,
          hours: 4,
          startAt,
          offeredRate: 160,
          description: 'Build retaining wall in backyard'
        })
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assertNoSensitiveFields(body);

      assert.equal(body.data.job.skill, 'mason');
      assert.equal(body.data.job.workersNeeded, 2);
      assert.equal(body.data.job.totalPay, 640);
      assert.ok(body.data.job.fairRate);
    });

    it('worker cannot post a job (403)', async () => {
      const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${worker1.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 1,
          hours: 2,
          startAt,
          offeredRate: 150,
          description: 'Should fail'
        })
      });
      assert.equal(res.status, 403);
    });

    it('10 parallel accepts by 10 different workers on a 2-slot job yield EXACTLY 2 successes and 8 JOB_FULL', async () => {
      // Create a 2-slot job
      const startAt = getNextMorningIST(1, 10);
      const postRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 2,
          hours: 2,
          startAt,
          offeredRate: 175,
          description: 'Masonry brickwork repairs'
        })
      });
      const postBody = await postRes.json();
      const jobId = postBody.data.job.id;

      // Register 10 distinct workers
      const workers = [];
      for (let i = 1; i <= 10; i++) {
        const w = await registerAndLogin('worker', `Oversell Worker ${i}`, `os_w${i}@example.com`, `98700000${String(i).padStart(2, '0')}`);
        const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${w.token}`
          },
          body: JSON.stringify({
            localityKey: 'edapally',
            skills: [{ skill: 'mason', isMain: true }],
            hourlyRate: 175,
            radiusKm: 10
          })
        });
        assert.equal(patchRes.status, 200);
        workers.push(w);
      }

      // Fire 10 parallel accepts
      const acceptPromises = workers.map(w =>
        fetch(`${baseUrl}/api/v1/jobs/${jobId}/accept`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${w.token}` }
        })
      );

      const results = await Promise.all(acceptPromises);
      const bodies = await Promise.all(results.map(r => r.json()));
      const statuses = results.map(r => r.status);

      const successCount = statuses.filter(s => s === 200).length;
      const fullCount = statuses.filter(s => s === 409).length;

      assert.equal(successCount, 2, `Exactly 2 slots claimed, but got statuses: ${statuses.join(', ')}, bodies: ${JSON.stringify(bodies.slice(0, 3))}`);
      assert.equal(fullCount, 8, 'Remaining 8 got 409 JOB_FULL');

      // Verify database state: acceptedCount is 2, status is filled, exactly 2 bookings
      const jobInDb = await Job.findById(jobId);
      assert.equal(jobInDb.acceptedCount, 2);
      assert.equal(jobInDb.status, 'filled');

      const bookingsInDb = await Booking.find({ jobId }).select('+startCodeEnc +finishCodeEnc');
      assert.equal(bookingsInDb.length, 2);

      // Verify AAD binding & decrypted code format (4 digits)
      for (const b of bookingsInDb) {
        assert.ok(b.startCodeEnc.startsWith('v1:'));
        assert.ok(b.finishCodeEnc.startsWith('v1:'));
        const startPlain = decryptCode(b.startCodeEnc, CODES_ENC_KEY, b._id.toString(), 'start');
        const finishPlain = decryptCode(b.finishCodeEnc, CODES_ENC_KEY, b._id.toString(), 'finish');
        assert.match(startPlain, /^\d{4}$/);
        assert.match(finishPlain, /^\d{4}$/);
      }
    });

    it('same worker sending 5 parallel accepts gives exactly 1 booking and 4 ALREADY_ACCEPTED', async () => {
      const startAt = getNextMorningIST(2, 10);
      const postRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 5,
          hours: 2,
          startAt,
          offeredRate: 150,
          description: 'Multi-slot job'
        })
      });
      const postBody = await postRes.json();
      const jobId = postBody.data.job.id;

      const acceptPromises = Array(5).fill(null).map(() =>
        fetch(`${baseUrl}/api/v1/jobs/${jobId}/accept`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${worker1.token}` }
        })
      );

      const results = await Promise.all(acceptPromises);
      const statuses = results.map(r => r.status);

      const okCount = statuses.filter(s => s === 200).length;
      assert.equal(okCount, 1, 'Only 1 booking created for same worker');

      const bookings = await Booking.find({ jobId, workerId: worker1.id });
      assert.equal(bookings.length, 1);
    });

    it('customer cancels job and repeated cancel is safe; other customer gets 404', async () => {
      const startAt = getNextMorningIST(3, 10);
      const postRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 1,
          hours: 2,
          startAt,
          offeredRate: 150,
          description: 'Job to be cancelled'
        })
      });
      const postBody = await postRes.json();
      const jobId = postBody.data.job.id;

      // Worker 2 accepts
      const acceptRes = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${worker2.token}` }
      });
      assert.equal(acceptRes.status, 200);

      // Another customer attempts to cancel -> 404
      const otherCust = await registerAndLogin('customer', 'Other Cust', 'othercust@example.com', '9888877766');
      const badCancel = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${otherCust.token}` }
      });
      assert.equal(badCancel.status, 404);

      // Owner cancels
      const cancelRes1 = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(cancelRes1.status, 200);

      // Repeat cancel is safe
      const cancelRes2 = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(cancelRes2.status, 200);

      // Check job and booking status in db
      const job = await Job.findById(jobId);
      assert.equal(job.status, 'cancelled');

      const booking = await Booking.findOne({ jobId });
      assert.equal(booking.status, 'cancelled');
      assert.equal(booking.cancelledBy.toString(), customerUser.id);
    });

    it('in_progress booking blocks job cancellation with 409 JOB_IN_PROGRESS', async () => {
      const startAt = getNextMorningIST(4, 10);
      const postRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 1,
          hours: 2,
          startAt,
          offeredRate: 150,
          description: 'In progress test'
        })
      });
      const postBody = await postRes.json();
      const jobId = postBody.data.job.id;

      // Worker 3 accepts
      const acceptRes = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${worker3.token}` }
      });
      assert.equal(acceptRes.status, 200);

      // Simulate booking marked in_progress
      await Booking.updateOne({ jobId }, { $set: { status: 'in_progress' } });

      const cancelRes = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      assert.equal(cancelRes.status, 409);
      const cancelBody = await cancelRes.json();
      assert.equal(cancelBody.error.code, 'JOB_IN_PROGRESS');
    });

    it('read-time expiry: job past startAt disappears from GET /jobs and appears expired in /jobs/mine', async () => {
      const pastStartAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      const postRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({
          skill: 'mason',
          workersNeeded: 1,
          hours: 2,
          startAt: pastStartAt,
          offeredRate: 150,
          description: 'Expiring job'
        })
      });
      const postBody = await postRes.json();
      const jobId = postBody.data.job.id;

      // Advance clock past startAt
      clock.freeze(new Date(Date.now() + 30 * 60 * 1000));

      // Worker GET /jobs should not include it
      const workerJobsRes = await fetch(`${baseUrl}/api/v1/jobs`, {
        headers: { 'Authorization': `Bearer ${worker1.token}` }
      });
      const workerJobsBody = await workerJobsRes.json();
      const jobIds = workerJobsBody.data.jobs.map(j => j.id);
      assert.ok(!jobIds.includes(jobId), 'Expired job must not appear in worker jobs list');

      // Customer GET /jobs/mine should list it as expired
      const mineRes = await fetch(`${baseUrl}/api/v1/jobs/mine`, {
        headers: { 'Authorization': `Bearer ${customerUser.token}` }
      });
      const mineBody = await mineRes.json();
      const myJob = mineBody.data.jobs.find(j => j.id === jobId);
      assert.ok(myJob, 'Job must be in customer list');
      assert.equal(myJob.status, 'expired', 'Status must be expired at read-time');

      clock.restore();
    });
  });

  describe('4. Idempotency Middleware Suite', () => {
    let customerUser;

    before(async () => {
      customerUser = await registerAndLogin('customer', 'Idempotency User', 'idem@example.com', '9899900011');
      const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`
        },
        body: JSON.stringify({ localityKey: 'edapally' })
      });
      assert.equal(patchRes.status, 200);
    });

    it('replays response with Idempotent-Replay header for identical key and body', async () => {
      const key = 'idem_key_test_12345678';
      const body = {
        skill: 'carpenter',
        workersNeeded: 1,
        hours: 3,
        startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        offeredRate: 180,
        description: 'Install wooden shelves'
      };

      const res1 = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body)
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      // Duplicate request with same key
      const res2 = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body)
      });
      assert.equal(res2.status, 201);
      assert.equal(res2.headers.get('idempotent-replay'), 'true');
      const json2 = await res2.json();
      assert.deepEqual(json1, json2);
    });

    it('rejects key reuse with different body with 422 KEY_REUSED', async () => {
      const key = 'idem_key_test_reused_87654321';
      const body1 = {
        skill: 'carpenter',
        workersNeeded: 1,
        hours: 2,
        startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        offeredRate: 180,
        description: 'First request'
      };

      await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body1)
      });

      // Different body with same key
      const body2 = { ...body1, description: 'Completely different description' };
      const res2 = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customerUser.token}`,
          'Idempotency-Key': key
        },
        body: JSON.stringify(body2)
      });
      assert.equal(res2.status, 422);
      const errBody = await res2.json();
      assert.equal(errBody.error.code, 'KEY_REUSED');
    });
  });
});
