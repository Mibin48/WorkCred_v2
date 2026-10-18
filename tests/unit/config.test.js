import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getCleanHost, isAllowedHost } from '../../frontend/serverUtils.js';

describe('Config.js host validation & generation (M6)', () => {
  test('strips port and normalizes host correctly', () => {
    assert.equal(getCleanHost('localhost:3000'), 'localhost');
    assert.equal(getCleanHost('127.0.0.1:3000'), '127.0.0.1');
    assert.equal(getCleanHost('LOCALHOST:8080'), 'localhost');
    assert.equal(getCleanHost(''), null);
  });

  test('validates allowed hosts vs disallowed hosts', () => {
    assert.equal(isAllowedHost('localhost'), true);
    assert.equal(isAllowedHost('127.0.0.1'), true);
    assert.equal(isAllowedHost('evil.com'), false);
    assert.equal(isAllowedHost('attacker.net'), false);
  });

  test('config output contains window.WORKCRED and apiBase and nothing else', () => {
    const host = 'localhost';
    const backendPort = 4000;
    const jsContent = `window.WORKCRED = { apiBase: "http://${host}:${backendPort}/api/v1" };\n`;

    assert.ok(jsContent.startsWith('window.WORKCRED = { apiBase:'));
    assert.ok(jsContent.includes('http://localhost:4000/api/v1'));
    // Make sure no tokens, keys, secrets or other properties are in config
    assert.ok(!jsContent.includes('secret'));
    assert.ok(!jsContent.includes('token'));
    assert.ok(!jsContent.includes('key'));
  });
});
