import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateEnv } from '../../../src/config/env.js';

describe('backend/src/config/env.js', () => {
  const validBase64Key = crypto.randomBytes(32).toString('base64');

  const validEnv = {
    NODE_ENV: 'test',
    PORT: '4000',
    MONGODB_URI: 'mongodb://localhost:27017/workcred_test',
    FRONTEND_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CODES_ENC_KEY: validBase64Key,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: 'false',
    RATE_LIMIT_ENABLED: 'true'
  };

  it('validates a complete and correct environment config', () => {
    const config = validateEnv(validEnv);
    assert.equal(config.NODE_ENV, 'test');
    assert.equal(config.PORT, 4000);
    assert.equal(config.MONGODB_URI, 'mongodb://localhost:27017/workcred_test');
    assert.deepEqual(config.FRONTEND_ORIGINS, ['http://localhost:3000', 'http://127.0.0.1:3000']);
    assert.equal(config.LOG_LEVEL, 'silent');
    assert.equal(config.TRUST_PROXY, false);
    assert.equal(config.RATE_LIMIT_ENABLED, true);
  });

  it('fails when required variables are missing and lists their names without printing values', () => {
    const incompleteEnv = { ...validEnv };
    delete incompleteEnv.PORT;
    delete incompleteEnv.CODES_ENC_KEY;

    assert.throws(
      () => validateEnv(incompleteEnv),
      (err) => {
        assert.match(err.message, /Missing required variables: PORT, CODES_ENC_KEY/);
        // Ensure values of other secrets are not leaked in the error
        assert.equal(err.message.includes(validEnv.JWT_ACCESS_SECRET), false);
        return true;
      }
    );
  });

  it('fails when MONGODB_URI does not contain a database name', () => {
    const invalidDbEnv = {
      ...validEnv,
      MONGODB_URI: 'mongodb://localhost:27017' // Missing /workcred database name
    };

    assert.throws(
      () => validateEnv(invalidDbEnv),
      (err) => {
        assert.match(err.message, /MONGODB_URI \(connection string must include the database name in the path\)/);
        assert.equal(err.message.includes('mongodb://'), false); // Doesn't echo raw URI
        return true;
      }
    );
  });

  it('fails when FRONTEND_ORIGINS contains wildcard', () => {
    const wildcardEnv = {
      ...validEnv,
      FRONTEND_ORIGINS: '*'
    };

    assert.throws(
      () => validateEnv(wildcardEnv),
      (err) => {
        assert.match(err.message, /FRONTEND_ORIGINS/);
        return true;
      }
    );
  });

  it('fails when CODES_ENC_KEY is not 32 bytes', () => {
    const badKeyEnv = {
      ...validEnv,
      CODES_ENC_KEY: Buffer.from('short-key').toString('base64')
    };

    assert.throws(
      () => validateEnv(badKeyEnv),
      (err) => {
        assert.match(err.message, /CODES_ENC_KEY/);
        return true;
      }
    );
  });
});
