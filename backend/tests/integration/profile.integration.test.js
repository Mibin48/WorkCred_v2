import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { LOCALITIES } from '../../../shared/localities.js';

describe('B3 Profiles, Calendar & Uploads Integration Tests', () => {
  let mongod;
  let server;
  let baseUrl;

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET: 'super_secret_access_key_at_least_32_bytes_long_123456',
    JWT_REFRESH_SECRET: 'super_secret_refresh_key_at_least_32_bytes_long_123456',
    CODES_ENC_KEY: Buffer.alloc(32).toString('base64'),
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri() + 'workcred_profile_test';
    await mongoose.connect(uri);

    const app = createApp(testConfig);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
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
    const signupData = await signupRes.json();
    assert.equal(signupRes.status, 201, `Signup failed: ${JSON.stringify(signupData)}`);
    return { token: signupData.data.accessToken, user: signupData.data.user };
  }

  it('GET /api/v1/meta returns skills, safe localities (no coordinates), slot options and limits', async () => {
    const { token } = await registerAndLogin('customer', 'Meta User', 'meta.user@example.com', '9876543210');

    const res = await fetch(`${baseUrl}/api/v1/meta`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.skills));
    assert.ok(body.data.skills.includes('electrician'));
    assert.ok(Array.isArray(body.data.localities));
    assert.ok(body.data.localities.length > 0);
    for (const loc of body.data.localities) {
      assert.ok(loc.key);
      assert.ok(loc.name);
      assert.ok(loc.cityKey);
      assert.equal(loc.lat, undefined);
      assert.equal(loc.lng, undefined);
      assert.equal(loc.coordinates, undefined);
    }
    assert.deepEqual(body.data.weeklyOptions, ['off', 'morning', 'afternoon', 'evening', 'full']);
    assert.equal(body.data.limits.maxSkills, 6);
    assert.equal(body.data.limits.maxBioLength, 200);
    assert.equal(body.data.limits.maxBlockedDates, 60);

    assertNoSensitiveFields(body);
  });

  it('Customer profile completeness transitions from false to true and back to false', async () => {
    const { token } = await registerAndLogin('customer', 'Cust Comp', 'cust.comp@example.com', '9876543211');

    const initialMe = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const initialBody = await initialMe.json();
    assert.equal(initialMe.status, 200);
    assert.equal(initialBody.data.user.profileComplete, false);

    const patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localityKey: LOCALITIES[0].key
      })
    });
    const patchBody = await patchRes.json();
    assert.equal(patchRes.status, 200);
    assert.equal(patchBody.data.user.profileComplete, true);
    assert.equal(patchBody.data.user.localityKey, LOCALITIES[0].key);

    assertNoSensitiveFields(patchBody, { allowPhoneAndEmail: true });
  });

  it('Worker profile completeness transitions from false to true when all required fields met', async () => {
    const { token } = await registerAndLogin('worker', 'Work Comp', 'work.comp@example.com', '9876543212');

    const initialMe = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const initialBody = await initialMe.json();
    assert.equal(initialBody.data.user.profileComplete, false);

    let patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        skills: [{ skill: 'electrician', isMain: true }],
        hourlyRate: 350
      })
    });
    let patchBody = await patchRes.json();
    assert.equal(patchRes.status, 200);
    assert.equal(patchBody.data.user.profileComplete, false);

    patchRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localityKey: LOCALITIES[0].key,
        radiusKm: 5
      })
    });
    patchBody = await patchRes.json();
    assert.equal(patchRes.status, 200);
    assert.equal(patchBody.data.user.profileComplete, true);
    assertNoSensitiveFields(patchBody, { allowPhoneAndEmail: true });
  });

  it('Customer sending worker-only fields gets 400 FIELD_NOT_ALLOWED_FOR_ROLE', async () => {
    const { token } = await registerAndLogin('customer', 'Cust WorkerField', 'cust.wf@example.com', '9876543213');

    const workerFields = [
      { skills: [{ skill: 'plumber', isMain: true }] },
      { hourlyRate: 300 },
      { dailyRate: 1500 },
      { bio: 'Friendly worker' },
      { radiusKm: 4 },
      { calendar: { weekly: { mon: 'full' }, blockedDates: [] } }
    ];

    for (const payload of workerFields) {
      const res = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error.code, 'FIELD_NOT_ALLOWED_FOR_ROLE');
    }
  });

  it('Mass-assignment rejection: each forbidden field individually rejected with 400', async () => {
    const { token } = await registerAndLogin('worker', 'Mass Assign Worker', 'mass.assign@example.com', '9876543214');

    const forbiddenFields = [
      { email: 'newemail@example.com' },
      { role: 'customer' },
      { passwordHash: 'hacked_hash' },
      { tokenVersion: 99 },
      { isActive: false },
      { profileComplete: true },
      { passportStats: { jobs: 50 } },
      { passportHead: { seq: 10 } },
      { failedLoginAttempts: 0 },
      { lockUntil: null },
      { _id: '507f1f77bcf86cd799439011' },
      { id: '507f1f77bcf86cd799439011' },
      { unknownFieldXYZ: 'some_val' }
    ];

    for (const payload of forbiddenFields) {
      const res = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 400, `Expected 400 for ${Object.keys(payload)[0]}`);
      const body = await res.json();
      assert.equal(body.error.code, 'FORBIDDEN_FIELD');
    }
  });

  it('Phone edit works and does not enforce uniqueness (B2 rule)', async () => {
    const user1 = await registerAndLogin('customer', 'Phone User 1', 'phone1@example.com', '9811111111');
    const user2 = await registerAndLogin('worker', 'Phone User 2', 'phone2@example.com', '9822222222');

    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${user2.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: '9811111111' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.user.phone, '9811111111');
  });

  it('Calendar validation: blocked dates rules and bio contact info checks', async () => {
    const { token } = await registerAndLogin('worker', 'Cal Worker', 'cal.worker@example.com', '9876543215');

    let res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ bio: 'Call me on 9876543210 for quick service' })
    });
    assert.equal(res.status, 400);
    let body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');

    res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendar: {
          blockedDates: [{ date: '2026-12-01', reason: 'Email me at worker@test.com' }]
        }
      })
    });
    assert.equal(res.status, 400);
    body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');

    res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendar: {
          blockedDates: [{ date: '2020-01-01', reason: 'Old past date' }]
        }
      })
    });
    assert.equal(res.status, 400);
    body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');

    res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendar: {
          weekly: { mon: 'morning', wed: 'afternoon', fri: 'full' },
          blockedDates: [
            { date: '2026-12-25', reason: 'Christmas' },
            { date: '2026-11-10', reason: 'Family event' }
          ]
        }
      })
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.data.user.calendar.blockedDates[0].date, '2026-11-10');
    assert.equal(body.data.user.calendar.blockedDates[1].date, '2026-12-25');
  });

  it('Exact coordinates are privately stored and NEVER returned in API responses', async () => {
    const { token } = await registerAndLogin('worker', 'Loc Worker', 'loc.worker@example.com', '9876543216');

    const loc = LOCALITIES.find(l => l.key === 'kakkanad');
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        location: { lat: loc.lat + 0.005, lng: loc.lng + 0.005 }
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.data.user.localityKey, 'kakkanad');
    assert.equal(body.data.user.hasExactLocation, true);
    assert.equal(body.data.user.location, undefined);
    assert.equal(body.data.user.coordinates, undefined);
    assert.equal(body.data.user.lat, undefined);
    assert.equal(body.data.user.lng, undefined);

    assertNoSensitiveFields(body, { allowPhoneAndEmail: true });

    const dbUser = await mongoose.model('User').findById(body.data.user.id);
    assert.equal(dbUser.location.type, 'Point');
    assert.ok(Array.isArray(dbUser.location.coordinates));
  });

  it('Location bounds validation: outside India gives 400', async () => {
    const { token } = await registerAndLogin('customer', 'Bounds Cust', 'bounds@example.com', '9876543217');

    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        location: { lat: 51.5074, lng: -0.1278 }
      })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('India bounds'));
  });

  it('Upload signing: 503 when Cloudinary is not configured', async () => {
    const { token } = await registerAndLogin('worker', 'Upload Worker', 'upload.worker@example.com', '9876543218');

    const res = await fetch(`${baseUrl}/api/v1/uploads/sign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ purpose: 'avatar' })
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'UPLOADS_DISABLED');
  });

  it('Photo URL validation: only empty string or user own folder on Cloudinary accepted', async () => {
    const user1 = await registerAndLogin('customer', 'Photo User 1', 'photo1@example.com', '9876543219');
    const user2 = await registerAndLogin('worker', 'Photo User 2', 'photo2@example.com', '9876543220');

    const nodeEnv = process.env.NODE_ENV || 'development';
    const fakeCloud = 'demo-cloud';
    const otherUserUrl = `https://res.cloudinary.com/${fakeCloud}/image/upload/v1234567/workcred/${nodeEnv}/${user1.user.id}/avatar/photo.jpg`;

    let res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${user2.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ photoUrl: otherUserUrl })
    });
    assert.equal(res.status, 400);
    let body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');

    res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${user2.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ photoUrl: '' })
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.ok(body.data.user.photoUrl === '' || body.data.user.photoUrl === null);
  });
});

