const targetHost = process.env.WORKCRED_TEST_HOST || '127.0.0.1';
const targetPort = process.env.PORT || '4000';
const baseUrl = `http://${targetHost}:${targetPort}`;

// Refuse to run against remote host
if (!['localhost', '127.0.0.1'].includes(targetHost)) {
  console.error(`Refusing to run against non-local host: "${targetHost}". Manual check scripts only run on localhost or 127.0.0.1.`);
  process.exit(1);
}

console.log(`[login-attack.js] Connecting to local server at ${baseUrl}...`);
console.log('NOTICE: This script tests brute-force account lockout with a throwaway random account.');

async function run() {
  const rand = Math.floor(Math.random() * 1000000);
  const email = `attack.target.${rand}@example.com`;
  const correctPassword = `LockoutSecret987#Valid`;

  // Step 1: Health check
  try {
    const health = await fetch(`${baseUrl}/api/v1/health`);
    if (health.status !== 200) {
      console.error(`Server at ${baseUrl} is not healthy (status ${health.status}).`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot connect to server at ${baseUrl}. Please start the server first ("npm start" or "npm run dev").`);
    process.exit(1);
  }

  // Step 2: Register throwaway account
  const signupRes = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'worker',
      name: 'Attack Target',
      email,
      phone: '9899988877',
      password: correctPassword
    })
  });

  if (signupRes.status !== 201) {
    console.error('Failed to create throwaway account:', await signupRes.text());
    process.exit(1);
  }
  console.log(`Created throwaway account: ${email}`);
  console.log('Beginning password attack (12 wrong attempts)...');

  const statuses = [];

  for (let attempt = 1; attempt <= 12; attempt++) {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: `WrongPasswordTry#${attempt}`,
        role: 'worker'
      })
    });

    statuses.push(res.status);
    const body = await res.json();
    const code = body.error?.code || 'OK';
    const message = body.error?.message || '';
    console.log(`Attempt #${attempt}: HTTP ${res.status} [${code}] - ${message}`);
  }

  console.log('----------------------------------------------------');
  console.log('Status sequence:', statuses.join(' -> '));

  // Verify expectations:
  // Attempts 1 to 4 should be 401
  const firstFour = statuses.slice(0, 4);
  const fromFifth = statuses.slice(4);

  const firstFourAll401 = firstFour.every(s => s === 401);
  const fromFifthAll429 = fromFifth.every(s => s === 429);

  if (firstFourAll401 && fromFifthAll429) {
    console.log('PASS: Exact lockout sequence verified (401 four times, then 429 from fifth attempt onwards).');
  } else {
    console.error(`FAIL: Sequence did not match expected pattern. First 4: [${firstFour}], Remainder: [${fromFifth}]`);
  }

  // Step 3: Verify the right password is STILL refused while locked
  console.log('Testing login with the CORRECT password while account is locked...');
  const rightPwRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: correctPassword,
      role: 'worker'
    })
  });

  const rightPwBody = await rightPwRes.json();
  if (rightPwRes.status === 429 && rightPwBody.error?.code === 'ACCOUNT_LOCKED') {
    console.log(`PASS: Correct password was blocked with 429 ACCOUNT_LOCKED: "${rightPwBody.error.message}"`);
  } else {
    console.error(`FAIL: Expected 429 ACCOUNT_LOCKED with correct password, got ${rightPwRes.status}:`, rightPwBody);
    process.exit(1);
  }

  console.log('----------------------------------------------------');
  console.log('ALL LOGIN ATTACK LOCKOUT CHECKS PASSED!');
}

run().catch((err) => {
  console.error('Fatal error in login-attack.js:', err);
  process.exit(1);
});
