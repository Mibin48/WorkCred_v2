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
1. **One Refresh At A Time:** When access token expires, frontend must perform at most one refresh request concurrently. Concurrent calls will trigger family revocation (`SESSION_INVALID`). Managed via `navigator.locks.request("workcred-refresh")` with localStorage lease fallback (`frontend/app/js/session.js`).
2. **Send Header:** All requests to `POST /auth/refresh` and `POST /auth/logout` MUST include `X-Requested-With: WorkCred`.
3. **Never Mix Hostnames:** Never mix `localhost` and `127.0.0.1` in URLs during development; cookies set on `localhost` will not be attached to requests sent to `127.0.0.1`. Enforced by `ALLOWED_HOSTS` in `frontend/server.js` and `frontend/app/js/api.js`.
4. **Memory-Only Access Tokens:** Access tokens are stored exclusively in in-memory JavaScript variables. They are never written to `localStorage`, `sessionStorage`, or cookies.
5. **Envelope Parsing:** Frontend API client (`frontend/app/js/api.js`) automatically unwraps standard success `{ success: true, data }` envelopes and converts `{ success: false, error: { code, message, details } }` into structured errors.
6. **Multi-Tab Sync:** Login, logout, and token rotation events are mirrored across all open tabs via `BroadcastChannel("workcred-auth")`.

---

## 1. Authentication (`/auth`)

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/auth/signup` | Register new worker or customer | Public | 201 | `{ role, name, email, phone, password }` | `{ user, accessToken, expiresIn: 900 }` + `wc_rt` cookie | `VALIDATION_ERROR`, `WEAK_PASSWORD`, `EMAIL_TAKEN`, `TOO_MANY_REQUESTS` |
| `POST` | `/auth/login` | Authenticate email and password | Public | 200 | `{ email, password, role }` | `{ user, accessToken, expiresIn: 900 }` + `wc_rt` cookie | `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `ROLE_MISMATCH`, `ACCOUNT_DISABLED`, `ACCOUNT_LOCKED`, `TOO_MANY_REQUESTS` |
| `POST` | `/auth/refresh` | Rotate refresh token | Public (Cookie + Header) | 200 | *(none)* (reads `wc_rt` cookie) | `{ accessToken, expiresIn: 900 }` + rotated `wc_rt` cookie | `BAD_ORIGIN`, `UNAUTHORIZED`, `SESSION_INVALID`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `ACCOUNT_DISABLED` |
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
| `POST` | `/bookings` | Create direct booking or Free Now instant booking | Customer (profileComplete required) | 201 | Header: `Idempotency-Key: <key>`<br>Body: `{ workerId, hours (1-12 in 0.5 increments), scheduledAt?, fromFreeNow?: boolean, note? (max 200) }`.<br>**When `fromFreeNow: true`:** `scheduledAt` must NOT be sent (400 if sent); server automatically sets `scheduledAt = now + 30m`; worker must have an active live window (409 `NOT_FREE_NOW`); `scheduledAt` must be before `window.expiresAt` (409 `FREE_WINDOW_ENDS_SOON`); weekly schedule pattern is bypassed while blocked dates are strictly enforced (409 `BLOCKED_TODAY`); sets `source: "freenow"` and closes window with `closedReason: "booked"`. | `{ booking: { id, status: "pending", displayStatus: "pending", skill, scheduledAt, hours, agreedRate, cashAmount, otherPartyDisplay, localityName, source: "direct" \| "freenow", createdAt } }` | `KEY_REQUIRED` (400), `PROFILE_INCOMPLETE` (403), `FORBIDDEN_ROLE` (403), `NOT_FOUND` (404 for worker), `VALIDATION_ERROR` (400), `CONTACT_INFO_BLOCKED` (400), `NOT_FREE_NOW` (409), `FREE_WINDOW_ENDS_SOON` (409), `BLOCKED_TODAY` (409), `NOT_AVAILABLE` (409), `TIME_CLASH` (409), `BOOKING_LIMIT` (429 if >20/hr) |
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

Optional header `Idempotency-Key` (8 to 80 chars: letters, digits, dash, underscore) accepted on all mutation endpoints. Finished duplicates replay stored status and body with header `Idempotent-Replay: true`. Concurrent duplicates yield `409 REQUEST_IN_PROGRESS`. Payload mismatch on same key yields `422 KEY_REUSED`. Malformed keys return `400 INVALID_IDEMPOTENCY_KEY`, storage conflicts return `500 IDEMPOTENCY_ERROR`.

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

### Frontend Integration Notes
1. **Refetch After Mutation:** Feed and social events do NOT go over sockets in this phase. Clients must explicitly refetch the feed (`GET /feed`) after creating a post (`POST /posts`) or deleting a post (`DELETE /posts/:id`).
2. **Post Photo Uploads:** Request an upload signature via `POST /uploads/sign` with `{ purpose: "post" }` before sending `afterUrl` or `beforeUrl` to `POST /posts`.
3. **Idempotency Key:** `POST /posts` supports optional `Idempotency-Key` header (8-80 chars) to prevent duplicate post creations upon network retries.
4. **Feed Pagination:** The `cursor` parameter is an opaque, signed token based on `(createdAt, _id)`. Never inspect or synthesize cursors on the client.

| Method | Endpoint | Description | Access | Status | Request Body / Query | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/posts` | Create verified or standard work post | Worker (profileComplete required) | 201 | Header: `Idempotency-Key?`<br>Body: `{ skill, caption (max 140, trimmed NFC, passes containsContactInfo), afterUrl, beforeUrl?, bookingId? }`. `afterUrl` and `skill` required. Photo URLs must point to user's own `posts` Cloudinary folder. Unknown fields 400. Quotas enforced: max 10/day, max 100 active. | `{ post: { id, worker: { id, name, photoUrl, mainSkill, hasVerifiedHistory }, skill, caption, afterUrl, beforeUrl, verifiedJob: boolean, createdAt, localityName, viewer: { isFollowing: false, isSaved: false }, isMine: true } }` | `FORBIDDEN_ROLE` (403 for customer), `PROFILE_INCOMPLETE` (403), `VALIDATION_ERROR` (400), `NOT_YOUR_JOB` (403 if booking not worker's), `INVALID_STATE` (409 if booking not completed), `SKILL_MISMATCH` (409 if booking skill differs), `BOOKING_ALREADY_POSTED` (409), `POST_LIMIT_DAILY` (429 if >10/day), `POST_LIMIT_ACTIVE` (409 if >=100 active), `TOO_MANY_REQUESTS` (429 if >10/hr) |
| `GET` | `/posts/mine` | List posts created by authenticated worker | Worker only | 200 | Query: `limit` (1-50, default 20), `cursor` (opaque) | `{ posts: [ { id, worker, skill, caption, afterUrl, beforeUrl, verifiedJob, createdAt, localityName, viewer, isMine: true } ], nextCursor }` | `FORBIDDEN_ROLE` (403 for customer), `VALIDATION_ERROR` (400 if limit invalid), `BAD_CURSOR` (400) |
| `DELETE` | `/posts/:id` | Hard delete own work post | Worker only (Owner only) | 200 | *(none)* | `{ message: "Post deleted successfully" }`. Decrements `activePostCount` (never below 0). Repeating returns the same success. Photos stay in Cloudinary. | `FORBIDDEN_ROLE` (403 for customer), `NOT_FOUND` (404 for unknown, non-owner, or invalid ID) |
| `GET` | `/feed` | Unified feed (nearby or following) | Logged in (Worker or Customer) | 200 | Query: `tab` (`nearby` \| `following`, default `nearby`), `limit` (1-50, default 20), `cursor` (opaque). Requires area for nearby tab (400 `SET_AREA`). Rate limit: 120 req / 10 min. | `{ items: [ { id, worker: { id, name, photoUrl, mainSkill, hasVerifiedHistory }, skill, caption, afterUrl, beforeUrl, verifiedJob, createdAt, approxDistance?: { km, label }, localityName, viewer: { isFollowing, isSaved }, isMine } ], nextCursor, highlights?: [ ... ] }`. Highlights appear only on first page of nearby tab (max 5 open jobs for workers, max 5 Free Now workers for customers). | `SET_AREA` (400 if caller has no area for nearby), `VALIDATION_ERROR` (400), `BAD_CURSOR` (400), `TOO_MANY_REQUESTS` (429) |
| `POST` | `/follows` | Follow or save worker | Logged in (Both roles) | 200 | Body: `{ workerId, type: "follow" \| "save" }`. Target must be active, complete worker and not caller. Safe to repeat (idempotent). Caps: 500 follows, 500 saves. Limit: 120/hr. | `{ message: "Followed successfully" \| "Saved successfully", following: true }` | `CANNOT_FOLLOW_SELF` (400), `NOT_FOUND` (404 for invalid, unknown, inactive, or non-worker), `VALIDATION_ERROR` (400), `FOLLOW_LIMIT` (409 if >=500 follows), `SAVE_LIMIT` (409 if >=500 saves), `TOO_MANY_REQUESTS` (429) |
| `DELETE` | `/follows/:workerId` | Remove follow or save relation | Logged in (Both roles) | 200 | Query: `type` (`follow` \| `save`, required). Safe to repeat. Decrements counter only when record removed. | `{ message: "Removed successfully", following: false }` | `VALIDATION_ERROR` (400 if type missing or invalid), `TOO_MANY_REQUESTS` (429) |
| `GET` | `/follows` | List followed or saved workers | Logged in (Both roles) | 200 | Query: `type` (`follow` \| `save`, required), `limit` (1-50, default 20), `cursor`. Inactive workers skipped. Rate limit: 120 req / 10 min. | `{ workers: [ { id, name, photoUrl, mainSkill, rate: { hourly, daily, effectiveHourly }, rating, jobsCount, hasVerifiedHistory, localityName, approxDistance?: { km, label } } ], nextCursor }` | `VALIDATION_ERROR` (400 if type missing or limit invalid), `BAD_CURSOR` (400), `TOO_MANY_REQUESTS` (429) |
| `POST` | `/endorsements` | Endorse worker skill | Customer only (profileComplete required) | 200 | Body: `{ workerId, skill }`. Must have >=1 completed booking with worker for skill. One endorsement per customer, worker, skill. Limit: 30/hr. | `{ workerId, skill, count }` (new total for skill) | `FORBIDDEN_ROLE` (403 for workers), `NOT_FOUND` (404 for unknown worker), `VALIDATION_ERROR` (400 if skill invalid), `NOT_ELIGIBLE` (403 if no completed booking for skill), `ALREADY_ENDORSED` (409), `TOO_MANY_REQUESTS` (429) |

---

## 10. Uploads (`/uploads`)

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/uploads/sign` | Generate server-signed Cloudinary direct browser upload signature | Logged in | 200 | `{ purpose: "avatar" \| "post" }`. Folder is automatically assigned: `workcred/<NODE_ENV>/<userId>/avatar` or `workcred/<NODE_ENV>/<userId>/posts`. Rate limit: 20/hr shared across purposes. | `{ cloudName, apiKey, timestamp, folder, publicId, signature, uploadUrl }` | `VALIDATION_ERROR` (400 if purpose not avatar or post), `UPLOADS_DISABLED` (503 if Cloudinary env vars missing), `TOO_MANY_REQUESTS` (429 if >20/hr) |

---

## 11. Reports & Moderation (`/reports`)

| Method | Endpoint | Description | Access | Status | Request Body | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `POST` | `/reports` | Submit report against post or worker | Logged in (Both roles) | 200 | Body: `{ targetType: "post" \| "worker", targetId, reason: "spam" \| "inappropriate" \| "fake" \| "unsafe" \| "other", note? (max 200, contact blocked) }`. Duplicate report within 24h suppressed (same success). Rate limit: 10/hr. | `{ message: "Report received. Support will review it." }` | `CANNOT_REPORT_SELF` (400 if reporting own post or self), `NOT_FOUND` (404 for unknown target), `VALIDATION_ERROR` (400 if targetType is booking or invalid fields), `CONTACT_INFO_BLOCKED` (400), `REPORT_LIMIT` (429 if >10/hr) |

---

## 12. Health & Diagnostics (`/health`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/health` | Basic service liveness check | Public | Always returns HTTP 200 with `{ "status": "ok" }`. |
| `GET` | `/health/ready` | Readiness check including database connectivity | Public | Returns HTTP 200 `{ "database": "connected" }` when MongoDB answers ping; HTTP 503 `SERVICE_UNAVAILABLE` otherwise. |

---

## 13. Free Now Availability (`/availability`)

| Method | Endpoint | Description | Access | Status | Request Body / Query | Response Data | Error Codes |
|---|---|---|---|---|---|---|---|
| `GET` | `/availability/me` | Fetch authenticated worker's current active Free Now window | Worker only | 200 | *(none)* | `{ window: { id, startsAt, expiresAt, minutesLeft, totalHours, canExtendHours } \| null, serverTime }`. Expired windows read as `null`. | `FORBIDDEN_ROLE` (403 for customers) |
| `POST` | `/availability` | Start a new Free Now window | Worker (profileComplete required) | 201 | Body: `{ hours: 2 \| 4 \| 8 }`. Unknown fields rejected. Rate limit: 20 changes/hour across start, extend, and stop. | `{ window: { id, startsAt, expiresAt, minutesLeft, totalHours, canExtendHours }, serverTime }`. Publishes `radar:worker_free`. | `FORBIDDEN_ROLE` (403), `PROFILE_INCOMPLETE` (403), `VALIDATION_ERROR` (400 if hours not 2, 4, 8 or extra fields), `JOB_IN_PROGRESS` (409 if worker has active in_progress booking), `BLOCKED_TODAY` (409 if today is blocked date), `ALREADY_FREE` (409 if live window exists), `FREE_LIMIT` (429 if >20 changes/hr) |
| `POST` | `/availability/extend` | Extend current active Free Now window | Worker only | 200 | Body: `{ hours: 1 \| 2 \| 4 }`. Unknown fields rejected. Total window duration capped at 12 hours. | `{ window: { id, startsAt, expiresAt, minutesLeft, totalHours, canExtendHours }, serverTime }` | `FORBIDDEN_ROLE` (403), `VALIDATION_ERROR` (400 if hours not 1, 2, 4 or extra fields), `NO_WINDOW` (404 if no live window), `EXTEND_LIMIT` (409 with `remainingHours` if total would exceed 12h), `FREE_LIMIT` (429 if >20 changes/hr) |
| `DELETE` | `/availability` | Stop current active Free Now window | Worker only | 200 | *(none)* (Idempotent: safe to repeat, always returns success). | `{ stopped: boolean }`. Publishes `radar:worker_busy` once with `reason: "stopped"`. | `FORBIDDEN_ROLE` (403), `FREE_LIMIT` (429 if >20 changes/hr) |
| `GET` | `/availability/nearby` | Find live Free Now workers near customer | Customer only (caller must have localityKey or location) | 200 | Query: `radiusKm` (1-5, default 3), `skill` (optional), `limit` (1-50, default 20), `cursor` (opaque base64url). Rate limit: 120 req / 10 min. | `{ workers: [ { workerId, name, photoUrl, mainSkill, skills: [name], rate: { hourly }, rating, jobsCount, minutesLeft, approxDistance: { km, label }, localityName, hasVerifiedHistory, fairRate: { label, isSample }, canBookNow } ], nextCursor, serverTime }`. `canBookNow` is true when `minutesLeft > 30`. Coordinates, phone, and email are NEVER included. | `FORBIDDEN_ROLE` (403 for workers), `SET_AREA` (400 if customer has no area set), `VALIDATION_ERROR` (400), `BAD_CURSOR` (400), `TOO_MANY_REQUESTS` (429) |

---

## 14. Realtime Over Socket.io (`/socket.io`)

### 14.1 Connection & Handshake Authentication
- **Transport & Path:** Path `/socket.io`. Transports: `websocket` and `polling`. Buffer limit: 10 KB (`maxHttpBufferSize`).
- **Authentication Source:** Access token is accepted **ONLY** in handshake auth payload: `auth: { token: "<jwt>" }`.
- **Query String Rejected:** Passing a token in query parameter `?token=...` is rejected with `AUTH_INVALID` and never logged.
- **CORS & Origin:** Exact allow-list matching `FRONTEND_ORIGINS` with credentials (`withCredentials: true`). Missing Origin header is allowed (native apps/scripts); unlisted Origin header is rejected with `AUTH_INVALID`.
- **Connection Security Limits:**
  - Max 5 simultaneous socket connections per user (`TOO_MANY_CONNECTIONS`).
  - Max 30 connection attempts per minute per IP (`RATE_LIMITED`).
- **Initial Handshake Event:** Upon successful connection, server emits `"ready"` `{ serverTime: string }`.

### 14.2 Client-to-Server Events
Only two client-to-server events are recognized. All other custom client events or join attempts are strictly ignored.
Rate limit: Maximum 10 client events per minute per socket. Exceeding limit immediately disconnects socket with `RATE_LIMITED`.

| Client Event | Payload | Response / Acknowledgement | Behavior |
|---|---|---|---|
| `auth:refresh` | `{ token: "<new_jwt>" }` | Acknowledgement: `{ ok: true }` or `{ ok: false, code: "AUTH_INVALID" }` | Validates new token; requires identical user ID and matching tokenVersion; extends socket expiry lifetime. Token for different user disconnects socket. |
| `rooms:refresh` | *(no payload)* | *(none)* | Server reloads user profile from database and re-computes grid cell rooms and cached targeting data in memory. Used after user updates location, radius, or skills. |

### 14.3 Server-to-Client Domain Events
Events are hints, never data. Payloads carry IDs and display basics only. Clients refetch authoritative data over REST.

| Event Name | Audience / Recipients | Payload Keys | Description |
|---|---|---|---|
| `job:new` | Workers with matching skill within their radiusKm of job location | `{ jobId, skill }` | New job posted on board |
| `job:filled` | Same audience as `job:new` | `{ jobId, reason: "filled" \| "cancelled" }` | Job accepted, cancelled, or expired |
| `radar:worker_free` | Customers within 5 km of worker's locality centroid | `{ workerId }` | Worker started Free Now window |
| `radar:worker_busy` | Same audience as `radar:worker_free` | `{ workerId, reason }` (`"stopped" \| "expired" \| "booked" \| "confirmed" \| "accepted" \| "started"`) | Free Now window closed |
| `booking:request` | The worker participant only (`user:<workerId>`) | `{ bookingId }` | Customer requested a direct or Free Now booking |
| `booking:created` | The customer participant only (`user:<customerId>`) | `{ bookingId }` | Worker confirmed direct booking or accepted posted job |
| `booking:started` | The customer participant only (`user:<customerId>`) | `{ bookingId }` | Worker started job (code verified) |
| `booking:completed` | The worker participant only (`user:<workerId>`) | `{ bookingId }` | Customer finished job (payment & review completed) |
| `booking:cancelled` | The OTHER party only (never canceller) | `{ bookingId, cancelledBy }` | Booking cancelled or declined |

### 14.4 Token Lifetime & Reconnection Rules
1. **Refetch on Ready:** Clients must re-fetch their active view data over REST upon receiving the `"ready"` event (and after every reconnect). Missed events are never queued or replayed.
2. **Token Refresh Sequence:** Refresh tokens over REST (`POST /api/v1/auth/refresh`) first; once a fresh access token is acquired, emit `auth:refresh` over the existing socket.
3. **Expiry Disconnect:** A connected socket whose token expiry time has passed by more than 60 seconds without refresh is disconnected by server with `AUTH_EXPIRED`.
4. **Periodic Revalidation:** Server re-verifies all active sockets every 60 seconds against database. Sockets belonging to disabled accounts or accounts with modified `tokenVersion` (e.g. password reset) are disconnected immediately with `AUTH_INVALID`.
5. **Never Put Token in URL:** Tokens must never appear in query parameters or URL paths.
6. **Rooms Refresh:** Emit `rooms:refresh` immediately after updating area (`localityKey`), skills, or `radiusKm`.

---

## 15. Demo & Development (`/demo`)

| Method | Endpoint | Description | Access | Status | Response Data | Error Codes | Notes |
|---|---|---|---|---|---|---|---|
| `GET` | `/demo/accounts` | Fetch sample accounts and shared demo password for dev login banner | Public | 200 | `{ notice: "Sample accounts for development only", password, accounts: [{ role, name, email, note }] }` | `NOT_FOUND`, `TOO_MANY_REQUESTS` | Available ONLY in `development` environment when `DEMO_PASSWORD` is configured and sample users exist in database. Returns 404 in production, test, or if no sample accounts exist. Rate limited to 30 requests per 10 minutes per IP. Served with `Cache-Control: no-store`. |


