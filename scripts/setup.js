import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Setting up WorkCred ===\n');

function runNpm(args, cwd) {
  console.log(`> Running 'npm ${args.join(' ')}' in ${path.relative(rootDir, cwd) || '.'}`);
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: true
  });
  if (result.status !== 0) {
    console.error(`Command failed with code ${result.status}`);
    process.exit(result.status || 1);
  }
}

// 1. Install root dependencies
runNpm(['install'], rootDir);

// 2. Install backend dependencies
runNpm(['install'], path.join(rootDir, 'backend'));

// 3. Install frontend dependencies
runNpm(['install'], path.join(rootDir, 'frontend'));

// 4. Run copy-fonts
console.log('\n> Copying fonts...');
const copyFontsResult = spawnSync('node', ['scripts/copy-fonts.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true
});

if (copyFontsResult.status !== 0) {
  console.error('Failed to copy fonts');
  process.exit(1);
}

console.log('\n=== Setup complete! ===');
console.log('You can now run:');
console.log('  npm run doctor    - Verify system requirements');
console.log('  npm run start     - Start backend and frontend simultaneously');
