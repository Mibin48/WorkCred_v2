/**
 * WorkCred Session Management
 * Lives at: frontend/app/js/session.js
 * Implements M4 (memory-only access token) and M5 (safe multi-tab refresh locking & sync).
 */

let inMemoryAccessToken = null;
let inMemoryUser = null;
let tokenIssuedAt = null;
let tokenExpiresAt = null;

let refreshPromise = null;
let proactiveTimer = null;

const authBroadcast = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('workcred-auth')
  : null;

// Listen for cross-tab broadcasts
if (authBroadcast) {
  if (typeof authBroadcast.unref === 'function') {
    authBroadcast.unref();
  }
  authBroadcast.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'logout') {
      clearSessionLocal(false);
      window.dispatchEvent(new CustomEvent('workcred:auth:logout'));
    } else if (data.type === 'password-changed') {
      window.dispatchEvent(new CustomEvent('workcred:auth:password-changed'));
    }
  };
}

export function getAccessToken() {
  return inMemoryAccessToken;
}

export function setAccessToken(token) {
  inMemoryAccessToken = token;
  if (token) {
    tokenIssuedAt = Date.now();
    tokenExpiresAt = tokenIssuedAt + (15 * 60 * 1000); // 15 minutes
    scheduleProactiveRefresh();
  } else {
    tokenIssuedAt = null;
    tokenExpiresAt = null;
    clearTimeout(proactiveTimer);
  }
}

export function getUser() {
  return inMemoryUser;
}

export function setUser(user) {
  inMemoryUser = user;
}

export function clearSessionLocal(broadcast = true) {
  inMemoryAccessToken = null;
  inMemoryUser = null;
  tokenIssuedAt = null;
  tokenExpiresAt = null;
  clearTimeout(proactiveTimer);

  if (broadcast && authBroadcast) {
    try {
      authBroadcast.postMessage({ type: 'logout' });
    } catch {
      // ignore
    }
  }
}

export function notifyPasswordChanged() {
  if (authBroadcast) {
    try {
      authBroadcast.postMessage({ type: 'password-changed' });
    } catch {
      // ignore
    }
  }
}

// Fallback lock using localStorage lease (when navigator.locks is unavailable)
const LEASE_KEY = 'workcred_refresh_lease';
const LEASE_DURATION_MS = 10000;

export async function acquireFallbackLease() {
  if (typeof localStorage === 'undefined') {
    return () => {};
  }

  const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

  const start = Date.now();
  while (Date.now() - start < 15000) { // wait up to 15s
    const now = Date.now();
    const raw = localStorage.getItem(LEASE_KEY);
    let lease = null;
    if (raw) {
      try { lease = JSON.parse(raw); } catch { /* ignore */ }
    }

    if (!lease || lease.expiry < now) {
      // Take lease
      const newLease = { owner: clientId, expiry: now + LEASE_DURATION_MS };
      localStorage.setItem(LEASE_KEY, JSON.stringify(newLease));
      return () => {
        const cur = localStorage.getItem(LEASE_KEY);
        if (cur) {
          try {
            const parsed = JSON.parse(cur);
            if (parsed.owner === clientId) {
              localStorage.removeItem(LEASE_KEY);
            }
          } catch { /* ignore */ }
        }
      };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return () => localStorage.removeItem(LEASE_KEY);
}

/**
 * Executes a locked refresh callback:
 * 1. Inside this tab: deduplicates in-flight refresh into a single Promise.
 * 2. Across tabs: uses navigator.locks.request("workcred-refresh") or lease fallback.
 * @param {() => Promise<any>} refreshFn
 * @returns {Promise<any>}
 */
export async function executeLockedRefresh(refreshFn) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        return await navigator.locks.request('workcred-refresh', { mode: 'exclusive' }, async () => {
          return await refreshFn();
        });
      } else {
        const releaseLease = await acquireFallbackLease();
        try {
          return await refreshFn();
        } finally {
          releaseLease();
        }
      }
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function scheduleProactiveRefresh() {
  clearTimeout(proactiveTimer);
  if (!tokenExpiresAt) return;

  // Proactive refresh at ~13 minutes (2 minutes before expiry)
  const refreshInMs = Math.max(1000, tokenExpiresAt - Date.now() - (2 * 60 * 1000));
  proactiveTimer = setTimeout(async () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workcred:session:proactive-refresh'));
    }
  }, refreshInMs);

  if (proactiveTimer && typeof proactiveTimer.unref === 'function') {
    proactiveTimer.unref();
  }
}

// Proactive refresh on tab visibility if less than 2 minutes left
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && inMemoryAccessToken && tokenExpiresAt) {
      const msLeft = tokenExpiresAt - Date.now();
      if (msLeft < 2 * 60 * 1000) {
        window.dispatchEvent(new CustomEvent('workcred:session:proactive-refresh'));
      }
    }
  });
}
