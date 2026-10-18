import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Starting WorkCred (Backend & Frontend) ===\n');

function prefixStream(stream, prefix) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep last incomplete line
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix} ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) {
      console.log(`${prefix} ${buffer}`);
    }
  });
}

// 1. Start Backend
const backendCwd = path.join(rootDir, 'backend');
const backendProc = spawn('node', ['--env-file=.env', 'src/server.js'], {
  cwd: backendCwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32'
});

prefixStream(backendProc.stdout, '[backend]');
prefixStream(backendProc.stderr, '[backend:err]');

// 2. Start Frontend
const frontendCwd = path.join(rootDir, 'frontend');
const frontendProc = spawn('node', ['--env-file=.env', 'server.js'], {
  cwd: frontendCwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32'
});

prefixStream(frontendProc.stdout, '[frontend]');
prefixStream(frontendProc.stderr, '[frontend:err]');

function checkUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServers() {
  console.log('[launcher] Waiting for backend (4000) and frontend (3000) to answer...');
  const maxAttempts = 40; // 20 seconds
  for (let i = 0; i < maxAttempts; i++) {
    const backendUp = await checkUrl('http://localhost:4000/api/v1/health');
    const frontendUp = await checkUrl('http://localhost:3000/');

    if (backendUp && frontendUp) {
      console.log('\n===========================================');
      console.log('  WorkCred running at http://localhost:3000');
      console.log('  Backend API running at http://localhost:4000');
      console.log('  Press Ctrl+C to stop both servers');
      console.log('===========================================\n');

      // Open browser
      openBrowser('http://localhost:3000');
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('[launcher] Timed out waiting for servers to answer. Check process logs above.');
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch (err) {
    console.error(`[launcher] Could not open browser automatically: ${err.message}`);
  }
}

// Handle clean shutdown on Ctrl+C
let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[launcher] Stopping both servers...');

  if (process.platform === 'win32') {
    if (backendProc.pid) spawn('taskkill', ['/pid', backendProc.pid.toString(), '/T', '/F']);
    if (frontendProc.pid) spawn('taskkill', ['/pid', frontendProc.pid.toString(), '/T', '/F']);
  } else {
    backendProc.kill('SIGTERM');
    frontendProc.kill('SIGTERM');
  }

  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

waitForServers();
