import crypto from 'node:crypto';

/**
 * Scrypt configuration parameters
 * N: CPU/memory cost parameter (must be power of 2)
 * r: block size parameter
 * p: parallelization parameter
 * maxmem: maximum memory in bytes (32MB is safe and sufficient)
 */
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024
};

const KEY_LEN = 64; // 64 bytes derived key length
const SALT_LEN = 16; // 16 bytes per-user salt

/**
 * Concurrency limiter for scrypt operations to protect Node event loop and memory
 */
class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.current++;
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Concurrency cap on scrypt hashing (max 4 concurrent hash jobs)
const scryptSemaphore = new Semaphore(4);

/**
 * Derives a scrypt key buffer asynchronously.
 * @param {string} password 
 * @param {Buffer} salt 
 * @returns {Promise<Buffer>}
 */
function deriveKey(password, salt) {
  return scryptSemaphore.run(() => {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, KEY_LEN, SCRYPT_OPTIONS, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(derivedKey);
      });
    });
  });
}

/**
 * Hashes a password with scrypt and a random 16-byte per-user salt.
 * Format: scrypt$<saltHex>$<derivedKeyHex>
 * 
 * @param {string} password 
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password must be a non-empty string');
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Constant-time password verification using crypto.timingSafeEqual.
 * 
 * @param {string} password Candidate plain password
 * @param {string} storedHash Stored scrypt string: scrypt$<saltHex>$<derivedKeyHex>
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(hashHex, 'hex');

  if (salt.length !== SALT_LEN || expectedKey.length !== KEY_LEN) {
    return false;
  }

  try {
    const derivedKey = await deriveKey(password, salt);
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

// Pre-computed dummy hash with valid scrypt structure for constant-time dummy comparisons
const DUMMY_SALT = crypto.randomBytes(SALT_LEN);
const DUMMY_KEY = crypto.randomBytes(KEY_LEN);
const DUMMY_HASH = `scrypt$${DUMMY_SALT.toString('hex')}$${DUMMY_KEY.toString('hex')}`;

/**
 * Runs a dummy scrypt verification against a fixed hash to ensure uniform execution timing
 * when a non-existent email is targeted during login.
 * 
 * @param {string} password 
 * @returns {Promise<boolean>} Always returns false
 */
export async function dummyVerifyPassword(password) {
  await verifyPassword(password || 'dummy-password-check', DUMMY_HASH);
  return false;
}
