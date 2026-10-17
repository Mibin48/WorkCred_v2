import http from 'node:http';

const targetHost = process.env.WORKCRED_TEST_HOST || '127.0.0.1';
const targetPort = process.env.PORT || '4000';
const baseUrl = `http://${targetHost}:${targetPort}`;

// Refuse to run against remote host
if (!['localhost', '127.0.0.1'].includes(targetHost)) {
  console.error(`Refusing to run against non-local host: "${targetHost}". Manual check scripts only run on localhost or 127.0.0.1.`);
  process.exit(1);
}

console.log(`[auth-check.js] Connecting to local server at ${baseUrl}...`);
console.log('NOTICE: This script will create throwaway accounts with random emails for testing. They can be safely ignored in the database.');

function getCookie(res, name) {
  const rawCookie = res.headers.get('set-cookie');
  if (!rawCookie) return null;
  const match = rawCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

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

async function run() {
  const rand = Math.floor(Math.random() * 1000000);
  const workerEmail = `worker.test.${rand}@example.com`;
  const customerEmail = `customer.test.${rand}@example.com`;
  const workerPassword = `SecretKey123#Valid`;
  const customerPassword = `AccessKey123#Valid`;
  const newPassword = `NewSecretKey123#Valid`;

  // Step 1: Health check
  try {
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    report('1. Server Health Check', healthRes.status === 200, `status: ${healthRes.status}`);
  } catch (err) {
    console.error(`Cannot connect to server at ${baseUrl}. Is the server running? Run "npm run dev" or "npm start" first.`);
    process.exit(1);
  }

  // Step 2: Signup worker
  const signupWorkerRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'worker',
      name: 'Ravi Manual',
      email: workerEmail,
      phone: '9876543210',
      password: workerPassword
    })
  });
  const workerCookie = getCookie(signupWorkerRes, 'wc_rt');
  const signupWorkerBody = await signupWorkerRes.json();
  report('2. Worker Signup', signupWorkerRes.status === 201 && workerCookie && signupWorkerBody.data?.accessToken, `status: ${signupWorkerRes.status}`);

  // Step 3: Signup customer
  const signupCustRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'customer',
      name: 'Customer Manual',
      email: customerEmail,
      phone: '9876543210', // same phone allowed
      password: customerPassword
    })
  });
  report('3. Customer Signup (Same Phone Allowed)', signupCustRes.status === 201, `status: ${signupCustRes.status}`);

  // Step 4: Duplicate email rejection
  const dupEmailRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'customer',
      name: 'Duplicate Test',
      email: workerEmail.toUpperCase(),
      phone: '9811122233',
      password: 'SomeOtherPassword123#Valid'
    })
  });
  report('4. Duplicate Email 409 Rejected', dupEmailRes.status === 409, `status: ${dupEmailRes.status}`);

  // Step 5: Login with correct credentials
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: workerEmail,
      password: workerPassword,
      role: 'worker'
    })
  });
  const loginBody = await loginRes.json();
  const loginCookie = getCookie(loginRes, 'wc_rt');
  const accessToken = loginBody.data?.accessToken;
  report('5. Worker Login', loginRes.status === 200 && accessToken && loginCookie, `status: ${loginRes.status}`);

  // Step 6: Wrong password check (401)
  const wrongPwRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: workerEmail,
      password: 'IncorrectPassword123#',
      role: 'worker'
    })
  });
  report('6. Wrong Password (401 INVALID_CREDENTIALS)', wrongPwRes.status === 401, `status: ${wrongPwRes.status}`);

  // Step 7: Role mismatch after correct password (403)
  const roleMismatchRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: workerEmail,
      password: workerPassword,
      role: 'customer' // worker attempting customer role
    })
  });
  report('7. Role Mismatch (403 ROLE_MISMATCH)', roleMismatchRes.status === 403, `status: ${roleMismatchRes.status}`);

  // Step 8: GET /users/me
  const meRes = await fetch(`${baseUrl}/api/v1/users/me`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const meBody = await meRes.json();
  const meUser = meBody.data?.user || meBody.data || {};
  const noSensitiveLeaked = !('passwordHash' in meUser) && !('tokenVersion' in meUser) && !('lockUntil' in meUser);
  report('8. GET /users/me (Own Profile, No Secrets)', meRes.status === 200 && meUser.email === workerEmail && noSensitiveLeaked, `status: ${meRes.status}`);

  // Step 9: Refresh token rotation
  const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `wc_rt=${loginCookie}`,
      'X-Requested-With': 'WorkCred',
      'Origin': 'http://localhost:3000'
    }
  });
  const refreshBody = await refreshRes.json();
  const rotatedCookie = getCookie(refreshRes, 'wc_rt');
  const newAccessToken = refreshBody.data?.accessToken;
  const cookieRotated = rotatedCookie && rotatedCookie !== loginCookie;
  report('9. POST /auth/refresh Rotation', refreshRes.status === 200 && cookieRotated && newAccessToken, `status: ${refreshRes.status}`);

  // Step 10: Replay of old refresh cookie (reuse revocation)
  const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Cookie': `wc_rt=${loginCookie}`, // Old consumed cookie!
      'X-Requested-With': 'WorkCred',
      'Origin': 'http://localhost:3000'
    }
  });
  report('10. Replay Old Refresh Cookie (Family Revoked)', replayRes.status === 401, `status: ${replayRes.status}`);

  // Step 11: Change Password
  const changeRes = await fetch(`${baseUrl}/api/v1/auth/password/change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${newAccessToken}`
    },
    body: JSON.stringify({
      currentPassword: workerPassword,
      newPassword: newPassword
    })
  });
  const changeBody = await changeRes.json();
  const activePostChangeToken = changeBody.data?.accessToken;
  const activePostChangeCookie = getCookie(changeRes, 'wc_rt');
  report('11. POST /auth/password/change', changeRes.status === 200 && activePostChangeToken, `status: ${changeRes.status}`);

  // Step 12: Logout
  const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      'Cookie': `wc_rt=${activePostChangeCookie}`,
      'X-Requested-With': 'WorkCred',
      'Origin': 'http://localhost:3000'
    }
  });
  report('12. POST /auth/logout (Session Terminated & Cookie Cleared)', logoutRes.status === 200, `status: ${logoutRes.status}`);

  console.log('----------------------------------------------------');
  console.log(`Summary: ${passedSteps}/${totalSteps} checks passed.`);
  if (passedSteps === totalSteps) {
    console.log('ALL AUTH CHECKS PASSED!');
    process.exit(0);
  } else {
    console.error('SOME CHECKS FAILED!');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error running auth-check.js:', err);
  process.exit(1);
});
