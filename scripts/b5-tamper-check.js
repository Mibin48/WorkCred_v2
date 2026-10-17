import crypto from 'node:crypto';
import mongoose from '../backend/node_modules/mongoose/index.js';

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

async function main() {
  console.log(`[b5-tamper-check.js] Connecting to local server at ${BASE_URL}...`);

  // Refuse non-localhost hosts
  const parsed = new URL(BASE_URL);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    console.error('ERROR: b5-tamper-check.js refuses to run on non-localhost hosts.');
    process.exit(1);
  }

  if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI environment variable is required to run direct DB tamper test.');
    process.exit(1);
  }

  // Connect to DB directly
  await mongoose.connect(MONGODB_URI);
  console.log('[b5-tamper-check.js] Connected to MongoDB.');

  const rand = crypto.randomBytes(4).toString('hex');
  const custEmail = `tamper_cust_${rand}@example.com`;
  const workEmail = `tamper_work_${rand}@example.com`;

  console.log(`[b5-tamper-check.js] Throwaway worker email: ${workEmail} (safe to ignore)`);

  // 1. Create throwaway customer and worker
  const custSignup = await apiRequest('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer',
      name: 'Tamper Customer',
      email: custEmail,
      phone: '9877112233',
      password: 'StrongPassword123#Cust'
    })
  });
  assert(custSignup.status === 201, 'Customer signup failed');
  const custToken = custSignup.data.data.accessToken;

  await apiRequest('/api/v1/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({
      localityKey: 'kakkanad',
      location: { lat: 10.0158, lng: 76.3419 }
    })
  });

  const workSignup = await apiRequest('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'worker',
      name: 'Tamper Worker',
      email: workEmail,
      phone: '9877998877',
      password: 'StrongPassword123#Work'
    })
  });
  assert(workSignup.status === 201, 'Worker signup failed');
  const workToken = workSignup.data.data.accessToken;
  const workerId = workSignup.data.data.user.id;

  const workPatch = await apiRequest('/api/v1/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({
      localityKey: 'kakkanad',
      skills: [{ skill: 'carpenter', isMain: true }],
      hourlyRate: 350,
      radiusKm: 10,
      bio: 'Master carpenter.'
    })
  });
  assert(workPatch.status === 200, `Worker profile PATCH failed: ${JSON.stringify(workPatch.data)}`);
  assert(workPatch.data.data.user.profileComplete === true, 'Worker profile must be complete');

  // 2. Build a 3-record chain via API
  console.log('[b5-tamper-check.js] Creating 3 completed bookings via API...');
  const recordIds = [];

  for (let i = 0; i < 3; i++) {
    const schedTime = new Date(Date.now() + (20 + i * 5) * 60 * 1000).toISOString();
    const bookRes = await apiRequest('/api/v1/bookings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${custToken}`,
        'Idempotency-Key': `tamper-book-${rand}-${i}`
      },
      body: JSON.stringify({
        workerId,
        scheduledAt: schedTime,
        hours: 1
      })
    });
    const bId = bookRes.data.data.booking.id;

    await apiRequest(`/api/v1/bookings/${bId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workToken}` }
    });

    const codes = (await apiRequest(`/api/v1/bookings/${bId}/codes`, {
      headers: { Authorization: `Bearer ${custToken}` }
    })).data.data;

    await apiRequest(`/api/v1/bookings/${bId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workToken}` },
      body: JSON.stringify({ code: codes.startCode })
    });

    const fin = await apiRequest(`/api/v1/bookings/${bId}/finish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        finishCode: codes.finishCode,
        paidCash: true,
        rating: 5,
        comment: `Job ${i + 1} finished nicely`
      })
    });
    recordIds.push(fin.data.data.receipt.recordId);
  }

  // 3. Confirm valid initial chain
  const verify1 = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(verify1.status === 200);
  console.log(`[b5-tamper-check.js] Initial chain verify status: ${verify1.data.data.status} (records: ${verify1.data.data.records})`);
  assert(verify1.data.data.status === 'valid', 'Initial chain must be valid');

  // 4. Directly modify rating of record 2 in MongoDB
  const coll = mongoose.connection.collection('passportentries');
  const targetRecord = await coll.findOne({ recordId: recordIds[1] });
  assert(targetRecord, 'Record 2 not found in DB');

  console.log(`[b5-tamper-check.js] Tampering with record 2 (${recordIds[1]}): changing rating from ${targetRecord.rating} to 1 directly in MongoDB...`);
  await coll.updateOne({ _id: targetRecord._id }, { $set: { rating: 1 } });

  // 5. Verify needs_attention
  const verifyTampered = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  console.log(`[b5-tamper-check.js] Tampered chain verify status: ${verifyTampered.data.data.status}`);
  assert(verifyTampered.data.data.status === 'needs_attention', 'Tampered chain must return needs_attention');

  // 6. Restore original rating directly in MongoDB
  console.log(`[b5-tamper-check.js] Restoring original rating (${targetRecord.rating}) in MongoDB...`);
  await coll.updateOne({ _id: targetRecord._id }, { $set: { rating: targetRecord.rating } });

  // 7. Verify valid again
  const verifyRestored = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  console.log(`[b5-tamper-check.js] Restored chain verify status: ${verifyRestored.data.data.status}`);
  assert(verifyRestored.data.data.status === 'valid', 'Restored chain must return valid');

  await mongoose.disconnect();
  console.log('\nALL TAMPER CHECKS PASSED: [valid -> needs_attention -> valid]');
}

main().catch(async (err) => {
  console.error('\n' + err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
