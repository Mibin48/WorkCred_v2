/**
 * backend/tests/integration/b7.integration.test.js
 *
 * Comprehensive integration suite for Phase B7:
 * Feed, Social, Endorsements, and Content Reports.
 *
 * Uses MongoMemoryReplSet to support MongoDB transactions.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Booking } from '../../src/models/Booking.js';
import { Post } from '../../src/models/Post.js';
import { Follow } from '../../src/models/Follow.js';
import { Endorsement } from '../../src/models/Endorsement.js';
import { Report } from '../../src/models/Report.js';
import { Job } from '../../src/models/Job.js';
import { Availability } from '../../src/models/Availability.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { clock } from '../../src/utils/clock.js';
import { getIndiaDayKey } from '../../../shared/quotaRules.js';
import { encodeFeedCursor } from '../../../shared/feedCursor.js';

describe('backend/tests/integration/b7.integration.test.js (B7 Feed, Social, Endorsements, Reports)', () => {
  let replSet;
  let server;
  let baseUrl;

  const JWT_ACCESS_SECRET = 'super_secret_access_key_at_least_32_bytes_long_123456';
  const JWT_REFRESH_SECRET = 'super_secret_refresh_key_at_least_32_bytes_long_123456';
  const CODES_ENC_KEY = Buffer.alloc(32, 'a').toString('base64');
  const CLOUDINARY_CLOUD_NAME = 'testcloud';
  const CLOUDINARY_API_KEY = 'testkey';
  const CLOUDINARY_API_SECRET = 'testsecret';

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    CODES_ENC_KEY,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri('workcred_b7_test');
    await mongoose.connect(uri, { autoIndex: true });

    await Promise.all([
      User.init(),
      Booking.init(),
      Post.init(),
      Follow.init(),
      Endorsement.init(),
      Report.init(),
      Job.init(),
      Availability.init()
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

  beforeEach(() => {
    clock.restore();
  });

  // Helpers
  async function createCustomer(tag = 'cust') {
    const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: `Customer ${tag}`,
        email,
        phone: '9845012345',
        password: 'ComplexPassword123#Secure'
      })
    });
    const body = await res.json();
    const token = body.data.accessToken;
    const id = body.data.user.id;

    await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        localityKey: 'kakkanad',
        location: { lat: 10.0159, lng: 76.3419 }
      })
    });

    return { id, token, email };
  }

  async function createWorker(tag = 'work', skills = ['electrician'], localityKey = 'kakkanad') {
    const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: `Worker ${tag}`,
        email,
        phone: '9845012345',
        password: 'ComplexPassword123#Secure'
      })
    });
    const body = await res.json();
    const token = body.data.accessToken;
    const id = body.data.user.id;

    const formattedSkills = skills.map((s, idx) => ({ skill: s, isMain: idx === 0 }));
    await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        localityKey,
        skills: formattedSkills,
        hourlyRate: 350,
        radiusKm: 5,
        bio: 'Professional verified technician'
      })
    });

    return { id, token, email };
  }

  function makePostUrl(userId, filename = 'work.jpg', folder = 'posts', cloud = 'testcloud') {
    return `https://res.cloudinary.com/${cloud}/image/upload/v12345/workcred/test/${userId}/${folder}/${filename}`;
  }

  // ---------------------------------------------------------------------------
  // 1. POSTS (POST /posts, GET /posts/mine, DELETE /posts/:id)
  // ---------------------------------------------------------------------------
  describe('Work Posts (POST /posts, GET /posts/mine, DELETE /posts/:id)', () => {
    it('creates post successfully (happy path) and scans response for privacy leaks', async () => {
      const worker = await createWorker('p_happy');
      const afterUrl = makePostUrl(worker.id, 'after.jpg');
      const beforeUrl = makePostUrl(worker.id, 'before.jpg');

      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Rewired main switchboard in kitchen',
          afterUrl,
          beforeUrl
        })
      });
      const body = await res.json();
      assert.equal(res.status, 201);
      assert.equal(body.success, true);
      const post = body.data.post;

      assert.equal(post.skill, 'electrician');
      assert.equal(post.caption, 'Rewired main switchboard in kitchen');
      assert.equal(post.afterUrl, afterUrl);
      assert.equal(post.beforeUrl, beforeUrl);
      assert.equal(post.verifiedJob, false);
      assert.equal(post.isMine, true);
      assert.ok(post.id);
      assert.ok(post.localityName);

      // Privacy scan: no bookingId, coordinates, phone, email
      assertNoSensitiveFields(body);
    });

    it('rejects photo URL from another user with 400 VALIDATION_ERROR', async () => {
      const worker = await createWorker('p_other_user');
      const otherWorker = await createWorker('p_victim');
      const stolenUrl = makePostUrl(otherWorker.id, 'stolen.jpg');

      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Good work',
          afterUrl: stolenUrl
        })
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error?.code, 'VALIDATION_ERROR');
    });

    it('rejects avatar-folder URL used as post photo with 400 VALIDATION_ERROR', async () => {
      const worker = await createWorker('p_avatar_folder');
      const avatarUrl = makePostUrl(worker.id, 'pic.jpg', 'avatar');

      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Good work',
          afterUrl: avatarUrl
        })
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error?.code, 'VALIDATION_ERROR');
    });

    it('rejects skill not in worker profile skills with 400 VALIDATION_ERROR', async () => {
      const worker = await createWorker('p_wrong_skill', ['electrician']);
      const afterUrl = makePostUrl(worker.id, 'plumb.jpg');

      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'plumber',
          caption: 'Fixed pipe',
          afterUrl
        })
      });
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error?.code, 'VALIDATION_ERROR');
    });

    it('rejects post creation by customer with 403 FORBIDDEN_ROLE', async () => {
      const customer = await createCustomer('p_cust_post');
      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customer.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Customer posting',
          afterUrl: makePostUrl(customer.id, 'photo.jpg')
        })
      });
      assert.equal(res.status, 403);
    });

    it('rejects caption containing contact info with 400 VALIDATION_ERROR', async () => {
      const worker = await createWorker('p_contact_cap');
      const res = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Call me at 9845012345 for work',
          afterUrl: makePostUrl(worker.id, 'wiring.jpg')
        })
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error?.code, 'VALIDATION_ERROR');
    });

    it('verified job rules: completed booking belonging to worker, skill match, bookingId never returned', async () => {
      const worker = await createWorker('w_vj', ['electrician', 'plumber']);
      const customer = await createCustomer('c_vj');
      const otherWorker = await createWorker('w_other_vj');

      // Create booking 1: completed, electrician
      const b1 = await Booking.create({
        customerId: customer.id,
        workerId: worker.id,
        skill: 'electrician',
        status: 'completed',
        scheduledAt: new Date(Date.now() - 3600000),
        hours: 2,
        agreedRate: 350,
        startCodeEnc: 'v1:dummy:dummy:dummy',
        finishCodeEnc: 'v1:dummy:dummy:dummy'
      });

      // Attempt to link someone else's booking -> 403 NOT_YOUR_JOB
      const resNotMine = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherWorker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Stolen booking link',
          afterUrl: makePostUrl(otherWorker.id, '1.jpg'),
          bookingId: b1._id.toString()
        })
      });
      assert.equal(resNotMine.status, 403);
      assert.equal((await resNotMine.json()).error?.code, 'NOT_YOUR_JOB');

      // Attempt to link non-completed booking -> 409 INVALID_STATE
      const bPending = await Booking.create({
        customerId: customer.id,
        workerId: worker.id,
        skill: 'electrician',
        status: 'in_progress',
        scheduledAt: new Date(),
        hours: 1,
        agreedRate: 350,
        startCodeEnc: 'v1:dummy:dummy:dummy',
        finishCodeEnc: 'v1:dummy:dummy:dummy'
      });
      const resPending = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'In progress booking link',
          afterUrl: makePostUrl(worker.id, '2.jpg'),
          bookingId: bPending._id.toString()
        })
      });
      assert.equal(resPending.status, 409);
      assert.equal((await resPending.json()).error?.code, 'INVALID_STATE');

      // Attempt to link booking with wrong skill -> 409 SKILL_MISMATCH
      const resSkillMismatch = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'plumber',
          caption: 'Skill mismatch link',
          afterUrl: makePostUrl(worker.id, '3.jpg'),
          bookingId: b1._id.toString()
        })
      });
      assert.equal(resSkillMismatch.status, 409);
      assert.equal((await resSkillMismatch.json()).error?.code, 'SKILL_MISMATCH');

      // Successful link: verifiedJob = true
      const resSuccess = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Verified wiring job',
          afterUrl: makePostUrl(worker.id, '4.jpg'),
          bookingId: b1._id.toString()
        })
      });
      const successBody = await resSuccess.json();
      assert.equal(resSuccess.status, 201);
      assert.equal(successBody.data.post.verifiedJob, true);
      assertNoSensitiveFields(successBody);

      // Second post on same booking -> 409 BOOKING_ALREADY_POSTED
      const resDupBooking = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Second post on same booking',
          afterUrl: makePostUrl(worker.id, '5.jpg'),
          bookingId: b1._id.toString()
        })
      });
      assert.equal(resDupBooking.status, 409);
      assert.equal((await resDupBooking.json()).error?.code, 'BOOKING_ALREADY_POSTED');
    });

    it('12 PARALLEL post creates for a fresh worker give EXACTLY 10 successes and 2 POST_LIMIT_DAILY', async () => {
      const worker = await createWorker('w_parallel_limit');

      const promises = Array.from({ length: 12 }, (_, i) =>
        fetch(`${baseUrl}/api/v1/posts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${worker.token}`,
            'Idempotency-Key': `post_p_${i}_${Date.now()}`
          },
          body: JSON.stringify({
            skill: 'electrician',
            caption: `Parallel post number ${i + 1}`,
            afterUrl: makePostUrl(worker.id, `post_${i}.jpg`)
          })
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 201);
      const limitHit = statuses.filter((s) => s === 429);

      assert.equal(successes.length, 10, 'Must have exactly 10 successful post creations');
      assert.equal(limitHit.length, 2, 'Must have exactly 2 requests rejected with 429 POST_LIMIT_DAILY');

      // Verify rollover after midnight IST: advance clock past midnight IST
      const now = clock.now();
      const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      clock.freeze(nextDay);

      // Now 11th post succeeds because dayKey rolled over
      const resNextDay = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Next day post after midnight',
          afterUrl: makePostUrl(worker.id, 'next_day.jpg')
        })
      });
      assert.equal(resNextDay.status, 201);
    });

    it('active cap of 100 posts is race-safe (seed 98 active posts, 5 parallel gives exactly 2 successes)', async () => {
      const worker = await createWorker('w_active_cap');

      // Seed activePostCount to 98 and postQuota with today's key directly on User document
      const todayKey = getIndiaDayKey(clock.now());
      await User.updateOne({ _id: worker.id }, { $set: { activePostCount: 98, 'postQuota.dayKey': todayKey, 'postQuota.count': 0 } });

      const promises = Array.from({ length: 5 }, (_, i) =>
        fetch(`${baseUrl}/api/v1/posts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${worker.token}`,
            'Idempotency-Key': `active_p_${i}_${Date.now()}`
          },
          body: JSON.stringify({
            skill: 'electrician',
            caption: `Active cap test post ${i + 1}`,
            afterUrl: makePostUrl(worker.id, `active_${i}.jpg`)
          })
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 201);
      const capErrors = statuses.filter((s) => s === 409);

      assert.equal(successes.length, 2, 'Exactly 2 posts must succeed to reach 100');
      assert.equal(capErrors.length, 3, '3 posts must fail with 409 POST_LIMIT_ACTIVE');
    });

    it('delete post: owner only, unknown and non-owner get identical 404, repeat is safe, counters correct', async () => {
      const worker = await createWorker('w_del_owner');
      const outsider = await createWorker('w_del_outsider');

      const createRes = await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${worker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Post to delete',
          afterUrl: makePostUrl(worker.id, 'del.jpg')
        })
      });
      const postId = (await createRes.json()).data.post.id;

      // Outsider delete -> 404
      const resOutsider = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${outsider.token}` }
      });
      assert.equal(resOutsider.status, 404);

      // Unknown id delete -> 404
      const resUnknown = await fetch(`${baseUrl}/api/v1/posts/000000000000000000000000`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(resUnknown.status, 404);

      // Owner delete -> 200
      const resOwner = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(resOwner.status, 200);

      // Verify post removed from DB
      const dbPost = await Post.findById(postId);
      assert.equal(dbPost, null);

      // Repeat delete returns 404 (post already removed)
      const resRepeat = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      assert.equal(resRepeat.status, 404);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. FEED (GET /feed)
  // ---------------------------------------------------------------------------
  describe('Unified Feed (GET /feed)', () => {
    it('nearby tab enforces 10 km radius edge, ties pagination walk over 40 posts with limit 7', async () => {
      const nearWorker = await createWorker('w_near_kochi', ['electrician'], 'kakkanad');
      const farWorker = await createWorker('w_far_aluva', ['electrician'], 'aluva'); // Aluva is ~11 km from Kakkanad (>10 km)
      const customer = await createCustomer('c_feed_viewer');

      // Create post for far worker (outside 10 km)
      await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${farWorker.token}`
        },
        body: JSON.stringify({
          skill: 'electrician',
          caption: 'Far work post in Aluva',
          afterUrl: makePostUrl(farWorker.id, 'far.jpg')
        })
      });

      // Seed 40 posts for nearWorker with shared createdAt timestamps to test ties pagination
      const sharedDate = new Date('2026-10-17T10:00:00.000Z');
      const nearLocDoc = await User.findById(nearWorker.id);

      const postDocs = Array.from({ length: 40 }, (_, i) => ({
        workerId: nearWorker.id,
        skill: 'electrician',
        caption: `Tied post #${i + 1}`,
        afterUrl: makePostUrl(nearWorker.id, `tied_${i}.jpg`),
        verifiedJob: false,
        localityKey: 'kakkanad',
        location: nearLocDoc.searchLocation,
        createdAt: sharedDate
      }));
      await Post.insertMany(postDocs);

      // Walk through all pages with limit 7
      const seenIds = new Set();
      let currentCursor = null;
      let pages = 0;

      while (true) {
        pages++;
        const url = new URL(`${baseUrl}/api/v1/feed`);
        url.searchParams.set('tab', 'nearby');
        url.searchParams.set('limit', '7');
        if (currentCursor) {
          url.searchParams.set('cursor', currentCursor);
        }

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${customer.token}` }
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assertNoSensitiveFields(body);

        const items = body.data.items;
        for (const item of items) {
          assert.ok(!seenIds.has(item.id), `Duplicate post ID ${item.id} detected across pages`);
          seenIds.add(item.id);
          assert.notEqual(item.worker.id, farWorker.id, 'Far worker post must NOT be in nearby feed (>10 km)');
        }

        currentCursor = body.data.nextCursor;
        if (!currentCursor) break;
        assert.ok(pages < 10, 'Pagination walk must terminate within reasonable pages');
      }

      assert.ok(seenIds.size >= 40, 'Must have retrieved all 40 tied posts exactly once');
    });

    it('rejects tampered feed cursor with 400 BAD_CURSOR', async () => {
      const customer = await createCustomer('c_tamper_cursor');
      const res = await fetch(`${baseUrl}/api/v1/feed?tab=nearby&cursor=tampered_garbage_token`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error?.code, 'BAD_CURSOR');
    });

    it('following tab shows only followed workers and not saved ones; unfollow removes them', async () => {
      const workerA = await createWorker('w_followed', ['electrician']);
      const workerB = await createWorker('w_saved_only', ['plumber']);
      const customer = await createCustomer('c_follower');

      // Create post for worker A and worker B
      await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerA.token}` },
        body: JSON.stringify({ skill: 'electrician', caption: 'Worker A post', afterUrl: makePostUrl(workerA.id, 'a.jpg') })
      });
      await fetch(`${baseUrl}/api/v1/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerB.token}` },
        body: JSON.stringify({ skill: 'plumber', caption: 'Worker B post', afterUrl: makePostUrl(workerB.id, 'b.jpg') })
      });

      // Follow worker A, Save worker B
      await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: workerA.id, type: 'follow' })
      });
      await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: workerB.id, type: 'save' })
      });

      // Query following tab
      const resFollow = await fetch(`${baseUrl}/api/v1/feed?tab=following`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const bodyFollow = await resFollow.json();
      assert.equal(resFollow.status, 200);
      assertNoSensitiveFields(bodyFollow);

      const items = bodyFollow.data.items;
      assert.ok(items.some((i) => i.worker.id === workerA.id), 'Worker A post must appear in following tab');
      assert.ok(!items.some((i) => i.worker.id === workerB.id), 'Worker B (saved only) post must NOT appear in following tab');

      // Unfollow worker A
      await fetch(`${baseUrl}/api/v1/follows/${workerA.id}?type=follow`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${customer.token}` }
      });

      // Query following tab again -> empty
      const resAfterUnfollow = await fetch(`${baseUrl}/api/v1/feed?tab=following`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const bodyAfter = await resAfterUnfollow.json();
      assert.equal(bodyAfter.data.items.length, 0);
    });

    it('highlights appear only on first nearby page, matching open jobs for workers and live free workers for customers', async () => {
      const worker = await createWorker('w_highlight_viewer', ['electrician']);
      const customer = await createCustomer('c_highlight_viewer');

      // Open a job for electricians
      await Job.create({
        customerId: customer.id,
        skill: 'electrician',
        workersNeeded: 1,
        hours: 2,
        startAt: new Date(Date.now() + 3600000),
        offeredRate: 400,
        description: 'Wiring job',
        localityKey: 'kakkanad',
        location: { type: 'Point', coordinates: [76.3419, 10.0159] },
        searchLocation: { type: 'Point', coordinates: [76.3419, 10.0159] }
      });

      // Start a Free Now window for worker
      await Availability.create({
        workerId: worker.id,
        hours: 2,
        skills: ['electrician'],
        rateHourly: 350,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 3600000),
        active: true,
        localityKey: 'kakkanad',
        location: { type: 'Point', coordinates: [76.3419, 10.0159] }
      });

      // Worker checks nearby feed: highlights must show open job
      const resWorkFeed = await fetch(`${baseUrl}/api/v1/feed?tab=nearby`, {
        headers: { Authorization: `Bearer ${worker.token}` }
      });
      const bodyWorkFeed = await resWorkFeed.json();
      assert.ok(bodyWorkFeed.data.highlights);
      assert.equal(bodyWorkFeed.data.highlights[0].type, 'job');
      assert.equal(bodyWorkFeed.data.highlights[0].skill, 'electrician');
      assertNoSensitiveFields(bodyWorkFeed);

      // Customer checks nearby feed: highlights must show free worker
      const resCustFeed = await fetch(`${baseUrl}/api/v1/feed?tab=nearby`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const bodyCustFeed = await resCustFeed.json();
      assert.ok(bodyCustFeed.data.highlights);
      assert.equal(bodyCustFeed.data.highlights[0].type, 'worker_free');
      assert.equal(bodyCustFeed.data.highlights[0].workerId, worker.id);
      assertNoSensitiveFields(bodyCustFeed);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. FOLLOWS (POST /follows, DELETE /follows/:workerId, GET /follows)
  // ---------------------------------------------------------------------------
  describe('Follows and Saves (POST /follows, DELETE /follows/:workerId, GET /follows)', () => {
    it('enforces self-follow 400 CANNOT_FOLLOW_SELF and non-worker target 404', async () => {
      const worker = await createWorker('w_self_f');
      const customer = await createCustomer('c_target_f');

      // Worker self-follow
      const resSelf = await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` },
        body: JSON.stringify({ workerId: worker.id, type: 'follow' })
      });
      assert.equal(resSelf.status, 400);
      assert.equal((await resSelf.json()).error?.code, 'CANNOT_FOLLOW_SELF');

      // Target non-worker (customer) -> 404
      const resNonWorker = await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` },
        body: JSON.stringify({ workerId: customer.id, type: 'follow' })
      });
      assert.equal(resNonWorker.status, 404);
    });

    it('follow caps at 500 (seed 499 then 4 parallel gives exactly 1 success and 3 FOLLOW_LIMIT)', async () => {
      const caller = await createCustomer('c_cap_caller');
      await User.updateOne({ _id: caller.id }, { $set: { 'followCounts.follow': 499 } });

      const workers = await Promise.all(
        Array.from({ length: 4 }, (_, i) => createWorker(`w_cap_${i}`))
      );

      const promises = workers.map((w) =>
        fetch(`${baseUrl}/api/v1/follows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${caller.token}` },
          body: JSON.stringify({ workerId: w.id, type: 'follow' })
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200);
      const limitHit = statuses.filter((s) => s === 409);

      assert.equal(successes.length, 1);
      assert.equal(limitHit.length, 3);
    });

    it('GET /follows lists newest first with cursor pagination and skips inactive workers', async () => {
      const customer = await createCustomer('c_list_f');
      const wActive = await createWorker('w_active_f');
      const wInactive = await createWorker('w_inactive_f');

      await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: wActive.id, type: 'follow' })
      });
      await fetch(`${baseUrl}/api/v1/follows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: wInactive.id, type: 'follow' })
      });

      // Mark wInactive as inactive
      await User.updateOne({ _id: wInactive.id }, { $set: { isActive: false } });

      const res = await fetch(`${baseUrl}/api/v1/follows?type=follow`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assertNoSensitiveFields(body);

      const workers = body.data.workers;
      assert.equal(workers.length, 1);
      assert.equal(workers[0].id, wActive.id);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ENDORSEMENTS (POST /endorsements)
  // ---------------------------------------------------------------------------
  describe('Skill Endorsements (POST /endorsements)', () => {
    it('customer without completed booking gets 403 NOT_ELIGIBLE, completed for wrong skill gets 403', async () => {
      const worker = await createWorker('w_end_check', ['electrician', 'plumber']);
      const customer = await createCustomer('c_end_check');

      // No booking at all -> 403 NOT_ELIGIBLE
      const resNoJob = await fetch(`${baseUrl}/api/v1/endorsements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: worker.id, skill: 'electrician' })
      });
      assert.equal(resNoJob.status, 403);
      assert.equal((await resNoJob.json()).error?.code, 'NOT_ELIGIBLE');

      // Create completed booking for plumber
      await Booking.create({
        customerId: customer.id,
        workerId: worker.id,
        skill: 'plumber',
        status: 'completed',
        scheduledAt: new Date(Date.now() - 3600000),
        hours: 2,
        agreedRate: 350,
        startCodeEnc: 'v1:dummy:dummy:dummy',
        finishCodeEnc: 'v1:dummy:dummy:dummy'
      });

      // Endorse for electrician -> 403 NOT_ELIGIBLE
      const resWrongSkill = await fetch(`${baseUrl}/api/v1/endorsements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: worker.id, skill: 'electrician' })
      });
      assert.equal(resWrongSkill.status, 403);
      assert.equal((await resWrongSkill.json()).error?.code, 'NOT_ELIGIBLE');

      // Endorse for plumber -> 200 SUCCESS
      const resSuccess = await fetch(`${baseUrl}/api/v1/endorsements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ workerId: worker.id, skill: 'plumber' })
      });
      const bodySuccess = await resSuccess.json();
      assert.equal(resSuccess.status, 200);
      assert.equal(bodySuccess.data.count, 1);

      // Profile shows count
      const resProf = await fetch(`${baseUrl}/api/v1/workers/${worker.id}`, {
        headers: { Authorization: `Bearer ${customer.token}` }
      });
      const bodyProf = await resProf.json();
      assert.equal(bodyProf.data.worker.endorsements?.plumber, 1);
    });

    it('10 PARALLEL endorsements by same customer give EXACTLY 1 success and count 1', async () => {
      const worker = await createWorker('w_end_parallel', ['electrician']);
      const customer = await createCustomer('c_end_parallel');

      await Booking.create({
        customerId: customer.id,
        workerId: worker.id,
        skill: 'electrician',
        status: 'completed',
        scheduledAt: new Date(Date.now() - 3600000),
        hours: 2,
        agreedRate: 350,
        startCodeEnc: 'v1:dummy:dummy:dummy',
        finishCodeEnc: 'v1:dummy:dummy:dummy'
      });

      const promises = Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/api/v1/endorsements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
          body: JSON.stringify({ workerId: worker.id, skill: 'electrician' })
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200);
      const duplicates = statuses.filter((s) => s === 409);

      assert.equal(successes.length, 1, 'Exactly one parallel endorsement must succeed');
      assert.equal(duplicates.length, 9, 'All other 9 parallel requests must be rejected with 409 ALREADY_ENDORSED');

      const workerDoc = await User.findById(worker.id);
      const counts = workerDoc.endorsementCounts instanceof Map
        ? Object.fromEntries(workerDoc.endorsementCounts)
        : workerDoc.endorsementCounts;
      assert.equal(counts.electrician, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. REPORTS (POST /reports)
  // ---------------------------------------------------------------------------
  describe('Content and Worker Reports (POST /reports)', () => {
    it('duplicate within 24h suppressed (1 doc), same report after 24h creates second document', async () => {
      const worker = await createWorker('w_rep_dup');
      const customer = await createCustomer('c_rep_dup');

      // First report
      const res1 = await fetch(`${baseUrl}/api/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({
          targetType: 'worker',
          targetId: worker.id,
          reason: 'spam',
          note: 'Spamming calls'
        })
      });
      assert.equal(res1.status, 200);
      assert.equal((await res1.json()).data.message, 'Report received. Support will review it.');

      // Second immediate report -> suppressed (returns same 200)
      const res2 = await fetch(`${baseUrl}/api/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({
          targetType: 'worker',
          targetId: worker.id,
          reason: 'spam',
          note: 'Spamming calls again'
        })
      });
      assert.equal(res2.status, 200);

      // Verify only 1 document in DB
      const count1 = await Report.countDocuments({ targetId: worker.id });
      assert.equal(count1, 1);

      // Advance clock past 24h
      clock.freeze(new Date(clock.now().getTime() + 25 * 60 * 60 * 1000));

      // Third report after 24h -> creates second document
      const res3 = await fetch(`${baseUrl}/api/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({
          targetType: 'worker',
          targetId: worker.id,
          reason: 'spam',
          note: 'Reported again next day'
        })
      });
      assert.equal(res3.status, 200);

      const count2 = await Report.countDocuments({ targetId: worker.id });
      assert.equal(count2, 2);

      // Verify stored documents have ipHash (hex) and reportedUserId, no raw IP
      const docs = await Report.find({ targetId: worker.id });
      for (const d of docs) {
        assert.ok(d.ipHash);
        assert.equal(d.ipHash.length, 64);
        assert.equal(d.reportedUserId.toString(), worker.id);
      }
    });

    it('rejects self-report with 400 CANNOT_REPORT_SELF', async () => {
      const worker = await createWorker('w_self_rep');

      const res = await fetch(`${baseUrl}/api/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` },
        body: JSON.stringify({
          targetType: 'worker',
          targetId: worker.id,
          reason: 'other'
        })
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error?.code, 'CANNOT_REPORT_SELF');
    });

    it('rejects booking targetType with 400 VALIDATION_ERROR', async () => {
      const customer = await createCustomer('c_book_rep');
      const res = await fetch(`${baseUrl}/api/v1/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({
          targetType: 'booking',
          targetId: '000000000000000000000000',
          reason: 'unsafe'
        })
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error?.message, /booking report endpoint/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. UPLOADS (POST /uploads/sign)
  // ---------------------------------------------------------------------------
  describe('Uploads Signature (POST /uploads/sign)', () => {
    it('accepts purpose "post" and assigns correct posts folder', async () => {
      const worker = await createWorker('w_upl_post');
      const res = await fetch(`${baseUrl}/api/v1/uploads/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` },
        body: JSON.stringify({ purpose: 'post' })
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.folder, `workcred/test/${worker.id}/posts`);
      assert.ok(body.data.signature);
    });

    it('rejects invalid purpose with 400 VALIDATION_ERROR', async () => {
      const worker = await createWorker('w_upl_bad');
      const res = await fetch(`${baseUrl}/api/v1/uploads/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${worker.token}` },
        body: JSON.stringify({ purpose: 'document' })
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error?.code, 'VALIDATION_ERROR');
    });
  });
});
