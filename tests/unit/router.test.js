import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuards } from '../../frontend/app/js/router.js';

describe('Router Pattern Matching & Guard Decisions', () => {
  const cases = [
    {
      name: 'Boot loading state returns loading action',
      path: '/app/home',
      state: { bootStatus: 'loading', user: null },
      expected: { action: 'loading' }
    },
    {
      name: 'Boot error state returns boot_error action',
      path: '/app/home',
      state: { bootStatus: 'error', user: null },
      expected: { action: 'boot_error' }
    },
    {
      name: 'Logged out visitor can view login page',
      path: '/app/login',
      state: { bootStatus: 'ready', user: null },
      expectedAction: 'render'
    },
    {
      name: 'Logged out visitor can view signup page',
      path: '/app/signup',
      state: { bootStatus: 'ready', user: null },
      expectedAction: 'render'
    },
    {
      name: 'Logged out visitor on protected worker home redirects to login and remembers path',
      path: '/app/home',
      state: { bootStatus: 'ready', user: null },
      expected: { action: 'redirect', to: '/app/login', remember: '/app/home' }
    },
    {
      name: 'Logged out visitor on protected account redirects to login and remembers path',
      path: '/app/account',
      state: { bootStatus: 'ready', user: null },
      expected: { action: 'redirect', to: '/app/login', remember: '/app/account' }
    },
    {
      name: 'Logged in worker on /app/login redirects to worker home',
      path: '/app/login',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: true } },
      expected: { action: 'redirect', to: '/app/home' }
    },
    {
      name: 'Logged in customer on /app/signup redirects to customer find',
      path: '/app/signup',
      state: { bootStatus: 'ready', user: { role: 'customer', profileComplete: true } },
      expected: { action: 'redirect', to: '/app/find' }
    },
    {
      name: 'User with mustChangePassword redirects to password change page',
      path: '/app/home',
      state: { bootStatus: 'ready', user: { role: 'worker', mustChangePassword: true, profileComplete: true } },
      expected: { action: 'redirect', to: '/app/account/password' }
    },
    {
      name: 'User with mustChangePassword on /app/account/password renders page',
      path: '/app/account/password',
      state: { bootStatus: 'ready', user: { role: 'worker', mustChangePassword: true, profileComplete: true } },
      expectedAction: 'render'
    },
    {
      name: 'Incomplete worker profile on /app/home redirects to onboarding',
      path: '/app/home',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: false } },
      expected: { action: 'redirect', to: '/app/onboarding' }
    },
    {
      name: 'Incomplete profile on /app/onboarding renders onboarding',
      path: '/app/onboarding',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: false } },
      expectedAction: 'render'
    },
    {
      name: 'Completed profile on /app/onboarding redirects to role home (worker)',
      path: '/app/onboarding',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: true } },
      expected: { action: 'redirect', to: '/app/home' }
    },
    {
      name: 'Completed profile on /app/onboarding redirects to role home (customer)',
      path: '/app/onboarding',
      state: { bootStatus: 'ready', user: { role: 'customer', profileComplete: true } },
      expected: { action: 'redirect', to: '/app/find' }
    },
    {
      name: 'Worker opening customer route /app/find gets 404',
      path: '/app/find',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: true } },
      expected: { action: '404' }
    },
    {
      name: 'Customer opening worker route /app/home gets 404',
      path: '/app/home',
      state: { bootStatus: 'ready', user: { role: 'customer', profileComplete: true } },
      expected: { action: '404' }
    },
    {
      name: 'Unknown /app path gets 404',
      path: '/app/unknown-secret',
      state: { bootStatus: 'ready', user: { role: 'worker', profileComplete: true } },
      expected: { action: '404' }
    }
  ];

  cases.forEach(c => {
    test(c.name, () => {
      const result = evaluateGuards(c.path, c.state);
      if (c.expected) {
        assert.deepEqual(result, c.expected);
      } else if (c.expectedAction) {
        assert.equal(result.action, c.expectedAction);
      }
    });
  });
});
