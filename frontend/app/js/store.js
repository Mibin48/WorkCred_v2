/**
 * WorkCred In-Memory Application Store
 * Lives at: frontend/app/js/store.js
 */

const state = {
  bootStatus: 'loading', // 'loading' | 'ready' | 'error'
  bootError: null,
  user: null,
  meta: {
    skills: [],
    localities: [],
    cities: []
  },
  onboardingDraft: {
    skills: [],
    mainSkill: '',
    hourlyRate: null,
    dailyRate: null,
    localityKey: '',
    radiusKm: 5,
    bio: '',
    photoUrl: ''
  },
  tabCounts: {
    bookings: 0,
    myWork: 0
  }
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(updates) {
  if (updates && 'user' in updates) {
    let u = updates.user;
    while (u && typeof u === 'object' && u.user && typeof u.user === 'object') {
      u = u.user;
    }
    updates.user = u;
  }
  Object.assign(state, updates);
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('[store] Listener error:', err);
    }
  }
}
