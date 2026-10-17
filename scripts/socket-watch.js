#!/usr/bin/env node

/**
 * scripts/socket-watch.js
 *
 * Realtime event monitor for WorkCred.
 * Logs in with the provided user credentials and streams all Socket.io
 * events received until terminated (Ctrl+C).
 *
 * Usage:
 *   node scripts/socket-watch.js <email> <password> <role>
 *
 * Examples:
 *   node scripts/socket-watch.js customer@example.com MyPass123#Secure customer
 *   node scripts/socket-watch.js worker@example.com MyPass123#Secure worker
 *
 * Security:
 *   - Refuses non-localhost hosts
 *   - NEVER prints the JWT access token
 */

let io;
try {
  const mod = await import('socket.io-client');
  io = mod.io || mod.default?.io || mod.default;
} catch {
  const mod = await import('../backend/node_modules/socket.io-client/build/esm/index.js');
  io = mod.io || mod.default?.io || mod.default;
}

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:4000';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node scripts/socket-watch.js <email> <password> <role>');
  console.log('  <role> must be "customer" or "worker"');
  process.exit(1);
}

const [email, password, role] = args;

// 1. Refuse non-localhost hosts
const parsedUrl = new URL(BASE_URL);
if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
  console.error('ERROR: socket-watch refuses to run against non-localhost hosts.');
  process.exit(1);
}

async function login() {
  console.log(`[socket-watch] Logging in to ${BASE_URL} as "${email}" (role: ${role})...`);

  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role })
  });

  const data = await res.json().catch(() => null);

  if (res.status !== 200) {
    console.error(`Login failed with status ${res.status}:`, data?.error?.message || 'Unknown error');
    process.exit(1);
  }

  const accessToken = data?.data?.accessToken;
  const user = data?.data?.user;

  if (!accessToken) {
    console.error('No accessToken returned in login response.');
    process.exit(1);
  }

  console.log(`[socket-watch] Logged in successfully: ${user.name} (${user.id})`);
  return { accessToken, user };
}

async function main() {
  const { accessToken, user } = await login();

  console.log(`[socket-watch] Connecting Socket.io to ${BASE_URL}... (Ctrl+C to stop)`);

  const socket = io(BASE_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: accessToken }
  });

  socket.on('connect', () => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] Socket connected (socketId: ${socket.id})`);
  });

  socket.on('connect_error', (err) => {
    const time = new Date().toLocaleTimeString();
    console.error(`[${time}] Socket connection error: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] Socket disconnected (reason: ${reason})`);
  });

  socket.on('ready', (data) => {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] EVENT: ready ->`, JSON.stringify(data, null, 2));
  });

  const monitoredEvents = [
    'job:new',
    'job:filled',
    'radar:worker_free',
    'radar:worker_busy',
    'booking:request',
    'booking:created',
    'booking:started',
    'booking:completed',
    'booking:cancelled',
    'error'
  ];

  for (const ev of monitoredEvents) {
    socket.on(ev, (payload) => {
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] EVENT: ${ev} ->`, JSON.stringify(payload, null, 2));
    });
  }

  // Graceful exit on SIGINT
  process.on('SIGINT', () => {
    console.log('\n[socket-watch] Exiting...');
    socket.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[socket-watch] Fatal error:', err.message);
  process.exit(1);
});
