import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { assertNoSensitiveFields } from '../helpers/privacyScanner.js';
import { hashRefreshToken } from '../../src/utils/tokenCrypto.js';

describe('backend/tests/integration/auth.integration.test.js (MongoDB In-Memory Auth Suite)', () => {
  let mongoServer;
  let server;
  let baseUrl;

  const JWT_ACCESS_SECRET = 'super_secret_access_key_at_least_32_bytes_long_123456';
  const JWT_REFRESH_SECRET = 'super_secret_refresh_key_at_least_32_bytes_long_123456';

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    CODES_ENC_KEY: Buffer.alloc(32).toString('base64'),
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri() + 'workcred_auth_test';
    await mongoose.connect(uri, { autoIndex: true });

    await Promise.all([
      User.init(),
      RefreshToken.init()
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
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Helper to extract cookie value
  function getCookieValue(res, cookieName) {
    const rawCookie = res.headers.get('set-cookie');
    if (!rawCookie) return null;
    const match = rawCookie.match(new RegExp(`${cookieName}=([^;]+)`));
    return match ? match[1] : null;
  }

  it('signs up worker successfully, sets wc_rt cookie, returns user and access token, and passes privacy scan', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'Ravi Kumar',
        email: 'ravi.kumar@example.com',
        phone: '9876543210',
        password: 'ComplexPassword123#Worker'
      })
    });

    assert.equal(res.status, 201);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie.includes('wc_rt='), 'Must set wc_rt cookie');
    assert.ok(setCookie.toLowerCase().includes('httponly'), 'Must be httpOnly');
    assert.ok(setCookie.toLowerCase().includes('samesite=lax'), 'Must be SameSite=Lax');
    assert.ok(setCookie.includes('Path=/api/v1/auth'), 'Path must be /api/v1/auth');

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.accessToken);
    assert.equal(body.data.expiresIn, 900);
    assert.equal(body.data.user.email, 'ravi.kumar@example.com');
    assert.equal(body.data.user.role, 'worker');

    // Run privacy scanner (own account is exempt for phone and email)
    assertNoSensitiveFields(body, { allowPhoneAndEmail: true });

    // Verify stored password in DB is scrypt format and refreshToken is hashed
    const storedUser = await User.findOne({ email: 'ravi.kumar@example.com' }).select('+passwordHash');
    assert.ok(storedUser.passwordHash.startsWith('scrypt$'), 'Password in DB must start with scrypt$');

    const rawCookie = getCookieValue(res, 'wc_rt');
    const storedToken = await RefreshToken.findOne({ userId: storedUser._id });
    assert.notEqual(storedToken.tokenHash, rawCookie, 'Raw cookie must never be stored in database');
    assert.equal(storedToken.tokenHash, hashRefreshToken(rawCookie, JWT_REFRESH_SECRET));
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: 'Another Ravi',
        email: 'RAVI.KUMAR@example.com', // uppercase check
        phone: '9812345678',
        password: 'DifferentPassword123#Customer'
      })
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'EMAIL_TAKEN');
  });

  it('allows same phone number across different email accounts', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: 'Customer Sajan',
        email: 'sajan.customer@example.com',
        phone: '9876543210', // same phone as Ravi Kumar
        password: 'ValidPassword123#Secure'
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it('rejects weak passwords matching various rejection rules', async () => {
    const testCases = [
      { pw: 'password', expectedErr: 'too common' },
      { pw: 'Testing1234567890!', expectedErr: 'sequential patterns' },
      { pw: 'Testingaaaa123!', expectedErr: 'repeated or sequential' },
      { pw: 'Contains9876543210!', expectedErr: 'phone number' },
      { pw: 'ContainsJohn123#', expectedErr: 'name' },
      { pw: 'Containsjohnny123#', expectedErr: 'email prefix' }
    ];

    for (const { pw } of testCases) {
      const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'customer',
          name: 'John Doe',
          email: 'johnny@example.com',
          phone: '9876543210',
          password: pw
        })
      });

      assert.equal(res.status, 400, `Expected 400 for password: ${pw}`);
      const body = await res.json();
      assert.equal(body.error.code, 'WEAK_PASSWORD');
    }
  });

  it('unknown email and wrong password give identical 401 INVALID_CREDENTIALS body and status', async () => {
    const resUnknown = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent.user@example.com',
        password: 'SomeRandomPassword123#',
        role: 'worker'
      })
    });

    const resWrongPw = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ravi.kumar@example.com',
        password: 'WrongPassword123#',
        role: 'worker'
      })
    });

    assert.equal(resUnknown.status, 401);
    assert.equal(resWrongPw.status, 401);

    const bodyUnknown = await resUnknown.json();
    const bodyWrongPw = await resWrongPw.json();

    assert.deepEqual(bodyUnknown, bodyWrongPw);
    assert.equal(bodyUnknown.error.code, 'INVALID_CREDENTIALS');
    assert.equal(bodyUnknown.error.message, 'Email or password is wrong.');
  });

  it('rejects role mismatch only AFTER verifying password is correct (403 ROLE_MISMATCH)', async () => {
    // 1. Wrong role with WRONG password gives 401 INVALID_CREDENTIALS (proves password checked first)
    const resWrongPw = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ravi.kumar@example.com',
        password: 'IncorrectPassword123#',
        role: 'customer' // Ravi is worker
      })
    });
    assert.equal(resWrongPw.status, 401);
    const bodyWrongPw = await resWrongPw.json();
    assert.equal(bodyWrongPw.error.code, 'INVALID_CREDENTIALS');

    // 2. Wrong role with CORRECT password gives 403 ROLE_MISMATCH and sets no cookie
    const resCorrectPw = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ravi.kumar@example.com',
        password: 'ComplexPassword123#Worker',
        role: 'customer' // Wrong role
      })
    });
    assert.equal(resCorrectPw.status, 403);
    assert.equal(resCorrectPw.headers.get('set-cookie'), null);
    const bodyCorrectPw = await resCorrectPw.json();
    assert.equal(bodyCorrectPw.error.code, 'ROLE_MISMATCH');
  });

  it('locks account after 5 wrong attempts (429 ACCOUNT_LOCKED) and refuses even right password while locked', async () => {
    // Register separate account for lockout test
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'Lockout Target',
        email: 'target.lockout@example.com',
        phone: '9888877777',
        password: 'ValidPassword123#Special'
      })
    });
    assert.equal(signupRes.status, 201);

    // 4 wrong attempts -> each 401
    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'target.lockout@example.com',
          password: 'WrongPassword123#',
          role: 'worker'
        })
      });
      assert.equal(res.status, 401);
    }

    // 5th wrong attempt triggers lock (returns 429 ACCOUNT_LOCKED)
    const res5 = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'target.lockout@example.com',
        password: 'WrongPassword123#',
        role: 'worker'
      })
    });
    assert.equal(res5.status, 429);
    const body5 = await res5.json();
    assert.equal(body5.error.code, 'ACCOUNT_LOCKED');

    // 6th attempt (even with CORRECT password) is refused with 429 ACCOUNT_LOCKED
    const resLocked = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'target.lockout@example.com',
        password: 'ValidPassword123#Special', // correct password!
        role: 'worker'
      })
    });
    assert.equal(resLocked.status, 429);
    const bodyLocked = await resLocked.json();
    assert.equal(bodyLocked.error.code, 'ACCOUNT_LOCKED');
    assert.ok(bodyLocked.error.message.includes('try again in'));

    // Test unlocking after expiration
    await User.updateOne({ email: 'target.lockout@example.com' }, { $set: { lockUntil: new Date(Date.now() - 1000) } });
    const resAfterExpiry = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'target.lockout@example.com',
        password: 'ValidPassword123#Special',
        role: 'worker'
      })
    });
    assert.equal(resAfterExpiry.status, 200);
  });

  it('rotates refresh token on POST /auth/refresh and revokes whole family on token reuse', async () => {
    // Login to get fresh cookie and accessToken
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ravi.kumar@example.com',
        password: 'ComplexPassword123#Worker',
        role: 'worker'
      })
    });
    assert.equal(loginRes.status, 200);
    const initialCookie = getCookieValue(loginRes, 'wc_rt');

    // Refresh #1 using initialCookie
    const refresh1Res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${initialCookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });

    assert.equal(refresh1Res.status, 200);
    const rotatedCookie = getCookieValue(refresh1Res, 'wc_rt');
    assert.notEqual(rotatedCookie, initialCookie, 'Refresh token must rotate to a new value');

    const refresh1Body = await refresh1Res.json();
    assert.ok(refresh1Body.data.accessToken);

    // REUSE ATTACK: Replay initialCookie which has already been consumed
    const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${initialCookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });

    assert.equal(replayRes.status, 401);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.error.code, 'SESSION_INVALID');

    // Confirm that rotatedCookie is ALSO revoked now because the whole family died
    const rotatedAfterReplay = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${rotatedCookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });
    assert.equal(rotatedAfterReplay.status, 401);
  });

  it('POST /auth/logout revokes session and clears cookie', async () => {
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sajan.customer@example.com',
        password: 'ValidPassword123#Secure',
        role: 'customer'
      })
    });
    assert.equal(loginRes.status, 200);
    const cookie = getCookieValue(loginRes, 'wc_rt');

    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${cookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });

    assert.equal(logoutRes.status, 200);
    const clearedCookie = logoutRes.headers.get('set-cookie');
    assert.ok(clearedCookie.includes('wc_rt=;'));

    // Attempting to refresh with the logged out cookie must fail
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${cookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });
    assert.equal(refreshRes.status, 401);
  });

  it('password change bumps tokenVersion, revokes old access tokens and all other refresh sessions, keeps current session', async () => {
    // 1. Login session A (Device A)
    const loginResA = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sajan.customer@example.com',
        password: 'ValidPassword123#Secure',
        role: 'customer'
      })
    });
    const { accessToken: tokenA } = (await loginResA.json()).data;
    const cookieA = getCookieValue(loginResA, 'wc_rt');

    // 2. Login session B (Device B)
    const loginResB = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sajan.customer@example.com',
        password: 'ValidPassword123#Secure',
        role: 'customer'
      })
    });
    const { accessToken: tokenB } = (await loginResB.json()).data;
    const cookieB = getCookieValue(loginResB, 'wc_rt');

    // Both sessions can access /users/me
    const meA1 = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.equal(meA1.status, 200);

    // Device A changes password
    const changeRes = await fetch(`${baseUrl}/api/v1/auth/password/change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        currentPassword: 'ValidPassword123#Secure',
        newPassword: 'BrandNewPassword123#Secure'
      })
    });
    assert.equal(changeRes.status, 200);
    const changeBody = await changeRes.json();
    const newActiveToken = changeBody.data.accessToken;
    const newActiveCookie = getCookieValue(changeRes, 'wc_rt');

    // 3. Old access token A must now fail immediately
    const meA_Old = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert.equal(meA_Old.status, 401);

    // 4. Old access token B must now fail immediately
    const meB_Old = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert.equal(meB_Old.status, 401);

    // 5. Device B refresh session is revoked
    const refreshB = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${cookieB}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });
    assert.equal(refreshB.status, 401);

    // 6. Device A newly returned active access token and cookie work
    const meNew = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${newActiveToken}` }
    });
    assert.equal(meNew.status, 200);

    const refreshNew = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${newActiveCookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });
    assert.equal(refreshNew.status, 200);
  });

  it('disabled account is blocked at login, with a live token, and at refresh', async () => {
    // Create an active user first
    const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'Disabled User Test',
        email: 'disabled.worker@example.com',
        phone: '9844433322',
        password: 'ValidPassword123#Special'
      })
    });
    const signupData = await signupRes.json();
    const liveToken = signupData.data.accessToken;
    const liveCookie = getCookieValue(signupRes, 'wc_rt');

    // Disable the user in the database
    await User.updateOne({ email: 'disabled.worker@example.com' }, { $set: { isActive: false } });

    // 1. Blocked at login (403 ACCOUNT_DISABLED)
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'disabled.worker@example.com',
        password: 'ValidPassword123#Special',
        role: 'worker'
      })
    });
    assert.equal(loginRes.status, 403);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.error.code, 'ACCOUNT_DISABLED');

    // 2. Blocked with live token on authenticated endpoint (403 ACCOUNT_DISABLED)
    const meRes = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${liveToken}` }
    });
    assert.equal(meRes.status, 403);
    const meBody = await meRes.json();
    assert.equal(meBody.error.code, 'ACCOUNT_DISABLED');

    // 3. Blocked at refresh (403 ACCOUNT_DISABLED)
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Cookie': `wc_rt=${liveCookie}`,
        'X-Requested-With': 'WorkCred',
        'Origin': 'http://localhost:3000'
      }
    });
    assert.equal(refreshRes.status, 403);
    const refreshBody = await refreshRes.json();
    assert.equal(refreshBody.error.code, 'ACCOUNT_DISABLED');
  });

  it('rejects MongoDB operator injection in login body', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: { $gt: '' },
        password: 'Password123#',
        role: 'worker'
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('AUTHORIZATION MATRIX test walks registered routes for visitor, customer, worker', async () => {
    // Setup tokens for customer and worker
    const custSignup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: 'Matrix Customer',
        email: 'matrix.customer@example.com',
        phone: '9811122233',
        password: 'ComplexPassword123#SecureCust'
      })
    });
    const custBody = await custSignup.json();
    assert.equal(custSignup.status, 201, `Customer signup error: ${JSON.stringify(custBody)}`);
    const custToken = custBody.data.accessToken;

    const workSignup = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'Matrix Worker',
        email: 'matrix.worker@example.com',
        phone: '9844455566',
        password: 'ComplexPassword123#SecureWork'
      })
    });
    const workBody = await workSignup.json();
    assert.equal(workSignup.status, 201, `Worker signup error: ${JSON.stringify(workBody)}`);
    const workToken = workBody.data.accessToken;

    const routes = [
      { method: 'GET', path: '/api/v1/health', expected: { visitor: 200, customer: 200, worker: 200 } },
      { method: 'GET', path: '/api/v1/meta', expected: { visitor: 401, customer: 200, worker: 200 } },
      { method: 'GET', path: '/api/v1/users/me', expected: { visitor: 401, customer: 200, worker: 200 } },
      { method: 'PATCH', path: '/api/v1/users/me', body: { name: 'Matrix Renamed' }, expected: { visitor: 401, customer: 200, worker: 200 } },
      { method: 'POST', path: '/api/v1/uploads/sign', body: { purpose: 'avatar' }, expected: { visitor: 401, customer: 503, worker: 503 } },
      { method: 'GET', path: '/api/v1/workers?skill=electrician', expected: { visitor: 401, customer: 400, worker: 400 } }, // 400 SET_AREA since users have no area yet
      { method: 'GET', path: '/api/v1/compass?skill=electrician&localityKey=edapally', expected: { visitor: 401, customer: 200, worker: 200 } },
      { method: 'GET', path: '/api/v1/jobs', expected: { visitor: 401, customer: 403, worker: 403 } }, // worker gets 403 PROFILE_INCOMPLETE
      { method: 'GET', path: '/api/v1/jobs/mine', expected: { visitor: 401, customer: 200, worker: 403 } },
      { method: 'POST', path: '/api/v1/jobs', body: { skill: 'electrician' }, expected: { visitor: 401, customer: 403, worker: 403 } }, // customer gets 403 PROFILE_INCOMPLETE
      { method: 'POST', path: '/api/v1/jobs/000000000000000000000000/accept', expected: { visitor: 401, customer: 403, worker: 403 } }, // worker gets 403 PROFILE_INCOMPLETE
      { method: 'POST', path: '/api/v1/jobs/000000000000000000000000/cancel', expected: { visitor: 401, customer: 404, worker: 403 } },
      // B5 Routes
      { method: 'POST', path: '/api/v1/bookings', body: { workerId: '000000000000000000000000' }, expected: { visitor: 401, customer: 400, worker: 403 } }, // customer gets 400 KEY_REQUIRED (or 403 if profile checked first)
      { method: 'GET', path: '/api/v1/bookings', expected: { visitor: 401, customer: 400, worker: 400 } },
      { method: 'GET', path: '/api/v1/bookings/counts', expected: { visitor: 401, customer: 200, worker: 200 } },
      { method: 'GET', path: '/api/v1/bookings/000000000000000000000000', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'GET', path: '/api/v1/bookings/000000000000000000000000/codes', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'POST', path: '/api/v1/bookings/000000000000000000000000/confirm', expected: { visitor: 401, customer: 403, worker: 404 } },
      { method: 'POST', path: '/api/v1/bookings/000000000000000000000000/cancel', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'POST', path: '/api/v1/bookings/000000000000000000000000/start', expected: { visitor: 401, customer: 403, worker: 404 } },
      { method: 'POST', path: '/api/v1/bookings/000000000000000000000000/finish', expected: { visitor: 401, customer: 404, worker: 403 } },
      { method: 'GET', path: '/api/v1/bookings/000000000000000000000000/receipt', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'POST', path: '/api/v1/bookings/000000000000000000000000/report', expected: { visitor: 401, customer: 403, worker: 404 } },
      { method: 'GET', path: '/api/v1/workers/000000000000000000000000/passport', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'GET', path: '/api/v1/workers/000000000000000000000000/passport/verify', expected: { visitor: 401, customer: 404, worker: 404 } },
      { method: 'GET', path: '/api/v1/passport/me', expected: { visitor: 401, customer: 403, worker: 200 } },
      { method: 'PATCH', path: '/api/v1/passport/entries/00000000', body: { visible: true }, expected: { visitor: 401, customer: 403, worker: 404 } }
    ];

    for (const route of routes) {
      const payload = route.body ? JSON.stringify(route.body) : undefined;
      const baseHeaders = route.body ? { 'Content-Type': 'application/json' } : {};

      // Visitor
      const resVisitor = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: baseHeaders,
        body: payload
      });
      assert.equal(resVisitor.status, route.expected.visitor, `Visitor on ${route.path}`);

      // Customer
      const resCustomer = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { ...baseHeaders, 'Authorization': `Bearer ${custToken}` },
        body: payload
      });
      assert.equal(resCustomer.status, route.expected.customer, `Customer on ${route.path}`);

      // Worker
      const resWorker = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { ...baseHeaders, 'Authorization': `Bearer ${workToken}` },
        body: payload
      });
      assert.equal(resWorker.status, route.expected.worker, `Worker on ${route.path}`);
    }
  });
});
