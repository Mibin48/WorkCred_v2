import crypto from 'node:crypto';

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:4000';

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
  console.log(`[b5-check.js] Connecting to local server at ${BASE_URL}...`);

  // Refuse non-localhost hosts
  const parsed = new URL(BASE_URL);
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    console.error('ERROR: b5-check.js refuses to run on non-localhost hosts.');
    process.exit(1);
  }

  // 1. Health check
  const health = await apiRequest('/api/v1/health');
  assert(health.status === 200, `Health check failed with status ${health.status}`);
  console.log('PASS: 1. Server Health Check (status: 200)');

  // 2. Create customer and worker with complete profiles
  const rand = crypto.randomBytes(4).toString('hex');
  const custEmail = `cust_b5_${rand}@example.com`;
  const workEmail = `work_b5_${rand}@example.com`;

  const custSignup = await apiRequest('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'customer',
      name: 'Ananya Ramesh',
      email: custEmail,
      phone: '9845112233',
      password: 'StrongPassword123#Cust'
    })
  });
  assert(custSignup.status === 201, `Customer signup failed: ${JSON.stringify(custSignup.data)}`);
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
      name: 'Suresh Kumar',
      email: workEmail,
      phone: '9845998877',
      password: 'StrongPassword123#Work'
    })
  });
  assert(workSignup.status === 201, `Worker signup failed: ${JSON.stringify(workSignup.data)}`);
  const workToken = workSignup.data.data.accessToken;
  const workerId = workSignup.data.data.user.id;

  const workPatch = await apiRequest('/api/v1/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({
      localityKey: 'kakkanad',
      skills: [{ skill: 'electrician', isMain: true }],
      hourlyRate: 400,
      radiusKm: 10,
      bio: 'Licensed electrician with 10 years experience.'
    })
  });
  assert(workPatch.status === 200, `Worker profile PATCH failed: ${JSON.stringify(workPatch.data)}`);
  assert(workPatch.data.data.user.profileComplete === true, 'Worker profile must be complete');
  console.log('PASS: 2. Customer and Worker created with complete profiles');

  // 3. Direct booking (scheduled 20 minutes ahead to enter 60-min window)
  const schedTime = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const idempKey1 = `idemp-b5-${rand}-1`;
  const bookRes1 = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${custToken}`,
      'Idempotency-Key': idempKey1
    },
    body: JSON.stringify({
      workerId,
      scheduledAt: schedTime,
      hours: 1,
      note: 'Main distribution board check'
    })
  });
  assert(bookRes1.status === 201, `Booking 1 failed: ${JSON.stringify(bookRes1.data)}`);
  const booking1 = bookRes1.data.data.booking;
  assert(booking1.status === 'pending', 'Booking 1 status must be pending');
  console.log('PASS: 3. Direct booking created in status pending');

  // 4. Same Idempotency-Key replay returns the same booking
  const replayRes = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${custToken}`,
      'Idempotency-Key': idempKey1
    },
    body: JSON.stringify({
      workerId,
      scheduledAt: schedTime,
      hours: 1,
      note: 'Main distribution board check'
    })
  });
  assert(replayRes.status === 201, 'Replay failed status');
  assert(replayRes.headers.get('idempotent-replay') === 'true', 'Expected Idempotent-Replay header');
  assert(replayRes.data.data.booking.id === booking1.id, 'Replay booking id mismatch');
  console.log('PASS: 4. Idempotent replay verified with Idempotent-Replay header');

  // 5. Overlapping booking at same time is refused (409 TIME_CLASH)
  const overlapRes = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${custToken}`,
      'Idempotency-Key': `idemp-b5-${rand}-overlap`
    },
    body: JSON.stringify({
      workerId,
      scheduledAt: schedTime,
      hours: 1
    })
  });
  assert(overlapRes.status === 409, `Expected 409 for overlap, got ${overlapRes.status}`);
  assert(overlapRes.data?.error?.code === 'TIME_CLASH', 'Expected TIME_CLASH code');
  console.log('PASS: 5. Overlapping booking refused with 409 TIME_CLASH');

  // 6. Before confirm check: worker's detail has no phone and customer cannot see phone
  const detailPendingCust = await apiRequest(`/api/v1/bookings/${booking1.id}`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  const detailPendingWork = await apiRequest(`/api/v1/bookings/${booking1.id}`, {
    headers: { Authorization: `Bearer ${workToken}` }
  });
  assert(detailPendingCust.data.data.booking.contact === null, 'Customer should not see contact while pending');
  assert(detailPendingWork.data.data.booking.contact === null, 'Worker should not see contact while pending');
  assert(!detailPendingWork.data.data.booking.jobLocation, 'Worker should not see jobLocation while pending');
  console.log('PASS: 6. Pre-confirmation privacy verified: no phone or jobLocation');

  // 7. Worker confirms
  const confirmRes = await apiRequest(`/api/v1/bookings/${booking1.id}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` }
  });
  assert(confirmRes.status === 200, `Confirm failed: ${JSON.stringify(confirmRes.data)}`);
  console.log('PASS: 7. Worker confirmed booking');

  // 8. Post-confirm check: both see phone, only worker sees jobLocation, customer codes works with no-store
  const detailConfCust = await apiRequest(`/api/v1/bookings/${booking1.id}`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  const detailConfWork = await apiRequest(`/api/v1/bookings/${booking1.id}`, {
    headers: { Authorization: `Bearer ${workToken}` }
  });
  assert(detailConfCust.data.data.booking.contact?.phone, 'Customer must see worker phone');
  assert(!detailConfCust.data.data.booking.jobLocation, 'Customer must not see jobLocation');
  assert(detailConfWork.data.data.booking.contact?.phone, 'Worker must see customer phone');
  assert(detailConfWork.data.data.booking.jobLocation?.lat, 'Worker must see jobLocation');

  const workCodesRes = await apiRequest(`/api/v1/bookings/${booking1.id}/codes`, {
    headers: { Authorization: `Bearer ${workToken}` }
  });
  assert(workCodesRes.status === 404, 'Worker must be refused access to codes (404)');

  const custCodesRes = await apiRequest(`/api/v1/bookings/${booking1.id}/codes`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(custCodesRes.status === 200, 'Customer codes fetch failed');
  assert(custCodesRes.headers.get('cache-control')?.includes('no-store'), 'Expected Cache-Control: no-store');
  const { startCode, finishCode } = custCodesRes.data.data;
  assert(/^\d{4}$/.test(startCode), 'Invalid startCode');
  assert(/^\d{4}$/.test(finishCode), 'Invalid finishCode');
  console.log('PASS: 8. Post-confirmation contact release & code security verified');

  // 9. Worker starts with 2 wrong codes (prints attemptsLeft) then right one
  const wrongStart1 = await apiRequest(`/api/v1/bookings/${booking1.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ code: '0000' })
  });
  assert(wrongStart1.status === 400 && wrongStart1.data?.error?.code === 'WRONG_CODE');
  console.log(`   [Attempt 1] WRONG_CODE -> attemptsLeft: ${wrongStart1.data.error.attemptsLeft}`);

  const wrongStart2 = await apiRequest(`/api/v1/bookings/${booking1.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ code: '1111' })
  });
  assert(wrongStart2.status === 400 && wrongStart2.data?.error?.code === 'WRONG_CODE');
  console.log(`   [Attempt 2] WRONG_CODE -> attemptsLeft: ${wrongStart2.data.error.attemptsLeft}`);

  const rightStart = await apiRequest(`/api/v1/bookings/${booking1.id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ code: startCode })
  });
  assert(rightStart.status === 200, `Right start code failed: ${JSON.stringify(rightStart.data)}`);
  assert(rightStart.data.data.booking.status === 'in_progress');
  console.log('PASS: 9. Start handshake: wrong guesses counted, right code started booking');

  // 10. Customer finishes with 1 wrong code, then right one with paidCash and rating 5
  const wrongFin = await apiRequest(`/api/v1/bookings/${booking1.id}/finish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({ finishCode: '9999', paidCash: true, rating: 5 })
  });
  assert(wrongFin.status === 400 && wrongFin.data?.error?.code === 'WRONG_CODE');
  console.log(`   [Finish Attempt 1] WRONG_CODE -> attemptsLeft: ${wrongFin.data.error.attemptsLeft}`);

  const rightFin = await apiRequest(`/api/v1/bookings/${booking1.id}/finish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({
      finishCode,
      paidCash: true,
      rating: 5,
      comment: 'Excellent work, very professional!'
    })
  });
  assert(rightFin.status === 200, `Right finish code failed: ${JSON.stringify(rightFin.data)}`);
  const receipt = rightFin.data.data.receipt;
  console.log('PASS: 10. Finish handshake: wrong code counted, right code finished booking');

  // 11. Print receipt and verify fields
  console.log('   --- Booking Receipt ---');
  console.log(`   Record ID:   ${receipt.recordId}`);
  console.log(`   Skill:       ${receipt.skill}`);
  console.log(`   Rate:        ₹${receipt.agreedRate}/hr`);
  console.log(`   Booked Hrs:  ${receipt.bookedHours}`);
  console.log(`   Worked Hrs:  ${receipt.hoursWorked}`);
  console.log(`   Cash Paid:   ₹${receipt.cashAmount}`);
  console.log(`   Note:        ${receipt.paymentNote}`);
  console.log(`   Rating:      ${receipt.rating}/5`);
  console.log('   -----------------------');
  assert(receipt.paymentNote === 'Cash payment reported by customer');
  assert(receipt.cashAmount === receipt.agreedRate * receipt.bookedHours);
  console.log('PASS: 11. Receipt verified: cash payment reported by customer');

  // 12. Passport shows 1 record and verify says valid
  const pass1 = await apiRequest(`/api/v1/workers/${workerId}/passport`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(pass1.status === 200 && pass1.data.data.entries.length === 1);
  const verify1 = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(verify1.status === 200 && verify1.data.data.status === 'valid' && verify1.data.data.records === 1);
  console.log('PASS: 12. Passport verified: 1 record, status valid');

  // 13. Second booking and finish to show 2 records valid
  // Booking 1 was scheduled at T + 20 min for 1h, so it finishes by T + 80 min nominally,
  // but since booking 1 is already completed at step 10, the slot is freed up once completed.
  // We schedule at T + 35 min (inside the 60-min window for startBooking).
  // Note: completed bookings do not block new bookings in overlappingQuery!
  const schedTime2 = new Date(Date.now() + 35 * 60 * 1000).toISOString();
  const bookRes2 = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${custToken}`,
      'Idempotency-Key': `idemp-b5-${rand}-2`
    },
    body: JSON.stringify({
      workerId,
      scheduledAt: schedTime2,
      hours: 1
    })
  });
  assert(bookRes2.status === 201, `Booking 2 creation failed: ${JSON.stringify(bookRes2.data)}`);
  const b2Id = bookRes2.data.data.booking.id;
  await apiRequest(`/api/v1/bookings/${b2Id}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` }
  });
  const codes2 = (await apiRequest(`/api/v1/bookings/${b2Id}/codes`, {
    headers: { Authorization: `Bearer ${custToken}` }
  })).data.data;
  await apiRequest(`/api/v1/bookings/${b2Id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ code: codes2.startCode })
  });
  await apiRequest(`/api/v1/bookings/${b2Id}/finish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${custToken}` },
    body: JSON.stringify({ finishCode: codes2.finishCode, paidCash: true, rating: 5 })
  });

  const verify2 = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(verify2.status === 200 && verify2.data.data.status === 'valid' && verify2.data.data.records === 2);
  console.log('PASS: 13. Second booking finished: 2 records, chain valid');

  // 14. Toggle the first record hidden and show viewer count drops while verify stays valid
  const patchHide = await apiRequest(`/api/v1/passport/entries/${receipt.recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ visible: false })
  });
  assert(patchHide.status === 200);

  const passAfterHide = await apiRequest(`/api/v1/workers/${workerId}/passport`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(passAfterHide.data.data.entries.length === 1, 'Viewer entries count should drop to 1');
  assert(passAfterHide.data.data.privateIncludedCount === 1, 'privateIncludedCount should be 1');

  const verifyAfterHide = await apiRequest(`/api/v1/workers/${workerId}/passport/verify`, {
    headers: { Authorization: `Bearer ${custToken}` }
  });
  assert(verifyAfterHide.data.data.status === 'valid', 'Chain should remain valid when an entry is hidden');
  console.log('PASS: 14. Visibility toggled: viewer count drops to 1, verify stays valid');

  // 15. Lockout step on a 3rd booking: 6 wrong start codes show attemptsLeft down to 0 then CODE_LOCKED
  const schedTime3 = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const bookRes3 = await apiRequest('/api/v1/bookings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${custToken}`,
      'Idempotency-Key': `idemp-b5-${rand}-3`
    },
    body: JSON.stringify({
      workerId,
      scheduledAt: schedTime3,
      hours: 1
    })
  });
  const b3Id = bookRes3.data.data.booking.id;
  await apiRequest(`/api/v1/bookings/${b3Id}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` }
  });

  for (let i = 1; i <= 5; i++) {
    const r = await apiRequest(`/api/v1/bookings/${b3Id}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workToken}` },
      body: JSON.stringify({ code: '0000' })
    });
    const attemptsRemaining = 5 - i;
    if (i < 5) {
      assert(r.status === 400 && r.data?.error?.code === 'WRONG_CODE');
      console.log(`   [Lockout check ${i}] wrong code -> attemptsLeft: ${r.data.error.attemptsLeft}`);
    } else {
      assert(r.status === 429 && r.data?.error?.code === 'CODE_LOCKED');
      console.log('   [Lockout check 5] 5th wrong code -> locked 10 minutes (status 429)');
    }
  }

  const sixth = await apiRequest(`/api/v1/bookings/${b3Id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${workToken}` },
    body: JSON.stringify({ code: '0000' })
  });
  assert(sixth.status === 429 && sixth.data?.error?.code === 'CODE_LOCKED');
  console.log('   [Lockout check 6] 6th attempt refused with 429 CODE_LOCKED');
  console.log('PASS: 15. Lockout verified: 5 wrong attempts lock booking, 6th returns 429 CODE_LOCKED');

  console.log('\nALL B5 MANUAL CHECKS PASSED.');
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
