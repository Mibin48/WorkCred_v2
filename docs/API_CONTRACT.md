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

---

## 1. Authentication (`/auth`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `POST` | `/auth/signup` | Register new customer or worker | Public | Body: `role`, `name`, `email`, `phone`, `password`. Email lowercase unique. Phone non-unique contact. |
| `POST` | `/auth/login` | Authenticate using email and password | Public | Body: `email`, `password`, `role`. Role verified after password. Sets `wc_rt` cookie. |
| `POST` | `/auth/refresh` | Silent token refresh via rotating cookie | Public | Reads `wc_rt` cookie. Requires header `X-Requested-With: WorkCred`. Returns new access token. |
| `POST` | `/auth/logout` | Revoke active refresh session and clear cookie | Logged in | Requires header `X-Requested-With: WorkCred`. Clears `wc_rt` cookie. |
| `POST` | `/auth/password/change` | Update password with old password verification | Logged in | Body: `currentPassword`, `newPassword`. Increments `tokenVersion` to invalidate all sessions. |

---

## 2. Users (`/users`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/users/me` | Fetch active user profile and account details | Logged in | Includes profile completeness status computed on server. |
| `PATCH` | `/users/me` | Update personal profile details | Logged in | Body: bio, skills, rates, localityKey, radiusKm, calendar. Contact blocked on bio. |

---

## 3. Workers (`/workers`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/workers` | Search workers with filters | Logged in | Query: `skill`, `distance`, `rateMin`, `rateMax`, `rating`, `sort`. Masked/approximate only. |
| `GET` | `/workers/:id` | Fetch public worker profile view | Logged in | Phone number and exact coordinates are strictly omitted. |
| `GET` | `/workers/:id/passport` | View visible Passport records for worker | Logged in | Returns visible records only with masked employer names. |
| `GET` | `/workers/:id/passport/verify` | Run tamper-evident chain integrity check | Logged in | Evaluates all records (including private) server-side and reports `"Valid, N records"`. |

---

## 4. Jobs (`/jobs`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `POST` | `/jobs` | Post new open job | Customer | Body: `skill`, `workersNeeded`, `hours`, `startAt`, `offeredRate`, `description`, `location`. |
| `GET` | `/jobs` | List nearby open jobs matching worker skills | Worker | Returns distance, pay, spots left, start time. |
| `GET` | `/jobs/mine` | List jobs posted by active customer | Customer | Status list of open, filled, and cancelled jobs. |
| `POST` | `/jobs/:id/accept` | Accept an open job slot | Worker | Atomic slot decrement. |
| `POST` | `/jobs/:id/cancel` | Cancel posted job | Customer | Cancels unstarted bookings; workers see cancellation in booking list. |

---

## 5. Bookings (`/bookings`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `POST` | `/bookings` | Request direct booking for a worker | Customer | Body: `workerId`, `date`, `time`, `hours`, `note`. Generates AES-256-GCM encrypted codes. |
| `GET` | `/bookings` | List active user bookings | Logged in | Actionable counts for tabs (e.g., worker `My work (2)`, customer `Bookings (1)`). |
| `GET` | `/bookings/:id` | Detailed booking ticket | Participants only | Releases phone number and codes only when confirmed/in-progress. |
| `POST` | `/bookings/:id/confirm` | Worker accepts pending booking request | Worker | Transitions booking to `confirmed`. |
| `POST` | `/bookings/:id/start` | Worker submits 4-digit start handshake code | Worker | Body: `code`, `location` (optional). Checks <= 500m distance. Locks on 5 wrong tries. |
| `POST` | `/bookings/:id/finish` | Customer submits 4-digit finish code and rating | Customer | Body: `code`, `paidCash` (bool), `rating` (1-5), `comment`. Creates Passport record. |
| `POST` | `/bookings/:id/cancel` | Cancel booking prior to start | Participants only | Permitted only prior to start code verification. |
| `POST` | `/bookings/:id/report` | Submit problem report during or after booking | Participants only | Private report to support queue; contact blocked. |

---

## 6. Work Passport (`/passport`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/passport/me` | View worker's complete Passport timeline | Worker | Returns all records (visible and hidden), stats, and integrity result. |
| `PATCH` | `/passport/entries/:id` | Toggle entry visibility or employer name masking | Worker | Body: `visible` (bool), `maskEmployerName` (bool). Does not alter cryptographic hash. |

---

## 7. Free Now Availability (`/availability`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/availability/me` | Check active Free Now window for worker | Worker | Evaluates `expiresAt > now` at query time. |
| `POST` | `/availability` | Start or extend Free Now window | Worker | Body: `durationHours` (2, 4, or 8). Max 12h extension total. |
| `DELETE` | `/availability` | Stop active Free Now window | Worker | Closes live window immediately. |
| `GET` | `/availability/nearby` | View distance-sorted free workers nearby | Customer | Query: `distance` (default 3km, max 5km). Read-time expiry filtered. |

---

## 8. Fair Rate Compass (`/compass`)

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `GET` | `/compass` | Get rate guidance for skill and area | Logged in | Query: `skill`, `localityKey`. 3-tier fallback: localityKey -> cityKey -> sample baseline. |

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

| Method | Endpoint | Description | Access | Notes |
|---|---|---|---|---|
| `POST` | `/uploads/sign` | Generate server-signed Cloudinary direct upload payload | Logged in | Generates signature and timestamp bound to user folder. |

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
