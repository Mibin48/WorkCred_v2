import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from '../../../../shared/passwordRules.js';

describe('shared/passwordRules.js', () => {
  it('accepts strong, compliant passwords', () => {
    const res = validatePassword('SunriseBridge99!@', {
      name: 'Ravi Kumar',
      phone: '9876543210',
      email: 'ravi@example.com'
    });
    assert.equal(res.valid, true);
  });

  it('rejects passwords shorter than 8 characters', () => {
    const res = validatePassword('Short1!');
    assert.equal(res.valid, false);
    assert.match(res.error, /at least 8 characters/);
  });

  it('rejects passwords longer than 64 characters', () => {
    const res = validatePassword('a'.repeat(65));
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot exceed 64 characters/);
  });

  it('rejects common passwords', () => {
    assert.equal(validatePassword('password').valid, false);
    assert.equal(validatePassword('12345678').valid, false);
    assert.equal(validatePassword('qwertyuiop').valid, false);
  });

  it('rejects password containing user phone number', () => {
    const res = validatePassword('MyPass9876543210!', { phone: '9876543210' });
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot contain your phone number/);
  });

  it('rejects password containing user name', () => {
    const res = validatePassword('secretRavi123!', { name: 'Ravi Kumar' });
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot contain your name/);
  });

  it('rejects password containing user email prefix', () => {
    const res = validatePassword('secretravi123!', { email: 'ravi@example.com' });
    assert.equal(res.valid, false);
    assert.match(res.error, /cannot contain your email prefix/);
  });

  it('rejects repeated patterns (e.g. aaaa, 1111)', () => {
    const res = validatePassword('passaaaa123');
    assert.equal(res.valid, false);
    assert.match(res.error, /repeated or sequential patterns/);
  });

  it('rejects sequential patterns (e.g. 1234, abcd)', () => {
    const res = validatePassword('safe12345extra');
    assert.equal(res.valid, false);
    assert.match(res.error, /repeated or sequential patterns/);
  });
});
