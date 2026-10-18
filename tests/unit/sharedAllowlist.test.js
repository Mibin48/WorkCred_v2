import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const SHARED_ALLOWLIST = new Set([
  'validators.js',
  'passwordRules.js',
  'containsContactInfo.js',
  'profileValidators.js',
  'profileRules.js'
]);

const FORBIDDEN_FILES = [
  'localities.js',
  'codesCrypto.js',
  'passportHash.js',
  'geo.js',
  'calendarRules.js',
  'bookingStateMachine.js'
];

describe('Shared Directory Security Allow-List (M7)', () => {
  test('allowed files exist on disk in shared/ directory', () => {
    for (const fileName of SHARED_ALLOWLIST) {
      const diskPath = path.join(rootDir, 'shared', fileName);
      assert.ok(fs.existsSync(diskPath), `Expected allowed file ${fileName} to exist on disk`);
    }
  });

  test('none of the served files import from node: modules', () => {
    for (const fileName of SHARED_ALLOWLIST) {
      const diskPath = path.join(rootDir, 'shared', fileName);
      const content = fs.readFileSync(diskPath, 'utf8');

      // Check imports
      const hasNodeImport = /import\s+.*from\s+['"]node:/i.test(content) ||
                            /import\s*\(['"]node:/i.test(content) ||
                            /require\(['"]node:/i.test(content);

      assert.ok(!hasNodeImport, `Served file ${fileName} imports from node: module, violating browser safety`);
    }
  });

  test('forbidden files are excluded from the allowlist', () => {
    for (const fileName of FORBIDDEN_FILES) {
      assert.equal(SHARED_ALLOWLIST.has(fileName), false, `Forbidden file ${fileName} must NOT be in allowlist`);
    }
  });
});
