import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidName,
  isValidEmail,
  isValidIndianPhone,
  validateSignupShape,
  validateLoginShape,
  validatePasswordChangeShape
} from '../../../../shared/validators.js';

describe('shared/validators.js', () => {
  describe('isValidName', () => {
    it('accepts valid 2-100 character names', () => {
      assert.equal(isValidName('Ravi Kumar'), true);
      assert.equal(isValidName('Jo'), true);
    });

    it('rejects empty or excessively short names', () => {
      assert.equal(isValidName(''), false);
      assert.equal(isValidName(' '), false);
      assert.equal(isValidName('A'), false);
      assert.equal(isValidName(null), false);
    });
  });

  describe('isValidEmail', () => {
    it('accepts standard valid email addresses', () => {
      assert.equal(isValidEmail('ravi@example.com'), true);
      assert.equal(isValidEmail('customer.test@workcred.in'), true);
    });

    it('rejects invalid email formats', () => {
      assert.equal(isValidEmail('invalid-email'), false);
      assert.equal(isValidEmail('@example.com'), false);
      assert.equal(isValidEmail('ravi@.com'), false);
    });
  });

  describe('isValidIndianPhone', () => {
    it('accepts 10-digit Indian numbers starting with 6, 7, 8, 9', () => {
      assert.equal(isValidIndianPhone('9876543210'), true);
      assert.equal(isValidIndianPhone('6123456789'), true);
      assert.equal(isValidIndianPhone('+91 9876543210'), true);
    });

    it('rejects non-Indian or improperly sized numbers', () => {
      assert.equal(isValidIndianPhone('5876543210'), false); // Starts with 5
      assert.equal(isValidIndianPhone('12345'), false);
      assert.equal(isValidIndianPhone('987654321099'), false);
    });
  });

  describe('validateSignupShape', () => {
    it('accepts valid signup payload', () => {
      const res = validateSignupShape({
        role: 'worker',
        name: 'Ravi Kumar',
        email: 'Ravi@Example.com',
        phone: '9876543210',
        password: 'CorrectHorseBattery99!'
      });
      assert.equal(res.valid, true);
      assert.equal(res.data.email, 'ravi@example.com'); // Lowercased
      assert.equal(res.data.role, 'worker');
    });

    it('rejects unknown fields strictly', () => {
      const res = validateSignupShape({
        role: 'worker',
        name: 'Ravi Kumar',
        email: 'ravi@example.com',
        phone: '9876543210',
        password: 'CorrectHorseBattery99!',
        isAdmin: true // Unknown field
      });
      assert.equal(res.valid, false);
      assert.match(res.errors[0], /Unknown field: isAdmin/);
    });
  });

  describe('validateLoginShape', () => {
    it('accepts valid login payload and normalizes email', () => {
      const res = validateLoginShape({
        email: 'Customer@Domain.com',
        password: 'SecretPassword123!',
        role: 'customer'
      });
      assert.equal(res.valid, true);
      assert.equal(res.data.email, 'customer@domain.com');
    });

    it('rejects missing role or unknown attributes', () => {
      const res = validateLoginShape({
        email: 'test@example.com',
        password: 'pass',
        role: 'invalid_role'
      });
      assert.equal(res.valid, false);
    });
  });

  describe('validatePasswordChangeShape', () => {
    it('accepts valid change payload and rejects extra keys', () => {
      const valid = validatePasswordChangeShape({
        currentPassword: 'oldPassword123',
        newPassword: 'newSecretPassword123'
      });
      assert.equal(valid.valid, true);

      const invalid = validatePasswordChangeShape({
        currentPassword: 'oldPassword123',
        newPassword: 'newSecretPassword123',
        extra: 'field'
      });
      assert.equal(invalid.valid, false);
    });
  });
});
