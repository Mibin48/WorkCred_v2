import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';

describe('backend/tests/smoke/app.smoke.test.js (No Database Running)', () => {
  let server;
  let baseUrl;

  const testConfig = {
    NODE_ENV: 'test',
    PORT: 0,
    FRONTEND_ORIGINS: ['http://localhost:3000'],
    RATE_LIMIT_ENABLED: false,
    TRUST_PROXY: false
  };

  before(async () => {
    const app = createApp(testConfig);
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('GET /api/v1/health returns 200 with standard success envelope and Cache-Control: no-store', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);

    const cacheHeader = res.headers.get('cache-control');
    assert.match(cacheHeader, /no-store/);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
  });

  it('GET /api/v1/health/ready returns 503 when database is not connected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(res.status, 503);

    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(body.error.message, 'Database connection is not ready');
  });

  it('GET /unknown-route returns 404 NOT_FOUND without stack traces', async () => {
    const res = await fetch(`${baseUrl}/unknown-route`);
    assert.equal(res.status, 404);

    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.stack, undefined);
    assert.equal(body.error.stack, undefined);
  });

  it('POST with invalid JSON body returns 400 BAD_JSON without stack trace', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"invalidJson": '
    });
    assert.equal(res.status, 400);

    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'BAD_JSON');
    assert.equal(body.stack, undefined);
  });

  it('CORS allows requests from approved exact origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  it('CORS rejects requests from unapproved origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: 'http://malicious-site.com' }
    });
    // CORS error handler returns 500 or blocks origin header
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'http://malicious-site.com');
  });
});
