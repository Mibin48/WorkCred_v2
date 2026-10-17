# Session Summary: Phase B6 (Free Now and Realtime)

**Date:** 2026-10-17  
**Phase Completed:** Phase B6 (Free Now & Realtime over Socket.io - Backend Only)  
**Status:** Code Written & Ready for Verification (Tests written, NOT yet run)

---

## 1. What Was Built in Phase B6

### A. Shared Pure Modules (`shared/`)
1. **Area Cells & Grid Math (`shared/areaCells.js`):**
   - `cellFor(lat, lng)`: Pure calculation converting coordinates into 0.05° grid cells.
   - `ringSizeFromRadius(radiusKm)`: Calculates cellular ring depth (`ceil(radiusKm / 5.5)`, minimum 1, capped at 2 for workers, 1 for customers).
   - `ringCells(centreCell, ringSize)`: Computes concentric grid cell coordinates.
   - `roomName(type, cellX, cellY)`: Standardizes room identifiers (`w:<x>:<y>`, `c:<x>:<y>`, `user:<id>`).
2. **Free Now Rules (`shared/freeNowRules.js`):**
   - `validateHours(hours)`: Restricts initial window duration strictly to 2, 4, or 8 hours.
   - `validateExtendHours(hours)`: Restricts extension requests strictly to 1, 2, or 4 hours.
   - `canExtend(startsAt, expiresAt, addHours, maxHours)` / `remainingExtendableHours`: Enforces total window lifetime cap of 12 hours.
   - `minutesLeft(expiresAt, now)`: Computes integer minutes remaining (ceils fractional minutes; returns 0 if expired).
   - `windowIsLive(window, now)`: Read-time live window check (`active === true && expiresAt > now`).
3. **Payload Builders (`backend/src/realtime/payloadBuilders.js`):**
   - Minimalist, privacy-compliant payload formatters strictly containing IDs and display basics for `job:new`, `job:filled`, `radar:worker_free`, `radar:worker_busy`, and `booking:*` domain events.
4. **Recipient Filters (`backend/src/realtime/recipientFilter.js`):**
   - `filterWorkersForJob(candidateSockets, job)`: Selects workers with matching skill and distance within their individual `radiusKm`.
   - `filterCustomersForRadar(candidateSockets, workerOrigin, maxRadiusKm)`: Selects customers within 5.0 km of the worker's locality centroid.

### B. Free Now Service & Endpoints (`/api/v1/availability`)
1. **Model & Indexes (`backend/src/models/Availability.js`):**
   - Stores worker's `searchLocation` (locality centroid GeoJSON Point; never exact residence coordinates).
   - Indexes: `2dsphere` on `location`; TTL index on `expiresAt` (`expireAfterSeconds: 0`); unique partial index on `{ workerId: 1 }` where `{ active: true }` (strictly one live window per worker); compound `{ active: 1, expiresAt: 1 }`.
2. **Endpoints (`backend/src/routes/availability.js`):**
   - `GET /availability/me`: Workers only. Returns `{ window, serverTime }`. Expired windows read as `null`.
   - `POST /availability`: Workers only (requires `profileComplete`). Validates `hours` (2, 4, 8), ensures no booking is in progress (409 `JOB_IN_PROGRESS`), ensures today is not blocked (409 `BLOCKED_TODAY`), closes any expired window atomically, enforces one live window (409 `ALREADY_FREE`), and publishes `radar:worker_free`. Rate limit: 20 changes/hour.
   - `POST /availability/extend`: Workers only. Extends live window by 1, 2, or 4 hours up to 12 hours total duration (409 `EXTEND_LIMIT` with `remainingHours`). Atomic conditional update.
   - `DELETE /availability`: Workers only. Stops the window (idempotent; returns success). Publishes `radar:worker_busy` once with `reason: "stopped"`.
   - `GET /availability/nearby`: Customers only. Radius 1-5 km (default 3), optional skill filter, tamper-safe cursor pagination. Uses `$geoNear` with read-time `expiresAt > now` filter. Returns formatted approximate distances, rating, jobs count, and `canBookNow` (`minutesLeft > 30`). Coordinates and contact info strictly omitted. Rate limit: 120 req / 10 min.
3. **Hooks & Window Closure (`closeFreeNowWindow`):**
   - Atomic conditional update marking `active: false`, recording `closedReason` and `closedAt`, and publishing `radar:worker_busy` once.
   - Integrated into:
     - Booking from Free Now: `POST /bookings` with `fromFreeNow: true` closes window with reason `booked`.
     - Direct booking confirmation: `POST /bookings/:id/confirm` closes window with reason `confirmed`.
     - Direct booking start: `POST /bookings/:id/start` closes window with reason `started`.
     - Job board acceptance: `POST /jobs/:id/accept` closes window with reason `accepted`.

### C. Realtime Engine Over Socket.io (`backend/src/realtime`)
1. **Socket Server (`socketServer.js`):**
   - Handshake authentication via `auth: { token }`. Query parameter tokens rejected (`AUTH_INVALID`) and never logged.
   - CORS origin verification against `FRONTEND_ORIGINS`.
   - DoS caps: max 5 simultaneous sockets per user (`TOO_MANY_CONNECTIONS`), max 30 connection attempts per minute per IP (`RATE_LIMITED`), 10 KB buffer limit.
   - Client event rate limit: 10 events/minute per socket (`RATE_LIMITED` disconnect). Accepted client events: `auth:refresh` and `rooms:refresh`.
   - Disconnects sockets after 60 seconds grace period post-token expiry (`AUTH_EXPIRED`).
   - Background revalidation (`revalidateAll()`) every 60 seconds terminates sockets belonging to disabled users or incremented `tokenVersion`.
2. **Event Bus & Subscriber (`eventBus.js`, `subscriber.js`):**
   - In-process domain event bus (`eventBus`). Subscriber wraps socket emits in try/catch; emission failures are logged and never fail HTTP requests.
   - Dispatches Section 15 domain events (`job:new`, `job:filled`, `radar:worker_free`, `radar:worker_busy`, `booking:*`).
3. **Background Sweeper (`sweeper.js`):**
   - Evaluates expired windows every 30 seconds and once at startup.
   - Atomically updates `active: false, closedReason: "expired", announcedBusy: true` and broadcasts `radar:worker_busy` once. Exposes `sweepOnce()` for testing.

### D. Verification Tests & Manual Scripts
1. **Test Suite (`backend/tests/integration/b6.integration.test.js`):**
   - 26 comprehensive integration tests against real listening server and `MongoMemoryReplSet`.
   - Free Now lifecycle, 10 parallel window create race conditions, extend limits, read-time expiry pagination walk over 25 workers with heavy ties, sweeper idempotency, socket handshake security, token expiration grace period, rate limiters, revalidation, and targeted audience filtering.
2. **Manual Check Scripts (`scripts/`):**
   - `scripts/b6-check.js`: 10-step interactive script verifying multi-socket event delivery, targeting, Free Now lifecycle, booking from Free Now, and sweeper DB expiry.
   - `scripts/socket-watch.js`: Realtime CLI listener for inspecting received socket events with timestamps.
