# Session Summary: Phase B2 (Auth and Sessions - Backend Only)

**Date:** 2026-10-16  
**Phase Completed:** Phase B2 (Authentication, Sessions, Access/Refresh JWT, Passwords & Lockout)  
**Status:** Code Written & Tested (All 110 unit/smoke and 19 integration tests passing; check scripts verified)

---

## 1. What Was Built

### A. Authentication & Session Engine (`backend/src`)
1. **Password Cryptography (`src/utils/passwordCrypto.js`):**
   - Asynchronous `scrypt` hashing with 16-byte random salt, $N=16384, r=8, p=1$, returning `scrypt$<saltHex>$<derivedKeyHex>`.
   - Constant-time verification using `crypto.timingSafeEqual`.
   - Concurrency semaphore (max 4 concurrent hash jobs) to prevent event-loop exhaustion.
   - `dummyVerifyPassword` against a pre-computed hash for constant-time rejection of non-existent emails.
2. **Token & Cookie Cryptography (`src/utils/tokenCrypto.js`):**
   - Access token: short-lived (15 minutes, 900s) HS256 JWT using `jose` library with `sub`, `role`, `tokenVersion`, `sessionId`.
   - Refresh token: 64-character random opaque hex string. Only keyed HMAC-SHA256 (`tokenHash`) with `JWT_REFRESH_SECRET` is stored in MongoDB.
   - Cookie `wc_rt`: `httpOnly: true`, `SameSite: Lax`, `Path: /api/v1/auth`, `Secure: isProduction`, 30-day lifespan with 90-day absolute session maximum.
3. **Audit Logging & Privacy Helpers (`src/utils/auditLogger.js`, `src/utils/userHelpers.js`):**
   - Audit events (`signup`, `login`, `login_failed`, `refresh_reuse`, `password_changed`) logged with IDs and masked emails only. Passwords, tokens, cookies, and request bodies are strictly excluded.
   - `sanitizeUserMe`: returns public fields (`id`, `role`, `name`, `email`, `phone`, `photoUrl`, `profileComplete`, `mustChangePassword`) and excludes all hashes, counters, and lock fields.
   - Lockout schedule: 10m $\rightarrow$ 20m $\rightarrow$ 40m $\rightarrow$ max 60m. Resets upon successful login.
4. **Middleware (`src/middleware/auth.js`):**
   - `requireAuth`: validates Bearer access token, fetches fresh user from MongoDB on every request, and rejects if missing, disabled (`isActive: false` $\rightarrow$ 403 `ACCOUNT_DISABLED`), or if `tokenVersion` differs (`401 SESSION_REVOKED`).
   - `requireRole(...roles)`: returns 403 `FORBIDDEN` if user role does not match.
   - `requireSameApp`: enforces CSRF protection for `/auth/refresh` and `/auth/logout` via `X-Requested-With: WorkCred` and exact origin validation.

### B. API Endpoints Mounted (`src/routes/auth.js`, `src/routes/users.js`, `src/app.js`)
- `POST /api/v1/auth/signup`: body `{ role, name, email, phone, password }`. Validates strict shape, rejects admin role and unknown fields, checks AUTH-3 password rules, ensures email uniqueness (409 `EMAIL_TAKEN`), allows shared phone numbers, creates user, issues JWT and `wc_rt` cookie (Status 201).
- `POST /api/v1/auth/login`: body `{ email, password, role }`. Constant-time dummy verification on unknown email. Lockout checked before password. Role checked strictly AFTER password verification. Wrong role returns 403 `ROLE_MISMATCH` with no session. Account lock returns 429 `ACCOUNT_LOCKED`.
- `POST /api/v1/auth/refresh`: requires `wc_rt` cookie and `X-Requested-With: WorkCred`. Rotates refresh token on every call. Reuse of an old token revokes the entire token family with 401 `SESSION_INVALID`.
- `POST /api/v1/auth/logout`: revokes active refresh token family and clears `wc_rt` cookie.
- `POST /api/v1/auth/password/change`: requires active access token and `{ currentPassword, newPassword }`. Increments `tokenVersion` (invalidating old access tokens across all devices), revokes previous refresh tokens, keeps active device logged in with new token and cookie.
- `GET /api/v1/users/me`: authenticated profile endpoint returning sanitized user data.

### C. Support Scripts (`backend/scripts`)
- `backend/scripts/reset-password.js <email>`: sets a random compliant temporary password, prints it once, sets `mustChangePassword = true`, increments `tokenVersion`, revokes all refresh sessions, clears lockout.
- `backend/scripts/unlock-account.js <email>`: clears `failedLoginCount`, `lockUntil`, and `lockLevel`.
- Integrated with npm scripts: `npm run support:reset-password` and `npm run support:unlock`.

### D. Manual Verification Scripts (`scripts/`)
- `scripts/auth-check.js`: Automated end-to-end local test verifying signup of worker and customer, duplicate email 409 rejection, login, wrong password, role mismatch, `/users/me`, refresh token rotation, replay detection, password change, and logout. Refuses to run against non-local hosts.
- `scripts/login-attack.js`: Simulates 12 incorrect password attempts on a throwaway account, proving the exact lockout sequence (401 four times, 429 from attempt 5 onwards) and that the correct password is refused while locked.

---

## 2. Test Verification Summary

- **Unit & Smoke Tests:** 110 tests passing across 20 suites (`npm test`).
- **Integration Tests:** 19 tests passing across 2 suites (`npm run test:integration`).
  - `tests/integration/auth.integration.test.js`: signup, duplicate email, shared phone, password rules, timing-neutral login, role mismatch, 5-failure lockout, token rotation, reuse revocation, password change cross-device revocation, disabled account blocking, operator injection rejection, privacy scan recursion, and route authorization matrix.
  - `tests/integration/models.integration.test.js`: schema, unique indexes, TTL indexes, role immutability, and Passport entry immutability.

---

## 3. Files Created and Modified

### Created
- `backend/src/utils/passwordCrypto.js`
- `backend/src/utils/tokenCrypto.js`
- `backend/src/utils/auditLogger.js`
- `backend/src/utils/userHelpers.js`
- `backend/src/middleware/auth.js`
- `backend/src/routes/auth.js`
- `backend/src/routes/users.js`
- `backend/scripts/reset-password.js`
- `backend/scripts/unlock-account.js`
- `backend/tests/helpers/privacyScanner.js`
- `backend/tests/unit/auth/authValidation.test.js`
- `backend/tests/unit/auth/auditLogging.test.js`
- `backend/tests/integration/auth.integration.test.js`
- `scripts/auth-check.js`
- `scripts/login-attack.js`

### Modified (Existing B1 Files)
- `backend/src/app.js`: mounted auth and users routes under `/api/v1`.
- `backend/package.json`: added `support:reset-password` and `support:unlock` scripts.
- `docs/API_CONTRACT.md`: updated with full request/response shapes, headers, status codes, and frontend rules.
- `docs/DATA_MODEL.md`: documented keyed HMAC-SHA256 for `refreshTokens.tokenHash`.
- `docs/DECISIONS.md`: added Decisions 9, 10, 11 (scrypt concurrency, dummy timing, HMAC refresh family revocation).
- `docs/PROGRESS.md`: updated Phase B2 status.

---

## 4. Exact Commands to Run

```bash
# 1. Run all unit and smoke tests (no database required)
cd backend
npm test

# 2. Run all database integration tests (uses in-memory MongoDB)
npm run test:integration

# 3. Check for security vulnerabilities
npm audit

# 4. Start the backend development server
npm run dev
# (Keep this server running in terminal 1)

# 5. In a second terminal, run the manual verification check scripts from workspace root:
node scripts/auth-check.js
node scripts/login-attack.js

# 6. Test support scripts if desired:
cd backend
npm run support:unlock -- test@example.com
npm run support:reset-password -- test@example.com
```
