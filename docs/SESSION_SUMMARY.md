# Session Summary: Phase B3 (Profiles, Calendar, and Signed Uploads)

**Date:** 2026-10-16  
**Phase Completed:** Phase B3 (Profiles, Calendar, Location Privacy, Signed Uploads - Backend Only)  
**Status:** Code Written & Ready for Verification (All 121 unit/smoke and 30 integration tests written)

---

## 1. What Was Built in Phase B3

### A. Core Profile Rules & Validation Engine (`shared/`)
1. **Profile Rules (`shared/profileRules.js`):**
   - Standard 11 skills: `helper`, `electrician`, `plumber`, `mason`, `painter`, `carpenter`, `cook`, `cleaner`, `driver`, `vendor`, `other`.
   - Weekly slot options: `off`, `morning`, `afternoon`, `evening`, `full`.
   - Limits: `maxSkills: 6`, `minRate: 50`, `maxRate: 100000`, `maxBioLength: 200`, `minRadiusKm: 1`, `maxRadiusKm: 10`, `maxBlockedDates: 60`.
   - Pure function `isProfileComplete(user)`:
     - Worker complete when: `name`, `phone`, at least 1 skill with exactly 1 designated as main, `hourlyRate` or `dailyRate` > 0, recognized `localityKey`, and `radiusKm` between 1 and 10.
     - Customer complete when: `name`, `phone`, and recognized `localityKey`.
2. **Calendar Rules (`shared/calendarRules.js`):**
   - Pure function `isSlotAvailable(calendar, dateTime)` evaluating weekday pattern vs. blocked dates in Asia/Kolkata timezone (UTC+5:30).
   - Exact time slot boundaries: `morning` (06:00 to 12:00), `afternoon` (12:00 to 17:00), `evening` (17:00 to 21:00), `full` (06:00 to 21:00), `off` (never). Blocked dates always win over the weekly schedule.
3. **Profile Validators (`shared/profileValidators.js`):**
   - Location validation within India geographic bounds (lat: 6 to 38, lng: 68 to 98). Auto-resolves nearest locality within 25 km if `localityKey` not sent, or prompts `CHOOSE_AREA`.
   - Blocked date validation: today or later in India time, no more than 365 days ahead, no duplicates, max 60 dates, reasons passed through `containsContactInfo`.
   - Bio validation: max 200 chars, passed through `containsContactInfo` to reject phone numbers, emails, handles, or URLs.
   - Cloudinary photo URL validation: empty string or strict HTTPS URL matching `res.cloudinary.com/<cloudName>/image/upload/.../workcred/<NODE_ENV>/<userId>/avatar/...`.
   - Mass-assignment and role-based field restrictions: rejects unknown and forbidden fields with 400 `FORBIDDEN_FIELD`; rejects worker fields sent by customers with 400 `FIELD_NOT_ALLOWED_FOR_ROLE`.

### B. Endpoints Mounted under `/api/v1` (`backend/src`)
1. `GET /api/v1/meta`: Authenticated. Returns skills list, sanitized localities (`key`, `name`, `cityKey` — **never** coordinates), weekly slot options, and system limits.
2. `GET /api/v1/users/me`: Returns owner's profile with worker or customer fields. Server dynamically recomputes `profileComplete`. Never returns coordinates.
3. `PATCH /api/v1/users/me`: Authenticated partial update. Sanitizes updates, recomputes `profileComplete`, saves to MongoDB, and logs audit event `profile_updated` with changed field names only.
4. `POST /api/v1/uploads/sign`: Authenticated. Generates Cloudinary direct browser upload signature (SHA-1 over sorted parameters with API secret) locked to `workcred/<NODE_ENV>/<userId>/avatar`. Returns 503 `UPLOADS_DISABLED` when Cloudinary env vars are missing. Rate limited to 20/hr per user.

### C. Manual Verification Script (`scripts/profile-check.js`)
- Refuses non-local hosts.
- Creates throwaway worker and customer, patches profiles step-by-step verifying `profileComplete` transitions from false to true.
- Tests rejection of forbidden fields and customer sending worker fields.
- Verifies calendar sorting and blocked dates.
- Verifies location coordinates are privately stored and never returned in API responses.
- If Cloudinary is configured on the server, uploads a tiny PNG and saves `photoUrl`; otherwise prints SKIPPED.

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
