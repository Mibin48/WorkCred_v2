import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, apiRequest, ApiError, refreshSession } from '../../frontend/app/js/api.js';
import { setAccessToken, getAccessToken, clearSessionLocal } from '../../frontend/app/js/session.js';

describe('API Client & Envelope Handling with Mocked Fetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearSessionLocal(false);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearSessionLocal(false);
  });

  test('successfully extracts data from standard envelope', async () => {
    global.fetch = async (url, opts) => {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: { name: 'Ravi', role: 'worker' } })
      };
    };

    const res = await api.getMe();
    assert.equal(res.name, 'Ravi');
    assert.equal(res.role, 'worker');
  });

  test('maps API error code and message into ApiError instance', async () => {
    global.fetch = async (url, opts) => {
      return {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is wrong.' }
        })
      };
    };

    await assert.rejects(async () => {
      await api.login('ravi@example.com', 'wrongpassword');
    }, (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.equal(err.message, 'Email or password is wrong.');
      assert.equal(err.status, 401);
      return true;
    });
  });

  test('sends X-Requested-With: WorkCred on refresh and logout ONLY', async () => {
    const requestedHeaders = [];

    global.fetch = async (url, opts) => {
      const headers = {};
      opts.headers.forEach((v, k) => { headers[k] = v; });
      requestedHeaders.push({ url, headers });

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: { ok: true, accessToken: 'mock-new-token' } })
      };
    };

    // 1. Regular get request
    await api.getMe();
    assert.equal(requestedHeaders[0].headers['x-requested-with'], undefined);

    // 2. Refresh request
    await refreshSession();
    assert.equal(requestedHeaders[1].headers['x-requested-with'], 'WorkCred');

    // 3. Logout request
    await api.logout();
    assert.equal(requestedHeaders[2].headers['x-requested-with'], 'WorkCred');
  });

  test('never places access token in any URL', async () => {
    setAccessToken('sensitive-jwt-token-12345');
    const calledUrls = [];

    global.fetch = async (url, opts) => {
      calledUrls.push(url);
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: { ok: true } })
      };
    };

    await api.get('/users/me');
    await api.get('/jobs?status=open');

    for (const url of calledUrls) {
      assert.ok(!url.includes('sensitive-jwt-token-12345'), `Token leaked in URL: ${url}`);
    }
  });

  test('TOKEN_INVALID triggers exactly one refresh and one retry', async () => {
    let callCount = 0;
    let refreshCount = 0;

    global.fetch = async (url, opts) => {
      if (url.includes('/auth/refresh')) {
        refreshCount++;
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true, data: { accessToken: 'fresh-token-xyz' } })
        };
      }

      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: false, error: { code: 'TOKEN_INVALID', message: 'Token expired' } })
        };
      }

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: { message: 'Recovered after refresh' } })
      };
    };

    setAccessToken('old-expired-token');
    const res = await api.getMe();

    assert.equal(refreshCount, 1, 'Refresh must be called exactly once');
    assert.equal(callCount, 2, 'Original request must be retried exactly once');
    assert.equal(res.message, 'Recovered after refresh');
    assert.equal(getAccessToken(), 'fresh-token-xyz');
  });

  test('SESSION_INVALID clears memory session and does not retry', async () => {
    global.fetch = async (url, opts) => {
      return {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: false, error: { code: 'SESSION_INVALID', message: 'Session revoked' } })
      };
    };

    setAccessToken('token-about-to-die');
    await assert.rejects(async () => {
      await api.getMe();
    }, (err) => {
      assert.equal(err.code, 'SESSION_INVALID');
      return true;
    });

    assert.equal(getAccessToken(), null, 'Access token must be cleared on SESSION_INVALID');
  });

  test('Two simultaneous 401 TOKEN_INVALID calls trigger only ONE refresh', async () => {
    let refreshCount = 0;

    global.fetch = async (url, opts) => {
      if (url.includes('/auth/refresh')) {
        refreshCount++;
        await new Promise(r => setTimeout(r, 50));
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true, data: { accessToken: 'shared-refreshed-token' } })
        };
      }

      // Check authorization header
      const auth = opts.headers?.get ? opts.headers.get('Authorization') : opts.headers?.['Authorization'];
      if (!auth || auth.includes('initial-token')) {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: false, error: { code: 'TOKEN_INVALID', message: 'Token expired' } })
        };
      }

      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: { result: 'success' } })
      };
    };

    setAccessToken('initial-token');

    // Launch parallel requests
    const [res1, res2] = await Promise.all([
      api.get('/users/me'),
      api.get('/meta')
    ]);

    assert.equal(refreshCount, 1, 'Only one refresh must happen across simultaneous requests');
    assert.equal(res1.result, 'success');
    assert.equal(res2.result, 'success');
  });
});
