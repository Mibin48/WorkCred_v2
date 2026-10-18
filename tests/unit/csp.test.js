import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCspDirectives } from '../../frontend/serverUtils.js';

describe('CSP Header Directives Construction', () => {
  test('strictly excludes unsafe-inline and unsafe-eval across all directives', () => {
    const directives = buildCspDirectives('localhost', 4000);

    for (const [key, val] of Object.entries(directives)) {
      if (!val) continue;
      const arrayVal = Array.isArray(val) ? val : [val];
      for (const item of arrayVal) {
        if (!item || typeof item !== 'string') continue;
        assert.ok(!item.includes('unsafe-inline'), `Directive ${key} contains unsafe-inline`);
        assert.ok(!item.includes('unsafe-eval'), `Directive ${key} contains unsafe-eval`);
      }
    }
  });

  test('connect-src binds dynamically to validated host and backend port', () => {
    const directivesLocal = buildCspDirectives('localhost', 4000);
    assert.ok(directivesLocal.connectSrc.includes('http://localhost:4000'));
    assert.ok(directivesLocal.connectSrc.includes('https://api.cloudinary.com'));

    const directivesIp = buildCspDirectives('127.0.0.1', 4000);
    assert.ok(directivesIp.connectSrc.includes('http://127.0.0.1:4000'));
  });

  test('frame-ancestors and object-src are set to none', () => {
    const directives = buildCspDirectives('localhost', 4000);
    assert.deepEqual(directives.frameAncestors, ["'none'"]);
    assert.deepEqual(directives.objectSrc, ["'none'"]);
  });

  test('image sources permit self, data, blob, and res.cloudinary.com', () => {
    const directives = buildCspDirectives('localhost', 4000);
    assert.deepEqual(directives.imgSrc, ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com']);
  });
});
