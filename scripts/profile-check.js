import { assertNoSensitiveFields } from '../backend/tests/helpers/privacyScanner.js';

const targetHost = process.env.WORKCRED_TEST_HOST || '127.0.0.1';
const targetPort = process.env.PORT || '4000';
const baseUrl = `http://${targetHost}:${targetPort}`;

// Refuse to run against remote host
if (!['localhost', '127.0.0.1'].includes(targetHost)) {
  console.error(`Refusing to run against non-local host: "${targetHost}". Manual check scripts only run on localhost or 127.0.0.1.`);
  process.exit(1);
}

console.log(`[profile-check.js] Connecting to local server at ${baseUrl}...`);
console.log('NOTICE: This script tests B3 profile editing, completeness, calendar, location privacy, and signed uploads.');

let passedSteps = 0;
let totalSteps = 0;

function report(stepName, ok, details = '') {
  totalSteps++;
  if (ok) {
    passedSteps++;
    console.log(`PASS: ${stepName} ${details ? `(${details})` : ''}`);
  } else {
    console.error(`FAIL: ${stepName} ${details ? `(${details})` : ''}`);
  }
}

function skip(stepName, reason = '') {
  console.log(`SKIPPED: ${stepName} ${reason ? `(${reason})` : ''}`);
}

async function run() {
  const rand = Math.floor(Math.random() * 1000000);
  const workerEmail = `worker.profile.${rand}@example.com`;
  const customerEmail = `customer.profile.${rand}@example.com`;
  const workerPassword = 'K8#mQ2$vL9!pX5*jW4';
  const customerPassword = 'M7!xW3$vK9#pL4*jZ2';

  // Step 1: Health check
  try {
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    report('1. Server Health Check', healthRes.status === 200, `status: ${healthRes.status}`);
  } catch (err) {
    console.error(`Cannot connect to server at ${baseUrl}. Is the server running? Start backend server first.`);
    process.exit(1);
  }

  // Step 2: Signup worker and customer
  let workerToken, workerUser;
  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'worker',
        name: 'Suresh Manual',
        email: workerEmail,
        phone: '9845012345',
        password: workerPassword
      })
    });
    const data = await res.json();
    report('2. Worker Signup', res.status === 201 && data.data?.accessToken, `status: ${res.status}`);
    workerToken = data.data.accessToken;
    workerUser = data.data.user;
    console.log(`   [Worker ID: ${workerUser.id}, Token: ${workerToken}]`);
  } catch (err) {
    report('2. Worker Signup', false, err.message);
  }

  let customerToken, customerUser;
  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'customer',
        name: 'Anjali Manual',
        email: customerEmail,
        phone: '9845054321',
        password: customerPassword
      })
    });
    const data = await res.json();
    report('3. Customer Signup', res.status === 201 && data.data?.accessToken, `status: ${res.status}`);
    customerToken = data.data.accessToken;
    customerUser = data.data.user;
  } catch (err) {
    report('3. Customer Signup', false, err.message);
  }

  // Step 4: GET /meta (logged in)
  try {
    const res = await fetch(`${baseUrl}/api/v1/meta`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    const data = await res.json();
    const hasSkills = Array.isArray(data.data?.skills) && data.data.skills.includes('electrician');
    const hasLocalities = Array.isArray(data.data?.localities) && data.data.localities.length > 0;
    const noCoordsInLocalities = data.data?.localities.every(l => l.lat === undefined && l.lng === undefined);
    report('4. GET /meta returns sanitized localities & skills', res.status === 200 && hasSkills && hasLocalities && noCoordsInLocalities, `status: ${res.status}`);
  } catch (err) {
    report('4. GET /meta returns sanitized localities & skills', false, err.message);
  }

  // Step 5: Check initial profile completeness (false for both)
  try {
    const resW = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${workerToken}` }
    });
    const dataW = await resW.json();
    const wInitComplete = dataW.data?.user?.profileComplete;

    const resC = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { 'Authorization': `Bearer ${customerToken}` }
    });
    const dataC = await resC.json();
    const cInitComplete = dataC.data?.user?.profileComplete;

    report('5. Initial profileComplete is false for both', resW.status === 200 && wInitComplete === false && cInitComplete === false, `worker: ${wInitComplete}, customer: ${cInitComplete}`);
  } catch (err) {
    report('5. Initial profileComplete is false for both', false, err.message);
  }

  // Step 6: Step-by-step worker profile completion
  try {
    // 6a: Add skills & rates (still missing localityKey & radiusKm)
    let res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        skills: [{ skill: 'electrician', isMain: true }],
        hourlyRate: 400
      })
    });
    let data = await res.json();
    const stepA_Ok = res.status === 200 && data.data?.user?.profileComplete === false;

    // 6b: Add localityKey & radiusKm -> completeness flips to true!
    res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localityKey: 'kakkanad',
        radiusKm: 6
      })
    });
    data = await res.json();
    const stepB_Ok = res.status === 200 && data.data?.user?.profileComplete === true;

    report('6. Worker profileCompleteness transitions from false to true', stepA_Ok && stepB_Ok, `stepA profileComplete: ${stepA_Ok}, stepB profileComplete: ${stepB_Ok}`);
  } catch (err) {
    report('6. Worker profileCompleteness transitions from false to true', false, err.message);
  }

  // Step 7: Customer completeness transitions from false to true
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localityKey: 'edappally'
      })
    });
    const data = await res.json();
    report('7. Customer profileCompleteness transitions to true on localityKey', res.status === 200 && data.data?.user?.profileComplete === true, `status: ${res.status}`);
  } catch (err) {
    report('7. Customer profileCompleteness transitions to true on localityKey', false, err.message);
  }

  // Step 8: Mass assignment & role validation
  try {
    // Forbidden field
    const res1 = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'customer' })
    });
    const data1 = await res1.json();
    const forbiddenOk = res1.status === 400 && data1.error?.code === 'FORBIDDEN_FIELD';

    // Customer sending worker field
    const res2 = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ hourlyRate: 500 })
    });
    const data2 = await res2.json();
    const roleMismatchOk = res2.status === 400 && data2.error?.code === 'FIELD_NOT_ALLOWED_FOR_ROLE';

    report('8. Rejects forbidden field and customer worker-field', forbiddenOk && roleMismatchOk, `forbidden: ${res1.status}, roleMismatch: ${res2.status}`);
  } catch (err) {
    report('8. Rejects forbidden field and customer worker-field', false, err.message);
  }

  // Step 9: Calendar weekly & blocked dates
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendar: {
          weekly: { mon: 'morning', tue: 'afternoon', wed: 'full' },
          blockedDates: [
            { date: '2026-12-15', reason: 'Personal holiday' },
            { date: '2026-11-20', reason: 'Family event' }
          ]
        }
      })
    });
    const data = await res.json();
    const dates = data.data?.user?.calendar?.blockedDates;
    const sortedOk = Array.isArray(dates) && dates[0]?.date === '2026-11-20' && dates[1]?.date === '2026-12-15';
    report('9. Sets calendar & sorts blocked dates', res.status === 200 && sortedOk, `status: ${res.status}`);
  } catch (err) {
    report('9. Sets calendar & sorts blocked dates', false, err.message);
  }

  // Step 10: Location privacy - coordinates are stored but NEVER returned
  try {
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        location: { lat: 10.0159, lng: 76.3419 } // Kakkanad point
      })
    });
    const data = await res.json();
    let hasCoordsLeak = false;
    try {
      assertNoSensitiveFields(data);
    } catch {
      hasCoordsLeak = true;
    }
    const safeLoc = !hasCoordsLeak && data.data?.user?.hasExactLocation === true && data.data?.user?.location === undefined;
    report('10. Location Privacy: Exact coordinates NEVER returned', res.status === 200 && safeLoc, `status: ${res.status}, hasExactLocation: ${data.data?.user?.hasExactLocation}`);
  } catch (err) {
    report('10. Location Privacy: Exact coordinates NEVER returned', false, err.message);
  }

  // Step 11: Upload signing & direct photo upload
  try {
    const signRes = await fetch(`${baseUrl}/api/v1/uploads/sign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${workerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ purpose: 'avatar' })
    });

    if (signRes.status === 503) {
      skip('11. Upload Signing & Photo Upload', 'Cloudinary variables not set on server');
    } else if (signRes.status === 200) {
      const signData = await signRes.json();
      const { uploadUrl, apiKey, timestamp, signature, folder, publicId } = signData.data;

      // Create a 1x1 tiny transparent PNG buffer
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      const formData = new FormData();
      formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'avatar.png');
      formData.append('api_key', apiKey);
      formData.append('timestamp', timestamp);
      formData.append('signature', signature);
      formData.append('folder', folder);
      formData.append('public_id', publicId);

      const cloudUploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });
      const cloudData = await cloudUploadRes.json();

      if (cloudUploadRes.status === 200 && cloudData.secure_url) {
        // Save returned photoUrl to profile
        const patchPhotoRes = await fetch(`${baseUrl}/api/v1/users/me`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${workerToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ photoUrl: cloudData.secure_url })
        });
        const patchPhotoData = await patchPhotoRes.json();
        report('11. Upload Signing & Photo Upload to Cloudinary', patchPhotoRes.status === 200 && patchPhotoData.data?.user?.photoUrl === cloudData.secure_url, `uploaded photoUrl saved`);
      } else {
        const errorMsg = cloudData.error?.message || JSON.stringify(cloudData);
        report('11. Upload Signing & Photo Upload to Cloudinary', false, `Cloudinary upload returned ${cloudUploadRes.status}: ${errorMsg}`);
      }
    } else {
      report('11. Upload Signing & Photo Upload', false, `sign status: ${signRes.status}`);
    }
  } catch (err) {
    report('11. Upload Signing & Photo Upload', false, err.message);
  }

  console.log('----------------------------------------------------');
  console.log(`Summary: ${passedSteps}/${totalSteps} checks passed.`);
  if (passedSteps === totalSteps) {
    console.log('ALL EXECUTED CHECKS PASSED!');
  } else {
    console.error('SOME CHECKS FAILED!');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

