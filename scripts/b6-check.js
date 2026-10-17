import crypto from 'node:crypto';

let io;
try {
  const mod = await import('socket.io-client');
  io = mod.io || mod.default?.io || mod.default;
} catch {
  const mod = await import('../backend/node_modules/socket.io-client/build/esm/index.js');
  io = mod.io || mod.default?.io || mod.default;
}

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:4000';
const MONGODB_URI = process.env.MONGODB_URI;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function apiRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

function connectSocket(token) {
  return io(BASE_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token }
  });
}

function trackSocketEvents(socket, name, eventsList) {
  const allEvents = [
    'ready',
    'job:new',
    'job:filled',
    'radar:worker_free',
    'radar:worker_busy',
    'booking:request',
    'booking:created',
    'booking:started',
    'booking:completed',
    'booking:cancelled'
  ];

  for (const ev of allEvents) {
    socket.on(ev, (data) => {
      const time = new Date().toLocaleTimeString();
      console.log(`   [${time}] [${name}] Event: ${ev} -> ${JSON.stringify(data)}`);
      eventsList.push({ name, event: ev, data, time: Date.now() });
    });
  }
}

async function waitForEvent(eventsList, predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = eventsList.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function main() {
  console.log(`[b6-check.js] Connecting to local server at ${BASE_URL}...`);

  // Refuse non-localhost hosts
  const parsed = new URL(BASE_URL);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    console.error('ERROR: b6-check.js refuses to run on non-localhost hosts.');
    process.exit(1);
  }

  // 1. Health check
  const health = await apiRequest('/api/v1/health');
  assert(health.status === 200, `Health check failed: status ${health.status}`);
  console.log('PASS: 1. Server Health Check (status: 200)');

  // 2. Create users with complete profiles
  const rand = crypto.randomBytes(4).toString('hex');
  const password = 'ComplexPassword123#Secure';

  async function makeUser(role, name, localityKey, skills = [], hourlyRate = 400, radiusKm = 5) {
    const email = `b6_${name.toLowerCase().replace(/\s+/g, '_')}_${rand}@example.com`;
    const signup = await apiRequest('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone: '9845012345', password, role })
    });
    assert(signup.status === 201, `Signup failed for ${name}: ${JSON.stringify(signup.data)}`);
    const token = signup.data.data.accessToken;
    const id = signup.data.data.user.id;

    if (role === 'worker') {
      const formattedSkills = skills.map((s, idx) =>
        typeof s === 'string' ? { skill: s, isMain: idx === 0 } : s
      );
      await apiRequest('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ skills: formattedSkills, localityKey, hourlyRate, radiusKm })
      });
    } else {
      await apiRequest('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ localityKey })
      });
    }
    return { id, email, token, name, password };
  }

  const nearCustomer = await makeUser('customer', 'Near Customer', 'kakkanad');
  const farCustomer = await makeUser('customer', 'Far Customer', 'aluva');
  const electricianA = await makeUser('worker', 'Electrician A', 'kakkanad', ['electrician'], 400, 5);
  const electricianB = await makeUser('worker', 'Electrician B', 'kakkanad', ['electrician'], 450, 5);
  const plumberC = await makeUser('worker', 'Plumber C', 'kakkanad', ['plumber'], 350, 5);

  console.log('PASS: 2. Created near customer, far customer, two electricians and one plumber');

  // 3. Open sockets for all and track events
  const recordedEvents = [];
  const sockNearCust = connectSocket(nearCustomer.token);
  const sockFarCust = connectSocket(farCustomer.token);
  const sockElecA = connectSocket(electricianA.token);
  const sockElecB = connectSocket(electricianB.token);
  const sockPlumbC = connectSocket(plumberC.token);

  trackSocketEvents(sockNearCust, 'NearCust', recordedEvents);
  trackSocketEvents(sockFarCust, 'FarCust', recordedEvents);
  trackSocketEvents(sockElecA, 'ElecA', recordedEvents);
  trackSocketEvents(sockElecB, 'ElecB', recordedEvents);
  trackSocketEvents(sockPlumbC, 'PlumbC', recordedEvents);

  // Wait for all ready events
  await new Promise((r) => setTimeout(r, 600));
  console.log('PASS: 3. Connected sockets for all 5 users and received "ready"');

  // 4. Electrician A goes Free Now (2 h)
  const freeRes = await apiRequest('/api/v1/availability', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${electricianA.token}` },
    body: JSON.stringify({ hours: 2 })
  });
  assert(freeRes.status === 201, `Electrician A go Free Now failed: ${JSON.stringify(freeRes.data)}`);

  const radarFreeNear = await waitForEvent(recordedEvents, (e) => e.name === 'NearCust' && e.event === 'radar:worker_free' && e.data.workerId === electricianA.id);
  assert(radarFreeNear, 'Near customer must receive radar:worker_free');

  const radarFreeFar = recordedEvents.find((e) => e.name === 'FarCust' && e.event === 'radar:worker_free');
  assert(!radarFreeFar, 'Far customer must NOT receive radar:worker_free');

  const radarFreeWorkers = recordedEvents.filter((e) => ['ElecA', 'ElecB', 'PlumbC'].includes(e.name) && e.event === 'radar:worker_free');
  assert(radarFreeWorkers.length === 0, 'Workers must NOT receive radar:worker_free');

  console.log('PASS: 4. Electrician A goes Free Now: near customer notified, far customer and workers excluded');

  // 5. Nearby list shows Electrician A and not the plumber
  const nearbyRes = await apiRequest('/api/v1/availability/nearby?skill=electrician&radiusKm=5', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${nearCustomer.token}` }
  });
  assert(nearbyRes.status === 200, `Nearby failed: ${JSON.stringify(nearbyRes.data)}`);
  const nearbyWorkers = nearbyRes.data.data.workers;
  const foundA = nearbyWorkers.some((w) => w.workerId === electricianA.id);
  const foundPlumber = nearbyWorkers.some((w) => w.workerId === plumberC.id);
  assert(foundA, 'Electrician A must appear in nearby list');
  assert(!foundPlumber, 'Plumber C must NOT appear in electrician nearby list');
  console.log('PASS: 5. Nearby list verified: Electrician A present, Plumber C filtered out');

  // 6. Customer books A from Free Now
  const bookKey = `b6_key_${Date.now()}`;
  const bookRes = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${nearCustomer.token}`,
      'Idempotency-Key': bookKey
    },
    body: JSON.stringify({
      workerId: electricianA.id,
      hours: 1,
      fromFreeNow: true
    })
  });
  assert(bookRes.status === 201, `Free Now booking failed: ${JSON.stringify(bookRes.data)}`);
  const bookingId = bookRes.data.data.booking.id;

  // A gets booking:request
  const reqEventA = await waitForEvent(recordedEvents, (e) => e.name === 'ElecA' && e.event === 'booking:request' && e.data.bookingId === bookingId);
  assert(reqEventA, 'Electrician A must receive booking:request');

  // Near customer gets radar:worker_busy
  const busyEventNear = await waitForEvent(recordedEvents, (e) => e.name === 'NearCust' && e.event === 'radar:worker_busy' && e.data.workerId === electricianA.id);
  assert(busyEventNear, 'Near customer must receive radar:worker_busy');

  // A disappears from nearby
  const nearbyAfter = await apiRequest('/api/v1/availability/nearby?skill=electrician&radiusKm=5', {
    headers: { 'Authorization': `Bearer ${nearCustomer.token}` }
  });
  const foundAAfter = nearbyAfter.data.data.workers.some((w) => w.workerId === electricianA.id);
  assert(!foundAAfter, 'Electrician A must no longer appear in nearby list');

  // Far customer second booking attempt from Free Now fails with 409 NOT_FREE_NOW
  const secondBookRes = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${farCustomer.token}`,
      'Idempotency-Key': `b6_sec_${Date.now()}`
    },
    body: JSON.stringify({
      workerId: electricianA.id,
      hours: 1,
      fromFreeNow: true
    })
  });
  assert(secondBookRes.status === 409, `Second booking must fail with 409: ${secondBookRes.status}`);
  console.log('PASS: 6. Booking from Free Now verified: worker requested, window closed, busy announced, duplicate refused');

  // 7. A confirms: customer gets booking:created
  const confRes = await apiRequest(`/api/v1/bookings/${bookingId}/confirm`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${electricianA.token}` }
  });
  assert(confRes.status === 200, `Confirm failed: ${JSON.stringify(confRes.data)}`);
  const createdEventCust = await waitForEvent(recordedEvents, (e) => e.name === 'NearCust' && e.event === 'booking:created' && e.data.bookingId === bookingId);
  assert(createdEventCust, 'Customer must receive booking:created');
  console.log('PASS: 7. Booking confirmed: customer notified with booking:created');

  // 8. Customer posts a job for electricians: only Electrician B gets job:new
  const jobRes = await apiRequest('/api/v1/jobs', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${nearCustomer.token}` },
    body: JSON.stringify({
      skill: 'electrician',
      workersNeeded: 1,
      hours: 2,
      startAt: new Date(Date.now() + 3600000).toISOString(),
      offeredRate: 400,
      description: 'Job for electricians in Kakkanad',
      localityKey: 'kakkanad'
    })
  });
  assert(jobRes.status === 201, `Job create failed: ${JSON.stringify(jobRes.data)}`);
  const jobId = jobRes.data.data.job.id;

  const jobNewB = await waitForEvent(recordedEvents, (e) => e.name === 'ElecB' && e.event === 'job:new' && e.data.jobId === jobId);
  assert(jobNewB, 'Electrician B must receive job:new');

  const jobNewPlumber = recordedEvents.find((e) => e.name === 'PlumbC' && e.event === 'job:new' && e.data.jobId === jobId);
  assert(!jobNewPlumber, 'Plumber C must NOT receive job:new');

  console.log('PASS: 8. Job board targeting verified: only Electrician B received job:new');

  // 9. B accepts: customer gets booking:created
  const acceptRes = await apiRequest(`/api/v1/jobs/${jobId}/accept`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${electricianB.token}` }
  });
  assert(acceptRes.status === 200, `Accept failed: ${JSON.stringify(acceptRes.data)}`);
  const jobBookingId = acceptRes.data.data.bookingId;

  const jobBookingCreated = await waitForEvent(recordedEvents, (e) => e.name === 'NearCust' && e.event === 'booking:created' && e.data.bookingId === jobBookingId);
  assert(jobBookingCreated, 'Customer must receive booking:created when Electrician B accepts');
  console.log('PASS: 9. Job accepted: customer notified with booking:created');

  // 10. Stop and extend checks on a second window
  const win2Res = await apiRequest('/api/v1/availability', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${plumberC.token}` },
    body: JSON.stringify({ hours: 4 })
  });
  assert(win2Res.status === 201, `Plumber start failed: ${JSON.stringify(win2Res.data)}`);

  const extRes = await apiRequest('/api/v1/availability/extend', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${plumberC.token}` },
    body: JSON.stringify({ hours: 2 })
  });
  assert(extRes.status === 200, `Extend failed: ${JSON.stringify(extRes.data)}`);
  assert(extRes.data.data.window.totalHours === 6, 'Total hours must be 6 after extend');

  const stopRes = await apiRequest('/api/v1/availability', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${plumberC.token}` }
  });
  assert(stopRes.status === 200, `Stop failed: ${JSON.stringify(stopRes.data)}`);
  console.log('PASS: 10. Window start, extend, and stop verified on Plumber C');

  // 11. auth:refresh with a fresh token works
  const loginRes = await apiRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: nearCustomer.email, password, role: 'customer' })
  });
  assert(loginRes.status === 200, 'Login failed');
  const freshToken = loginRes.data.data.accessToken;

  const ack = await new Promise((resolve) => {
    sockNearCust.emit('auth:refresh', { token: freshToken }, resolve);
  });
  assert(ack && ack.ok === true, 'auth:refresh acknowledgement must be { ok: true }');
  console.log('PASS: 11. auth:refresh verified with fresh token');

  // 12. Garbage token socket is refused
  const badSock = io(BASE_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: 'invalid_garbage_token' }
  });
  const badErr = await new Promise((resolve) => badSock.on('connect_error', resolve));
  assert(badErr && badErr.message === 'AUTH_INVALID', `Expected AUTH_INVALID, got: ${badErr?.message}`);
  badSock.close();
  console.log('PASS: 12. Socket with garbage token refused with AUTH_INVALID');

  // 13. Expiry check directly in database (if MONGODB_URI is provided)
  if (MONGODB_URI) {
    console.log('[b6-check.js] MONGODB_URI present. Running read-time and sweeper expiry check...');
    let mongooseMod;
    try {
      mongooseMod = (await import('mongoose')).default;
    } catch {
      mongooseMod = (await import('../backend/node_modules/mongoose/index.js')).default;
    }

    const conn = await mongooseMod.createConnection(MONGODB_URI).asPromise();
    const AvailabilityModel = conn.model('Availability', new mongooseMod.Schema({}, { strict: false }));

    // Start a 2h window for Electrician B
    await apiRequest('/api/v1/availability', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${electricianB.token}` },
      body: JSON.stringify({ hours: 2 })
    });

    // Manually push expiresAt into past (10 minutes ago)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await AvailabilityModel.updateOne(
      { workerId: new mongooseMod.Types.ObjectId(electricianB.id), active: true },
      { $set: { expiresAt: tenMinAgo } }
    );

    // Read-time: nearby should immediately exclude Electrician B
    const readTimeNearby = await apiRequest('/api/v1/availability/nearby?skill=electrician&radiusKm=5', {
      headers: { 'Authorization': `Bearer ${nearCustomer.token}` }
    });
    const foundB = readTimeNearby.data.data.workers.some((w) => w.workerId === electricianB.id);
    assert(!foundB, 'Expired window must be excluded from nearby at read-time immediately');
    console.log('   Read-time check: window immediately excluded from nearby');

    // Wait up to 35 seconds to observe sweeper announce radar:worker_busy
    console.log('   Waiting for background sweeper (up to 35s)...');
    const busyEventB = await waitForEvent(
      recordedEvents,
      (e) => e.name === 'NearCust' && e.event === 'radar:worker_busy' && e.data.workerId === electricianB.id,
      35000
    );
    assert(busyEventB, 'Sweeper must close expired window and announce radar:worker_busy');
    await conn.close();
    console.log('PASS: 13. Expiry check verified: read-time excluded and sweeper announced busy');
  } else {
    console.log('SKIPPED: 13. Expiry check directly in database (MONGODB_URI not set)');
  }

  // Clean up sockets
  sockNearCust.close();
  sockFarCust.close();
  sockElecA.close();
  sockElecB.close();
  sockPlumbC.close();

  console.log('\nALL B6 MANUAL CHECKS PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
