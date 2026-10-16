import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../../src/app.js';
import http from 'node:http';

describe('backend/tests/unit/auth/authValidation.test.js (Unit & Smoke - No DB)', () => {
  let server;
  let baseUrl;

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    JWT_ACCESS_SECRET: 'test_access_secret_longer_than_32_chars_1234567890',
    JWT_REFRESH_SECRET: 'test_refresh_secret_longer_than_32_chars_1234567890',
    CODES_ENC_KEY: Buffer.alloc(32).toString('base64'),
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    RATE_LIMIT_ENABLED: false
  };

  before(async () => {
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
  });

  it('rejects POST /api/v1/auth/signup with unknown fields (400)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '9876543210',
        password: 'Password123#Valid',
        extraField: 'not_allowed'
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Unknown field: extraField'));
  });

  it('rejects POST /api/v1/auth/signup when role is admin (400)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'admin',
        name: 'Admin User',
        email: 'admin@example.com',
        phone: '9876543210',
        password: 'Password123#Valid'
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Role must be either "worker" or "customer"'));
  });

  it('rejects POST /api/v1/auth/login when attempting login with phone number instead of email', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '9876543210', // Phone used instead of email
        password: 'Password123#Valid',
        role: 'customer'
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Invalid email format'));
  });

  it('rejects POST /api/v1/auth/login with unknown fields', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'valid@example.com',
        password: 'Password123#Valid',
        role: 'customer',
        rememberMe: true
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('Unknown field: rememberMe'));
  });

  it('rejects POST /api/v1/auth/refresh without X-Requested-With header (403 BAD_ORIGIN)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Origin': 'http://localhost:3000'
      }
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_ORIGIN');
  });

  it('rejects POST /api/v1/auth/refresh with unauthorized Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Origin': 'http://malicious-site.com',
        'X-Requested-With': 'WorkCred'
      }
    });

    // CORS blocks unapproved origin
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'http://malicious-site.com');
  });

  it('rejects POST /api/v1/auth/logout without X-Requested-With header (403 BAD_ORIGIN)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST'
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_ORIGIN');
  });

  it('rejects GET /api/v1/users/me without Bearer Authorization header (401 UNAUTHORIZED)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('rejects GET /api/v1/users/me with malformed Bearer token (401 UNAUTHORIZED)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: {
        'Authorization': 'Bearer not-a-valid-jwt-token'
      }
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });
});
