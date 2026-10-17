/**
 * scripts/check-all.js
 *
 * Runs auth-check, profile-check, b4-check, b5-check, b6-check, b7-check
 * one after another against the running server.
 * Stops on the first FAIL, prints a one-line PASS or FAIL per script,
 * and a final summary.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SCRIPTS = [
  { name: 'auth-check', file: 'scripts/auth-check.js' },
  { name: 'profile-check', file: 'scripts/profile-check.js' },
  { name: 'b4-check', file: 'scripts/b4-check.js' },
  { name: 'b5-check', file: 'scripts/b5-check.js' },
  { name: 'b6-check', file: 'scripts/b6-check.js' },
  { name: 'b7-check', file: 'scripts/b7-check.js' }
];

async function runScript(script) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(ROOT, script.file)], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  console.log('====================================================');
  console.log('WorkCred Complete Verification Suite (check:all)');
  console.log('====================================================\n');

  const results = [];

  for (const script of SCRIPTS) {
    process.stdout.write(`Running ${script.name}... `);
    const result = await runScript(script);

    if (result.code === 0) {
      console.log('PASS');
      results.push({ name: script.name, status: 'PASS' });
    } else {
      console.log('FAIL');
      console.error(`\n--- [${script.name}] Failure Details ---`);
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
      console.error('-----------------------------------------\n');
      results.push({ name: script.name, status: 'FAIL' });

      console.log('\n====================================================');
      console.log('SUMMARY: Stopped on first failure.');
      results.forEach((r) => console.log(`  ${r.name}: ${r.status}`));
      console.log('====================================================');
      process.exit(1);
    }
  }

  console.log('\n====================================================');
  console.log('FINAL SUMMARY: ALL CHECKS PASSED');
  results.forEach((r) => console.log(`  ${r.name}: PASS`));
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Unexpected error in check-all:', err);
  process.exit(1);
});
