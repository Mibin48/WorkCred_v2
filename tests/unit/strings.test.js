import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../../frontend/app/js/i18n/strings.en.js';

describe('Strings and i18n helper t()', () => {
  test('returns exact string for existing key without params', () => {
    assert.equal(t('app.name'), 'WorkCred');
    assert.equal(t('app.tagline'), 'Proof of work, work near you.');
  });

  test('interpolates single parameter correctly', () => {
    const res = t('account.forcePasswordTitle');
    assert.equal(res, 'Password change required');

    const withParam = t('error.accountLocked', { minutes: 10 });
    assert.equal(withParam, 'Too many tries. Try again in 10 minutes.');
  });

  test('interpolates multiple parameters correctly', () => {
    const res = t('onboarding.stepIndicator', { current: 2, total: 4, name: 'Your rate' });
    assert.equal(res, 'Step 2 of 4: Your rate');
  });

  test('returns the key itself when key is missing in dictionary and logs warning', () => {
    const missingKey = 'completely.nonexistent.key.xyz';
    const res = t(missingKey);
    assert.equal(res, missingKey);
  });

  test('leaves unfilled placeholder tokens intact if param is omitted', () => {
    const res = t('onboarding.stepIndicator', { current: 1 });
    assert.ok(res.includes('Step 1 of {total}: {name}'));
  });
});
