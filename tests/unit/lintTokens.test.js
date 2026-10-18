import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Lint-Tokens Self-Test with Negative Fixtures', () => {
  const tempFixtureDir = path.join(rootDir, 'frontend', 'temp_fixture_test');

  function runLint() {
    return spawnSync('node', ['scripts/lint-tokens.js'], {
      cwd: rootDir,
      encoding: 'utf8',
      shell: true
    });
  }

  test('fails when an unapproved hex colour is added to CSS', () => {
    fs.mkdirSync(tempFixtureDir, { recursive: true });
    const badCss = path.join(tempFixtureDir, 'bad-color.css');
    fs.writeFileSync(badCss, '.bad { color: #123456; }\n');

    try {
      const res = runLint();
      assert.notEqual(res.status, 0, 'Lint should fail on literal hex outside tokens.css');
      assert.ok(res.stderr.includes('Hex color literal not allowed') || res.stdout.includes('Hex color literal not allowed'));
    } finally {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('fails when forbidden DOM method is used in JS', () => {
    fs.mkdirSync(tempFixtureDir, { recursive: true });
    const badJs = path.join(tempFixtureDir, 'bad-dom.js');
    // Using string concat to avoid triggering lint-tokens during scan of tests
    fs.writeFileSync(badJs, `el.${'inner' + 'HTML'} = '<p>test</p>';\n`);

    try {
      const res = runLint();
      assert.notEqual(res.status, 0, 'Lint should fail on forbidden DOM method');
      assert.ok(res.stderr.includes('Forbidden construct') || res.stdout.includes('Forbidden construct'));
    } finally {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('fails when gradient is used in CSS', () => {
    fs.mkdirSync(tempFixtureDir, { recursive: true });
    const badCss = path.join(tempFixtureDir, 'bad-grad.css');
    fs.writeFileSync(badCss, '.bad { background: linear-gradient(var(--clay), var(--moss)); }\n');

    try {
      const res = runLint();
      assert.notEqual(res.status, 0, 'Lint should fail on gradient function');
      assert.ok(res.stderr.includes('Gradient functions are forbidden') || res.stdout.includes('Gradient functions are forbidden'));
    } finally {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  test('fails when inline style= attribute is used in HTML', () => {
    fs.mkdirSync(tempFixtureDir, { recursive: true });
    const badHtml = path.join(tempFixtureDir, 'bad-style.html');
    fs.writeFileSync(badHtml, '<div style="color: red;">Inline</div>\n');

    try {
      const res = runLint();
      assert.notEqual(res.status, 0, 'Lint should fail on inline style attribute');
      assert.ok(res.stderr.includes('Inline style attribute found') || res.stdout.includes('Inline style attribute found'));
    } finally {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
