import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAccessToken,
  getAccessToken,
  clearSessionLocal,
  executeLockedRefresh,
  acquireFallbackLease
} from '../../frontend/app/js/session.js';

describe('Session Manager Unit Tests', () => {
  beforeEach(() => {
    clearSessionLocal(false);
  });

  afterEach(() => {
    clearSessionLocal(false);
  });

  test('holds access token in memory only and clears cleanly', () => {
    assert.equal(getAccessToken(), null);
    setAccessToken('sample-jwt-token-val');
    assert.equal(getAccessToken(), 'sample-jwt-token-val');
    clearSessionLocal(false);
    assert.equal(getAccessToken(), null);
  });

  test('deduplicates in-flight refresh calls into a single execution', async () => {
    let executions = 0;

    const mockRefreshTask = async () => {
      executions++;
      await new Promise(r => setTimeout(r, 40));
      return 'refreshed-token-123';
    };

    const p1 = executeLockedRefresh(mockRefreshTask);
    const p2 = executeLockedRefresh(mockRefreshTask);
    const p3 = executeLockedRefresh(mockRefreshTask);

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);

    assert.equal(executions, 1, 'Refresh function must execute exactly once for concurrent callers');
    assert.equal(t1, 'refreshed-token-123');
    assert.equal(t2, 'refreshed-token-123');
    assert.equal(t3, 'refreshed-token-123');
  });

  test('lock fallback lease logic with simulated clock acquires and releases lease cleanly', async () => {
    const store = new Map();
    global.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };

    try {
      const releaseLease1 = await acquireFallbackLease();
      assert.ok(store.has('workcred_refresh_lease'), 'Lease key must be stored in localStorage');

      const leaseObj = JSON.parse(store.get('workcred_refresh_lease'));
      assert.ok(leaseObj.owner, 'Lease must have an owner ID');
      assert.ok(leaseObj.expiry > Date.now(), 'Lease expiry must be in the future');

      // Release lease
      releaseLease1();
      assert.equal(store.has('workcred_refresh_lease'), false, 'Lease key must be removed upon release');
    } finally {
      delete global.localStorage;
    }
  });
});
