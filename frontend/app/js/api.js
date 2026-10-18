/**
 * WorkCred API Client
 * Lives at: frontend/app/js/api.js
 * Implements M4 (bearer in memory), M5 (single refresh + retry), M6 (host checking).
 */

import {
  getAccessToken,
  setAccessToken,
  setUser,
  clearSessionLocal,
  executeLockedRefresh
} from './session.js';

export class ApiError extends Error {
  constructor(code, message, details = [], status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function getApiBase() {
  const cfg = (typeof window !== 'undefined' && window.WORKCRED) ? window.WORKCRED : null;
  return cfg?.apiBase || 'http://localhost:4000/api/v1';
}

export function checkHostSanity() {
  if (typeof window === 'undefined' || !window.location) return true;
  const currentHost = window.location.hostname;
  const apiBase = getApiBase();

  try {
    const apiUrl = new URL(apiBase);
    if (apiUrl.hostname !== currentHost) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'idemp-' + Math.random().toString(36).slice(2) + '-' + Date.now();
}

/**
 * Low-level HTTP fetch with timeout and error mapping
 */
async function rawFetch(endpoint, options = {}) {
  if (!checkHostSanity()) {
    throw new ApiError('HOST_MISMATCH', 'Page and API hosts do not match.');
  }

  const apiBase = getApiBase();
  const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const isAuthRoute = endpoint.includes('/auth/');
  const isRefreshOrLogout = endpoint.includes('/auth/refresh') || endpoint.includes('/auth/logout');

  const headers = new Headers(options.headers || {});

  // Add Auth Token if available and not an auth route
  const token = getAccessToken();
  if (token && !isAuthRoute && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // X-Requested-With only on refresh and logout (CSRF defense per Security Spec 1.3)
  if (isRefreshOrLogout) {
    headers.set('X-Requested-With', 'WorkCred');
  }

  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: isAuthRoute ? 'include' : 'same-origin',
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Connection timed out. Please check your network and try again.');
    }
    throw new ApiError('NETWORK_ERROR', 'Could not reach server. Please check your network connection.');
  } finally {
    clearTimeout(timeoutId);
  }

  let body = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const errObj = body?.error || {};
    const code = errObj.code || (response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR');
    const msg = errObj.message || `Request failed with status ${response.status}`;
    const details = errObj.details || [];
    throw new ApiError(code, msg, details, response.status);
  }

  return body?.data !== undefined ? body.data : body;
}

/**
 * Performs a silent refresh under lock, returning new access token
 */
export async function refreshSession() {
  return executeLockedRefresh(async () => {
    try {
      const data = await rawFetch('/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': 'WorkCred' }
      });
      if (data?.accessToken) {
        setAccessToken(data.accessToken);
        if (data.user) {
          setUser(data.user);
        }
        return data.accessToken;
      }
      throw new ApiError('REFRESH_FAILED', 'No access token in refresh response');
    } catch (err) {
      if (err.code === 'SESSION_INVALID' || err.status === 401) {
        clearSessionLocal(true);
      }
      throw err;
    }
  });
}

/**
 * Main API request wrapper with single refresh and retry on TOKEN_INVALID
 */
export async function apiRequest(endpoint, options = {}) {
  try {
    return await rawFetch(endpoint, options);
  } catch (err) {
    // If TOKEN_INVALID, attempt exactly one refresh and retry
    if (err.code === 'TOKEN_INVALID' && !options._retried) {
      try {
        await refreshSession();
        // Retry once with new token
        return await rawFetch(endpoint, { ...options, _retried: true });
      } catch (refreshErr) {
        if (refreshErr.code === 'SESSION_INVALID') {
          clearSessionLocal(true);
        }
        throw refreshErr;
      }
    }

    if (err.code === 'SESSION_INVALID') {
      clearSessionLocal(true);
    }
    throw err;
  }
}

// API methods
export const api = {
  get: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => apiRequest(endpoint, {
    ...options,
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body)
  }),
  patch: (endpoint, body, options) => apiRequest(endpoint, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(body)
  }),
  delete: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'DELETE' }),

  // Auth specific
  login: async (email, password, role) => {
    const data = await rawFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, role })
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  },

  signup: async (payload) => {
    const data = await rawFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  },

  logout: async () => {
    try {
      await rawFetch('/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'WorkCred' }
      });
    } finally {
      clearSessionLocal(true);
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const data = await apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (data?.accessToken) {
      setAccessToken(data.accessToken);
    }
    return data;
  },

  getMe: () => apiRequest('/users/me'),
  updateMe: (patchData) => apiRequest('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(patchData)
  }),
  getMeta: () => apiRequest('/meta'),
  getCompass: (params) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/compass?${query}`);
  },
  getDemoAccounts: () => rawFetch('/demo/accounts')
};
