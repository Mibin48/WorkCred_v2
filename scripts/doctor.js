import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== WorkCred System Doctor ===\n');

let allOk = true;

// 1. Node version check
const nodeVersion = process.versions.node;
const [major, minor] = nodeVersion.split('.').map(Number);
const isNodeOk = major > 20 || (major === 20 && minor >= 6);
if (isNodeOk) {
  console.log(`[PASS] Node version: v${nodeVersion} (>= 20.6.0 required)`);
} else {
  console.error(`[FAIL] Node version: v${nodeVersion} is below 20.6.0`);
  allOk = false;
}

// 2. backend/.env checks
const backendEnvPath = path.join(rootDir, 'backend', '.env');
const backendEnvExamplePath = path.join(rootDir, 'backend', '.env.example');

if (!fs.existsSync(backendEnvPath)) {
  console.error(`[FAIL] backend/.env file does not exist!`);
  allOk = false;
} else {
  const envContent = fs.readFileSync(backendEnvPath, 'utf8');
  const envLines = envContent.split('\n');
  const definedKeys = new Set();
  let frontendOriginsVal = '';

  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      definedKeys.add(key);
      if (key === 'FRONTEND_ORIGINS') {
        frontendOriginsVal = val;
      }
    }
  }

  // Check required keys from .env.example
  if (fs.existsSync(backendEnvExamplePath)) {
    const exampleContent = fs.readFileSync(backendEnvExamplePath, 'utf8');
    const exampleKeys = exampleContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim());

    const missingKeys = exampleKeys.filter(k => !definedKeys.has(k));
    if (missingKeys.length === 0) {
      console.log(`[PASS] backend/.env contains all ${exampleKeys.length} required environment variable names (values kept private)`);
    } else {
      console.error(`[FAIL] backend/.env is missing required variables: ${missingKeys.join(', ')}`);
      allOk = false;
    }
  }

  // Check FRONTEND_ORIGINS
  const hasLocalhost = frontendOriginsVal.includes('http://localhost:3000');
  const has127 = frontendOriginsVal.includes('http://127.0.0.1:3000');
  if (hasLocalhost && has127) {
    console.log(`[PASS] FRONTEND_ORIGINS contains both http://localhost:3000 and http://127.0.0.1:3000`);
  } else if (hasLocalhost) {
    console.log(`[PASS] FRONTEND_ORIGINS contains http://localhost:3000`);
  } else {
    console.error(`[FAIL] FRONTEND_ORIGINS must contain http://localhost:3000`);
    allOk = false;
  }
}

// 3. Port check helper
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, check if it's already responding to our service
        resolve({ inUse: true, error: null });
      } else {
        resolve({ inUse: false, error: err.message });
      }
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({ inUse: false, error: null });
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (err) => resolve({ status: null, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'timed out' });
    });
  });
}

async function runAsyncChecks() {
  // Ports 3000 and 4000 checks
  const port3000 = await checkPort(3000);
  const port4000 = await checkPort(4000);

  if (!port3000.inUse) {
    console.log(`[PASS] Port 3000 is free`);
  } else {
    // Check if frontend is already responding
    const feRes = await httpGet('http://localhost:3000/');
    if (feRes.status === 200 || feRes.status === 304) {
      console.log(`[PASS] Port 3000 is occupied by our WorkCred frontend`);
    } else {
      console.log(`[WARN] Port 3000 is currently in use`);
    }
  }

  if (!port4000.inUse) {
    console.log(`[PASS] Port 4000 is free`);
  } else {
    // Check if backend is already responding
    const beRes = await httpGet('http://localhost:4000/health/live');
    if (beRes.status === 200) {
      console.log(`[PASS] Port 4000 is occupied by our WorkCred backend`);
    } else {
      console.log(`[WARN] Port 4000 is currently in use`);
    }
  }

  // Backend /health/ready check
  const readyRes = await httpGet('http://localhost:4000/health/ready');
  if (readyRes.status === 200) {
    console.log(`[PASS] Backend /health/ready: 200 OK (database connected)`);
  } else {
    console.log(`[INFO] Backend is not currently running (start with 'npm start')`);
  }

  // Frontend reachable check
  const feCheck = await httpGet('http://localhost:3000/');
  if (feCheck.status === 200) {
    console.log(`[PASS] Frontend server reachable on http://localhost:3000/`);
  } else {
    console.log(`[INFO] Frontend is not currently running (start with 'npm start')`);
  }

  // Sample data /demo/accounts check
  const demoRes = await httpGet('http://localhost:4000/api/v1/demo/accounts');
  if (demoRes.status === 200) {
    try {
      const parsed = JSON.parse(demoRes.data);
      const accountsCount = parsed?.data?.accounts?.length || 0;
      console.log(`[PASS] Demo accounts endpoint: 200 OK (${accountsCount} sample accounts ready)`);
    } catch {
      console.log(`[PASS] Demo accounts endpoint: 200 OK (sample data exists)`);
    }
  } else if (demoRes.status === 404) {
    console.log(`[INFO] Demo accounts endpoint: 404 (sample data not seeded; run 'npm run seed' in backend to seed)`);
  }

  console.log('\n--- Doctor Check Summary ---');
  if (allOk) {
    console.log('All static environment and system requirements are OK.');
  } else {
    console.error('Some requirements failed. Review the messages above.');
    process.exit(1);
  }
}

runAsyncChecks();
