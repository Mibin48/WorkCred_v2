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
    "message": "Human readable error message"
  }
}
```

---

## 1. Authentication (`/auth`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/auth/signup` | Register new customer or worker with email, password, role, name, phone | Public |
| `POST` | `/auth/login` | Authenticate using email and password with role validation | Public |
| `POST` | `/auth/refresh` | Silent token refresh via rotating httpOnly cookie | Public (with cookie) |
| `POST` | `/auth/logout` | Revoke active refresh session and clear cookie | Logged in |
| `POST` | `/auth/password/change` | Update password with old password verification | Logged in |

---

## 2. Users (`/users`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/users/me` | Fetch active user profile and account details | Logged in |
| `PATCH` | `/users/me` | Update personal profile details (bio, skills, area, calendar) | Logged in |

---

## 3. Workers (`/workers`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/workers` | Search workers with filters (skill, distance, rate, rating) | Logged in |
| `GET` | `/workers/:id` | Fetch public worker profile view (phone/coords hidden) | Logged in |
| `GET` | `/workers/:id/passport` | View visible Passport records for worker | Logged in |
| `GET` | `/workers/:id/passport/verify` | Run tamper-evident chain integrity check | Logged in |

---

## 4. Jobs (`/jobs`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/jobs` | Post new open job with skill, hours, rate, location | Customer |
| `GET` | `/jobs` | List nearby open jobs matching worker skills | Worker |
| `GET` | `/jobs/mine` | List jobs posted by active customer | Customer |
| `POST` | `/jobs/:id/accept` | Accept an open job slot (atomic check) | Worker |
| `POST` | `/jobs/:id/cancel` | Cancel posted job and notify accepted workers | Customer |

---

## 5. Bookings (`/bookings`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/bookings` | Request direct booking for a worker | Customer |
| `GET` | `/bookings` | List active user bookings (tabbed states) | Logged in |
| `GET` | `/bookings/:id` | Detailed booking ticket (releases phone/codes per state) | Participants only |
| `POST` | `/bookings/:id/confirm` | Worker accepts pending booking request | Worker |
| `POST` | `/bookings/:id/start` | Worker submits 4-digit start handshake code | Worker |
| `POST` | `/bookings/:id/finish` | Customer submits 4-digit finish code, cash confirm, rating | Customer |
| `POST` | `/bookings/:id/cancel` | Cancel booking prior to start | Participants only |
| `POST` | `/bookings/:id/report` | Submit problem report during or after booking | Participants only |

---

## 6. Work Passport (`/passport`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/passport/me` | View worker's complete Passport timeline (visible & hidden) | Worker |
| `PATCH` | `/passport/entries/:id` | Toggle entry visibility to customers or mask employer name | Worker |

---

## 7. Free Now Availability (`/availability`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/availability/me` | Check active Free Now window for worker | Worker |
| `POST` | `/availability` | Start or extend Free Now window (2h, 4h, 8h) | Worker |
| `DELETE` | `/availability` | Stop active Free Now window | Worker |
| `GET` | `/availability/nearby` | View distance-sorted free workers nearby | Customer |

---

## 8. Fair Rate Compass (`/compass`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/compass` | Get 25th, median, 75th percentile rates for skill/area | Logged in |

---

## 9. Feed & Social (`/feed`, `/posts`, `/follows`, `/endorsements`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/feed` | Combined nearby feed (jobs, free workers, work posts) | Logged in |
| `POST` | `/posts` | Create verified work post with photo and caption | Worker |
| `GET` | `/posts/mine` | List posts created by active worker | Worker |
| `DELETE` | `/posts/:id` | Delete worker's own work post | Worker |
| `POST` | `/follows` | Follow or save worker / post | Logged in |
| `DELETE` | `/follows/:toId` | Remove follow or save | Logged in |
| `GET` | `/follows` | List followed or saved workers | Logged in |
| `POST` | `/endorsements` | Endorse worker skill (one-time post-completion) | Customer |

---

## 10. Uploads & Push (`/uploads`, `/push`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/uploads/sign` | Generate server-signed Cloudinary direct upload payload | Logged in |
| `POST` | `/push/subscribe` | Register web push subscription (future support) | Logged in |
| `DELETE` | `/push/subscribe` | Remove web push subscription | Logged in |

---

## 11. Reports & Moderation (`/reports`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/reports` | Submit abuse, safety, or profile report to support inbox | Logged in |

---

## 12. Health & Diagnostics (`/health`)

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/health` | Basic liveness check | Public |
| `GET` | `/health/ready` | Readiness check including database connectivity | Public |
