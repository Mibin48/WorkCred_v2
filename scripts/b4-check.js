import crypto from 'node:crypto';

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:4000';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function assertNoSecrets(obj) {
  const forbidden = [
    'passwordHash',
    'tokenVersion',
    'lockUntil',
    'lockLevel',
    'failedLoginCount',
    'location',
    'coordinates',
    'lat',
    'lng',
    'latitude',
    'longitude',
    'searchLocation',
    'startCodeEnc',
    'finishCodeEnc',
    'phone',
    'email'
  ];

  function scan(val, path = '') {
    if (!val || typeof val !== 'object') return;
    if (Array.isArray(val)) {
      val.forEach((item, idx) => scan(item, `${path}[${idx}]`));
      return;
    }
    for (const [key, value] of Object.entries(val)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (forbidden.includes(key)) {
        throw new Error(`Secret leaked at "${currentPath}"! Forbidden key: "${key}"`);
      }
      if (typeof value === 'object' && value !== null) {
        scan(value, currentPath);
      }
    }
  }

  scan(obj);
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

async function main() {
  console.log(`[b4-check.js] Connecting to local server at ${BASE_URL}...`);

  // Refuse non-localhost hosts
  const parsed = new URL(BASE_URL);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    console.error('ERROR: b4-check.js refuses to run on non-localhost hosts.');
    process.exit(1);
  }

  // 1. Health check
  const health = await apiRequest('/api/v1/health');
  assert(health.status === 200, `Health check failed with status ${health.status}`);
  console.log('PASS: 1. Server Health Check (status: 200)');

  // 2. Create 1 customer and 7 workers (Kochi localities, one daily-rate-only)
  const rand = crypto.randomBytes(4).toString('hex');
  const custEmail = `cust_${rand}@example.com`;
  const custSignup = await apiRequest('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer',
      name: 'Priya Nair',
      email: custEmail,
      phone: '9845012345',
      password: 'StrongPassword123#Cust'
    })
  });
  assert(custSignup.status === 201, `Customer signup failed: ${JSON.stringify(custSignup.data)}`);
  const custToken = custSignup.data.data.accessToken;

  // Complete customer profile
  const custProfile = await apiRequest('/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${custToken}` },
    body: JSON.stringify({ localityKey: 'edapally' })
  });
  assert(custProfile.status === 200, 'Customer profile completion failed');
  console.log('PASS: 2. Customer created and profile completed');

  // Worker setup data: skills, localities, rates
  const workerConfigs = [
    { name: 'Ravi Kumar', skill: 'electrician', loc: 'edapally', hourly: 150, daily: 0 },
    { name: 'Suresh Menon', skill: 'electrician', loc: 'kaloor', hourly: 160, daily: 0 },
    { name: 'Anil Varma', skill: 'plumber', loc: 'edapally', hourly: 140, daily: 0 },
    { name: 'Manoj Pillai', skill: 'mason', loc: 'edapally', hourly: 180, daily: 0 },
    { name: 'Deepak Joshi', skill: 'mason', loc: 'edapally', hourly: 175, daily: 0 },
    { name: 'Vijay Das', skill: 'mason', loc: 'edapally', hourly: 190, daily: 0 },
    { name: 'Sunil Thomas', skill: 'carpenter', loc: 'fort_kochi', hourly: 0, daily: 1200 } // daily rate only (1200/8 = 150)
  ];

  const workers = [];
  for (let i = 0; i < workerConfigs.length; i++) {
    const c = workerConfigs[i];
    const email = `worker_${i}_${rand}@example.com`;
    const phone = `98460000${String(i).padStart(2, '0')}`;
    const signup = await apiRequest('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        role: 'worker',
        name: c.name,
        email,
        phone,
        password: 'StrongPassword123#Work'
      })
    });
    assert(signup.status === 201, `Worker ${i} signup failed (status: ${signup.status}, body: ${JSON.stringify(signup.data)})`);
    const token = signup.data.data.accessToken;

    const patch = await apiRequest('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        localityKey: c.loc,
        skills: [{ skill: c.skill, isMain: true }],
        hourlyRate: c.hourly,
        dailyRate: c.daily,
        radiusKm: 10,
        bio: `Professional ${c.skill} based in Kochi`
      })
    });
    assert(patch.status === 200, `Worker ${i} profile completion failed`);
    workers.push({
      id: signup.data.data.user.id,
      token,
      ...c
    });
  }
  console.log('PASS: 3. Seven workers created with various skills, localities and rates (one daily-only)');

  // 3. Check worker search by skill, distance, price sort, and pagination walk
  const searchSkill = await apiRequest('/api/v1/workers?skill=electrician', {
    headers: { 'Authorization': `Bearer ${custToken}` }
  });
  assert(searchSkill.status === 200, 'Search by skill failed');
  assertNoSecrets(searchSkill.data);
  assert(searchSkill.data.data.workers.length >= 2, 'Expected at least 2 electricians');
  console.log('PASS: 4. Worker search by skill with privacy scanner clean');

  const searchPrice = await apiRequest('/api/v1/workers?skill=electrician&sort=price', {
    headers: { 'Authorization': `Bearer ${custToken}` }
  });
  assert(searchPrice.status === 200, 'Search by price sort failed');
  assertNoSecrets(searchPrice.data);
  const wPrices = searchPrice.data.data.workers.map(w => w.rate.effectiveHourly);
  assert(wPrices[0] <= wPrices[1], 'Price sort order incorrect');
  console.log('PASS: 5. Worker search sorted by price');

  // Pagination walk with limit 2
  let cursor = null;
  const collectedIds = new Set();
  while (true) {
    const url = `/api/v1/workers?skill=mason&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
    const pRes = await apiRequest(url, { headers: { 'Authorization': `Bearer ${custToken}` } });
    assert(pRes.status === 200, 'Pagination page failed');
    assertNoSecrets(pRes.data);
    for (const w of pRes.data.data.workers) {
      assert(!collectedIds.has(w.id), `Duplicate worker ${w.id} in pagination walk`);
      collectedIds.add(w.id);
    }
    cursor = pRes.data.data.nextCursor;
    if (!cursor) break;
  }
  assert(collectedIds.size >= 3, 'Expected to collect all 3 mason workers');
  console.log('PASS: 6. Pagination walk with limit 2 visited each worker without duplicates');

  // Check /workers/:id
  const viewerProfile = await apiRequest(`/api/v1/workers/${workers[0].id}`, {
    headers: { 'Authorization': `Bearer ${custToken}` }
  });
  assert(viewerProfile.status === 200, 'Worker viewer profile failed');
  assertNoSecrets(viewerProfile.data);
  assert(viewerProfile.data.data.worker.bio, 'Bio should be present');
  console.log('PASS: 7. GET /workers/:id returns viewer profile with no phone or email');

  // 4. Fair Rate Compass check
  const compassRes = await apiRequest('/api/v1/compass?skill=electrician&localityKey=edapally&rate=150', {
    headers: { 'Authorization': `Bearer ${custToken}` }
  });
  assert(compassRes.status === 200, 'Compass query failed');
  assertNoSecrets(compassRes.data);
  assert(compassRes.data.data.note === 'Based on sample rates for now', 'Expected sample note');
  console.log(`PASS: 8. GET /compass returns sample baseline note ("${compassRes.data.data.note}")`);

  // 5. Customer posts a job and prints Fair Price hint
  const tomorrowDaytime = new Date();
  tomorrowDaytime.setUTCDate(tomorrowDaytime.getUTCDate() + 1);
  tomorrowDaytime.setUTCHours(4, 30, 0, 0); // 10:00 AM IST
  const startAt = tomorrowDaytime.toISOString();
  const postJob = await apiRequest('/api/v1/jobs', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${custToken}` },
    body: JSON.stringify({
      skill: 'mason',
      workersNeeded: 2,
      hours: 4,
      startAt,
      offeredRate: 175,
      description: 'Masonry brickwork in backyard'
    })
  });
  assert(postJob.status === 201, `Job post failed: ${JSON.stringify(postJob.data)}`);
  assertNoSecrets(postJob.data);
  const jobId = postJob.data.data.job.id;
  const hint = postJob.data.data.job.fairRate;
  console.log(`PASS: 9. Customer posted job with Fair Price hint (label: ${hint.label}, p25: ${hint.p25}, p75: ${hint.p75})`);

  // 6. Matching worker sees job, wrong-skill worker does not
  const masonWorker = workers.find(w => w.skill === 'mason');
  const elecWorker = workers.find(w => w.skill === 'electrician');

  const masonJobs = await apiRequest('/api/v1/jobs', {
    headers: { 'Authorization': `Bearer ${masonWorker.token}` }
  });
  assert(masonJobs.status === 200, 'Mason GET /jobs failed');
  assertNoSecrets(masonJobs.data);
  assert(masonJobs.data.data.jobs.some(j => j.id === jobId), 'Mason should see the posted job');

  const elecJobs = await apiRequest('/api/v1/jobs', {
    headers: { 'Authorization': `Bearer ${elecWorker.token}` }
  });
  assert(elecJobs.status === 200, 'Electrician GET /jobs failed');
  assert(!elecJobs.data.data.jobs.some(j => j.id === jobId), 'Electrician should NOT see mason job');
  console.log('PASS: 10. Matching worker sees job; wrong-skill worker does not');

  // 7. Parallel accepts on 2-slot job with 3 workers (Expect 2 OK and 1 JOB_FULL)
  const masonWorkers = workers.filter(w => w.skill === 'mason');
  assert(masonWorkers.length >= 3, 'Need 3 masons for parallel accept test');

  const acceptPromises = masonWorkers.slice(0, 3).map(w =>
    apiRequest(`/api/v1/jobs/${jobId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${w.token}` }
    })
  );
  const acceptResults = await Promise.all(acceptPromises);
  const acceptStatuses = acceptResults.map(r => r.status);
  const oks = acceptStatuses.filter(s => s === 200).length;
  const fulls = acceptStatuses.filter(s => s === 409).length;

  assert(oks === 2, `Expected 2 OKs, got ${oks}`);
  assert(fulls === 1, `Expected 1 JOB_FULL, got ${fulls}`);
  console.log('PASS: 11. Three workers accept 2-slot job in parallel -> Exactly 2 OK (status: 200) and 1 JOB_FULL (status: 409)');

  // 8. Idempotent replay returns same body and header
  const idemKey = `idem_script_${crypto.randomBytes(4).toString('hex')}`;
  const cancel1 = await apiRequest(`/api/v1/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${custToken}`,
      'Idempotency-Key': idemKey
    }
  });
  assert(cancel1.status === 200, 'First cancel failed');

  const cancel2 = await apiRequest(`/api/v1/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${custToken}`,
      'Idempotency-Key': idemKey
    }
  });
  assert(cancel2.status === 200, 'Idempotent replay cancel failed');
  assert(cancel2.headers.get('idempotent-replay') === 'true', 'Expected Idempotent-Replay: true header');
  assert(cancel1.data.data.status === cancel2.data.data.status, 'Replay body status must match');
  console.log('PASS: 12. Idempotent replay returns same body with Idempotent-Replay: true header');

  // Repeating cancel is safe
  const cancel3 = await apiRequest(`/api/v1/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${custToken}` }
  });
  assert(cancel3.status === 200, 'Repeating cancel without idempotency key failed');
  console.log('PASS: 13. Customer cancelled job and repeating cancel is safe');

  console.log('\nNOTICE: Rating-based checks are covered only by automated tests (the API cannot set ratings yet).');
  console.log('----------------------------------------------------');
  console.log('All B4 script checks passed successfully!');
}

main().catch(err => {
  console.error('\n' + err.message);
  process.exit(1);
});
