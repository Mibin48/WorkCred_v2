# WorkCred API Contract (`/api/v1`)

## Standard Response Envelopes

### Success Response
```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": [] // Optional details array/object (e.g. validation errors)
  }
}
```

> **API Headers Rule:** All API responses under `/api/v1/*` are served with `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`. Errors never leak stack traces. Invalid JSON payloads return `400 BAD_JSON`. Unmatched routes return `404 NOT_FOUND`.

### Frontend Integration Rules (Critical)
1. **One Refresh At A Time:** When access token expires, frontend must perform at most one refresh request concurrently. Concurrent calls will trigger family revocation (`SESSION_INVALID`).
2. **Send Header:** All requests to `POST /auth/refresh` and `POST /auth/logout` MUST include `X-Requested-With: WorkCred`.
3. **Never Mix Hostnames:** Never mix `localhost` and `127.0.0.1` in URLs during development; cookies set on `localhost` will not be attached to requests sent to `127.0.0.1`.

---

## 1. Authentication (`/auth`)

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/auth/signup` | Register new worker or customer | Public | 201 | `{ role, name, email, phone, password }` | `{ user, accessToken, expiresIn: 900 }` + `wc_rt` cookie | `VALIDATION_ERROR`, `WEAK_PASSWORD`, `EMAIL_TAKEN`, `TOO_MANY_REQUESTS` |
| `POST` | `/auth/login` | Authenticate email and password | Public | 200 | `{ email, password, role }` | `{ user, accessToken, expiresIn: 900 }` + `wc_rt` cookie | `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `ROLE_MISMATCH`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `TOO_MANY_REQUESTS` |
| `POST` | `/auth/refresh` | Rotate refresh token | Public (Cookie + Header) | 200 | *(none)* (reads `wc_rt` cookie) | `{ accessToken, expiresIn: 900 }` + rotated `wc_rt` cookie | `BAD_ORIGIN`, `UNAUTHORIZED`, `SESSION_INVALID`, `SESSION_EXPIRED`, `ACCOUNT_DISABLED` |
| `POST` | `/auth/logout` | Revoke session and clear cookie | Public (Cookie + Header) | 200 | *(none)* (reads `wc_rt` cookie) | `{}` + cleared `wc_rt` cookie | `BAD_ORIGIN` |
| `POST` | `/auth/password/change` | Change password and invalidate other sessions | Logged in | 200 | `{ currentPassword, newPassword }` | `{ accessToken, expiresIn: 900 }` + fresh `wc_rt` cookie | `UNAUTHORIZED`, `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `WEAK_PASSWORD` |

---

## 2. Users (`/users`)

| Method | Endpoint | Description | Access | Status | Response Data | Notes |
|---|---|---|---|---|---|---|
| `GET` | `/users/me` | Fetch active user's own profile | Logged in | 200 | `{ user: { id, role, name, email, phone, photoUrl, localityKey, localityName, hasExactLocation, profileComplete, mustChangePassword, ...workerFields } }` | Returns caller's own profile with worker fields if role === 'worker'. Never leaks passwordHash, lockUntil, lockLevel, failedLoginCount, tokenVersion, or exact coordinates. |
| `PATCH` | `/users/me` | Update personal profile details | Logged in | 200 | `{ user: { ... } }` | Partial update of caller's own profile. Fields for all: `name`, `phone`, `localityKey`, `location` ({ lat, lng }), `photoUrl`. Worker only: `skills`, `hourlyRate`, `dailyRate`, `bio`, `radiusKm`, `calendar`. Server recomputes `profileComplete`. Forbidden/unknown fields return 400 `FORBIDDEN_FIELD`. Customer sending worker field returns 400 `FIELD_NOT_ALLOWED_FOR_ROLE`. |

---

## 2.1 Metadata (`/meta`)

| Method | Endpoint | Description | Access | Status | Response Data | Notes |
|---|---|---|---|---|---|---|
| `GET` | `/meta` | Profile metadata, options & limits | Logged in | 200 | `{ skills, localities, weeklyOptions, limits }` | Skills (11 standard), sanitized localities (key, name, cityKey - NEVER coordinates), weekly slot options (off, morning, afternoon, evening, full), system limits (maxSkills: 6, maxBioLength: 200, minRadiusKm: 1, maxRadiusKm: 10, maxBlockedDates: 60). |

---

## 3. Workers (`/workers`)

| Method | Endpoint | Description | Access | Status | Query / Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `GET` | `/workers` | Search workers with filters and pagination | Logged in (Worker or Customer) | 200 | Query: `skill`, `distanceKm` (1-10, default 5), `minRate`, `maxRate` (rupees/hour), `minRating` (0-5), `sort` (`nearest` \| `rating` \| `price`, default `nearest`), `limit` (1-50, default 20), `cursor` (opaque base64url) | `{ workers: [ { id, name, photoUrl, mainSkill, skills: [name], rate: { hourly, daily, effectiveHourly }, rating, jobsCount, approxDistance: { km, label }, localityName, hasVerifiedHistory, fairRate: { label, isSample } } ], nextCursor }` | `SET_AREA` (400 if caller has no area), `VALIDATION_ERROR` (400), `BAD_CURSOR` (400), `TOO_MANY_REQUESTS` (120 req / 10 min) |
| `GET` | `/workers/:id` | Fetch public worker profile view | Logged in | 200 | *(none)* | `{ worker: { id, name, photoUrl, mainSkill, skills: [{ skill, isMain }], rate: { hourly, daily, effectiveHourly }, rating, jobsCount, approxDistance: { km, label }, localityName, hasVerifiedHistory, fairRate: { label, isSample }, bio, stats: { jobs, avgRating, totalHours }, availabilitySummary: { weekly: [...], blockedNext14DaysCount }, historyCheck: { status, records, privateIncludedCount }, endorsements: {} } }` | `NOT_FOUND` (404 for unknown, inactive, incomplete, non-worker, or invalid ID format), `TOO_MANY_REQUESTS` (120 req / 10 min) |
| `GET` | `/workers/:id/passport` | View visible Passport records for worker | Logged in | 200 | Query: `limit` (1-50, default 20), `cursor` | `{ entries: [ { recordId, skill, date, hours, rating, comment, employerDisplay } ], privateIncludedCount, historyCheck: { status: "valid" \| "needs_attention", records }, nextCursor }` | `NOT_FOUND` (404 for invalid/unknown worker), `BAD_CURSOR` (400) |
| `GET` | `/workers/:id/passport/verify` | Run tamper-evident chain integrity check | Logged in | 200 | *(none)* | `{ status: "valid" \| "needs_attention", records: N }` | `NOT_FOUND` (404 for invalid/unknown worker) |

---

## 3.1 Work Passport (`/passport`)

| Method | Endpoint | Description | Access | Status | Request Body / Query | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `GET` | `/passport/me` | Fetch worker's own full timeline (including hidden) | Worker only | 200 | Query: `limit` (1-50, default 20), `cursor` | `{ entries: [ { recordId, seq, skill, date, hours, rating, comment, visible, maskEmployerName, employerDisplay, employerName? } ], nextCursor, stats: { jobs, totalHours, avgRating, topSkills }, historyCheck: { status, records } }` | `FORBIDDEN` (403 for customers), `BAD_CURSOR` (400) |
| `PATCH` | `/passport/entries/:id` | Toggle entry visibility or employer masking | Worker only | 200 | `{ visible?: boolean, maskEmployer?: boolean }` | `{ entry: { recordId, seq, skill, visible, maskEmployerName, employerDisplay } }` | `FORBIDDEN` (403 for customers), `NOT_FOUND` (404 for another's record), `FORBIDDEN_FIELD` (400 for other fields), `VALIDATION_ERROR` (400) |

---

## 4. Bookings (`/bookings`)

### Frontend Integration Notes
1. **Idempotency Header:** `POST /bookings` REQUIRES an `Idempotency-Key` header (8-80 chars: letters, numbers, hyphens, underscores). Missing header returns `400 KEY_REQUIRED`.
2. **Codes Secrecy:** `GET /bookings/:id/codes` returns `{ startCode, finishCode, hideAfterSeconds: 30 }` with `Cache-Control: no-store`.
   - Codes MUST NEVER be cached in local storage, indexedDB, or service worker cache.
   - Display behind a tap-to-reveal button; automatically clear or re-mask after 30 seconds.
3. **Contact Release:** Counterparty phone appears ONLY while status is `confirmed` or `in_progress`. Worker receives `jobLocation: { lat, lng, localityName }` strictly during `confirmed` or `in_progress`.

| Method | Endpoint | Description | Access | Status | Request Body / Query | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/bookings` | Create direct booking request | Customer (profileComplete required) | 201 | Header: `Idempotency-Key: <key>`<br>Body: `{ workerId, scheduledAt, hours (1-12), note? (max 200) }` | `{ booking: { id, status: "pending", displayStatus: "pending", skill, scheduledAt, hours, agreedRate, cashAmount, otherPartyDisplay, localityName, source: "direct", createdAt } }` | `KEY_REQUIRED` (400), `PROFILE_INCOMPLETE` (403), `FORBIDDEN_ROLE` (403), `NOT_FOUND` (404 for worker), `VALIDATION_ERROR` (400), `CONTACT_INFO_BLOCKED` (400), `NOT_AVAILABLE` (409), `TIME_CLASH` (409), `BOOKING_LIMIT` (429 if >20/hr) |
| `GET` | `/bookings` | List own bookings by tab | Logged in | 200 | Query: `tab` (Customer: `upcoming`, `active`, `done`, `cancelled`; Worker: `requests`, `upcoming`, `active`, `done`, `cancelled`), `limit` (1-50, default 20), `cursor` | `{ bookings: [ { id, status, displayStatus, skill, scheduledAt, hours, agreedRate, cashAmount, otherPartyDisplay, localityName, source, createdAt } ], nextCursor }` | `VALIDATION_ERROR` (400 if tab missing or invalid), `BAD_CURSOR` (400) |
| `GET` | `/bookings/counts` | Get count of bookings in each tab | Logged in | 200 | *(none)* | `{ counts: { [tabName]: number } }` | `UNAUTHORIZED` (401) |
| `GET` | `/bookings/:id` | Get booking detail | Participants only | 200 | *(none)* | `{ booking: { id, status, displayStatus, skill, scheduledAt, hours, agreedRate, cashAmount, otherPartyDisplay, localityName, source, createdAt, timeline: [{ event, at, cancelledBy? }], note, startedAt, finishedAt, hoursWorked, rating, receiptAvailable, contact: { name, phone } \| null, jobLocation?: { lat, lng, localityName }, attemptsLeft?: number, lockedUntil?: string } }` | `NOT_FOUND` (404 for non-participants or invalid ID) |
| `GET` | `/bookings/:id/codes` | Get decrypted start and finish codes | Customer participant only | 200 | *(none)* (Headers: `Cache-Control: no-store`) | `{ startCode: "1234", finishCode: "5678", hideAfterSeconds: 30 }` | `NOT_FOUND` (404 for worker or non-participants), `CODES_NOT_AVAILABLE` (409 if not confirmed/in_progress or missed), `TOO_MANY_REQUESTS` (429 if >30/10min) |
| `POST` | `/bookings/:id/confirm` | Worker confirms pending booking | Worker participant only | 200 | *(none)* | `{ booking: { ...detail with contact released } }` | `FORBIDDEN` (403 for customer), `NOT_FOUND` (404), `INVALID_STATE` (409 if not pending or expired), `TIME_CLASH` (409), `NOT_AVAILABLE` (409) |
| `POST` | `/bookings/:id/cancel` | Cancel booking | Participants only | 200 | Body: `{ reason?: string }` (max 100) | `{ booking: { id, status: "cancelled", cancelledBy, cancelReason }, warning?: "REPEATED_CANCELLATIONS" }` | `NOT_FOUND` (404), `INVALID_STATE` (409 if already in_progress or completed), `VALIDATION_ERROR` (400), `CONTACT_INFO_BLOCKED` (400) |
| `POST` | `/bookings/:id/start` | Worker enters start code | Worker participant only | 200 | Body: `{ code: "1234", location?: { lat, lng } }` | `{ booking: { ...detail, status: "in_progress" }, warning?: "FAR_FROM_JOB" }` | `FORBIDDEN` (403 for customer), `NOT_FOUND` (404), `TOO_EARLY` (409 if >60m before), `INVALID_STATE` (409), `WRONG_CODE` (400 with `attemptsLeft`), `CODE_LOCKED` (429 with minutes remaining) |
| `POST` | `/bookings/:id/finish` | Customer enters finish code and rating | Customer participant only | 200 | Optional Header: `Idempotency-Key`<br>Body: `{ finishCode: "5678", paidCash: true, rating: 1-5, comment?: string }` | `{ receipt: { bookingId, recordId, skill, date, startedAt, finishedAt, bookedHours, hoursWorked, agreedRate, cashAmount, paymentNote: "Cash payment reported by customer", rating, comment, otherPartyDisplay } }` | `FORBIDDEN` (403 for worker), `NOT_FOUND` (404), `INVALID_STATE` (409 if not in_progress), `PAID_CASH_REQUIRED` (400 if paidCash !== true), `VALIDATION_ERROR` (400), `CONTACT_INFO_BLOCKED` (400), `WRONG_CODE` (400 with `attemptsLeft`), `CODE_LOCKED` (429) |
| `GET` | `/bookings/:id/receipt` | View final receipt | Participants only | 200 | *(none)* | `{ receipt: { bookingId, recordId, skill, date, startedAt, finishedAt, bookedHours, hoursWorked, agreedRate, cashAmount, paymentNote, rating, comment, otherPartyDisplay } }` | `NOT_FOUND` (404 for non-participants), `NOT_COMPLETED` (409 if not completed) |
| `POST` | `/bookings/:id/report` | Report problem during active job | Worker participant only | 200 | Body: `{ category: "customer_not_there" \| "wrong_place" \| "unsafe" \| "other", note?: string }` | `{ message: "Report received. Support will review it." }` | `FORBIDDEN` (403 for customer), `NOT_FOUND` (404), `INVALID_STATE` (409 if not in_progress), `VALIDATION_ERROR` (400), `CONTACT_INFO_BLOCKED` (400), `TOO_MANY_REQUESTS` (429 if >10/hr) |

---

## 4. Jobs (`/jobs`)

Optional header `Idempotency-Key` (8 to 80 chars: letters, digits, dash, underscore) accepted on all mutation endpoints. Finished duplicates replay stored status and body with header `Idempotent-Replay: true`. Concurrent duplicates yield `409 REQUEST_IN_PROGRESS`. Payload mismatch on same key yields `422 KEY_REUSED`.

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/jobs` | Post new open job | Customer (profileComplete required) | 201 | `{ skill, workersNeeded (1-10), hours (1-12), startAt (ISO 8601), offeredRate (50-100000 ₹/hr), description (max 300), localityKey?, location? { lat, lng } }` | `{ job: { id, skill, workersNeeded, acceptedCount, hours, startAt, offeredRate, totalPay, description, localityKey, localityName, status, fairRate: { label, p25, median, p75, source, isSample } } }` | `FORBIDDEN` (403 for workers), `PROFILE_INCOMPLETE` (403), `JOB_LIMIT` (429 if >20 jobs/day), `VALIDATION_ERROR` (400), `INVALID_LOCALITY` (400) |
| `GET` | `/jobs` | List matching jobs near worker | Worker (profileComplete required) | 200 | Query: `limit` (1-50, default 20), `cursor` | `{ jobs: [ { id, skill, hours, startAt, offeredRate, totalPay, spotsLeft, descriptionExcerpt, approxDistance: { km, label }, localityName, customerDisplay, fairRate: { label } } ], nextCursor }` | `FORBIDDEN` (403 for customers), `PROFILE_INCOMPLETE` (403), `SET_AREA` (400), `INVALID_LIMIT` (400), `BAD_CURSOR` (400) |
| `GET` | `/jobs/mine` | List customer's posted jobs | Customer | 200 | Query: `limit` (1-50, default 20), `cursor` | `{ jobs: [ { id, skill, workersNeeded, acceptedCount, hours, startAt, offeredRate, totalPay, description, localityKey, localityName, status, acceptedWorkers: [{ id, displayName, bookingId, bookingStatus }] } ], nextCursor }` | `FORBIDDEN` (403 for workers), `INVALID_LIMIT` (400), `BAD_CURSOR` (400) |
| `POST` | `/jobs/:id/accept` | Accept an open job slot (G6, G7) | Worker (profileComplete required) | 200 | *(none)* | `{ bookingId, status: "confirmed", scheduledAt, hours, agreedRate, jobId }` | `FORBIDDEN` (403 for customers), `PROFILE_INCOMPLETE` (403), `NOT_FOUND` (404), `SKILL_MISMATCH` (403), `TOO_FAR` (403), `JOB_EXPIRED` (409), `JOB_FULL` (409), `NOT_AVAILABLE` (409), `TIME_CLASH` (409), `ALREADY_ACCEPTED` (409) |
| `POST` | `/jobs/:id/cancel` | Cancel posted job and confirmed bookings | Customer (Owner only) | 200 | *(none)* | `{ id, status: "cancelled" }` | `FORBIDDEN` (403 for workers), `NOT_FOUND` (404 for non-owner), `JOB_EXPIRED` (409), `JOB_IN_PROGRESS` (409) |

---

## 8. Fair Rate Compass (`/compass`)

| Method | Endpoint | Description | Access | Status | Query Parameters | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `GET` | `/compass` | Rate guidance with 3-tier fallback | Logged in | 200 | `skill` (required), `localityKey` (optional, default caller's), `rate` (optional ₹/hr) | `{ skill, localityKey, p25, median, p75, sampleSize, source: "locality" \| "city" \| "baseline", isSample, note?, label? }` | `VALIDATION_ERROR` (400), `SET_AREA` (400), `TOO_MANY_REQUESTS` (60 req / 10 min) |

---

## 9. Feed & Social (`/feed`, `/posts`, `/follows`, `/endorsements`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/feed` | Combined nearby feed | Logged in | Worker sees jobs & posts; Customer sees free workers & posts. |
| `POST` | `/posts` | Create verified work post | Worker | Body: `afterUrl`, `beforeUrl`, `skill`, `caption`, `bookingId`. Contact blocked. |
| `GET` | `/posts/mine` | List posts created by active worker | Worker | Worker's own feed timeline. |
| `DELETE` | `/posts/:id` | Delete worker's own work post | Worker | Removes post from active feed. |
| `POST` | `/follows` | Follow or save worker | Logged in | Body: `toId`, `type` ('follow' or 'save'). |
| `DELETE` | `/follows/:toId` | Remove follow or save | Logged in | Query: `type`. |
| `GET` | `/follows` | List followed or saved workers | Logged in | Filter by type. |
| `POST` | `/endorsements` | Endorse worker skill | Customer | Permitted once per worker per skill following a completed booking. |

---

## 10. Uploads (`/uploads`)

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/uploads/sign` | Generate server-signed Cloudinary direct browser upload signature | Logged in | 200 | `{ purpose: "avatar" }` | `{ cloudName, apiKey, timestamp, folder, publicId, signature, uploadUrl }` | `VALIDATION_ERROR`, `UPLOADS_DISABLED` (503 if Cloudinary env vars missing), `TOO_MANY_REQUESTS` (20/hr limit) |

---

## 11. Reports & Moderation (`/reports`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `POST` | `/reports` | Submit abuse, safety, or profile report to support inbox | Logged in | Body: `targetType`, `targetId`, `reason`, `note`. Contact blocked. |

---

## 12. Health & Diagnostics (`/health`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/health` | Basic service liveness check | Public | Always returns HTTP 200 with `{ "status": "ok" }`. |
| `GET` | `/health/ready` | Readiness check including database connectivity | Public | Returns HTTP 200 `{ "database": "connected" }` when MongoDB answers ping; HTTP 503 `SERVICE_UNAVAILABLE` otherwise. |
