# Security Review: Phase B6 (Free Now & Realtime)

This document lists the critical security, privacy, and integrity modules and functions implemented in Phase B6 that the product owner must inspect line by line.

---

## 1. Socket.io Authentication & Connection Limits

### File: `backend/src/realtime/socketServer.js`
1. **`initSocketServer(httpServer, config)`**
   - *Guarantee:* Guarantees handshake authentication accepts tokens exclusively via `auth: { token }`, rejects URL query tokens with `AUTH_INVALID` without logging them, validates Origin against `FRONTEND_ORIGINS`, and enforces connection attempt and concurrent socket limits.
2. **`io.use(...)` (Connection Authentication Middleware)**
   - *Guarantee:* Guarantees that only active, unblocked users whose token claims match current database `tokenVersion` can connect, rejecting expired or invalid tokens with specific audit-logged error codes.
3. **`handleClientEvent(...)`**
   - *Guarantee:* Guarantees client events are rate-limited to 10 events per minute per socket, only `auth:refresh` and `rooms:refresh` are processed, and unknown events or unauthorized room join attempts are strictly ignored.
4. **`revalidateAll()`**
   - *Guarantee:* Guarantees that any connected socket whose associated database user became disabled or whose `tokenVersion` changed (such as after a password reset) is terminated immediately.

---

## 2. Realtime Recipient Filtering & Privacy Enclaves

### File: `backend/src/realtime/recipientFilter.js`
1. **`filterWorkersForJob(sockets, job)`**
   - *Guarantee:* Guarantees that job notifications are dispatched exclusively to workers who possess the required skill and whose individual service radius covers the distance to the job location.
2. **`filterCustomersForRadar(sockets, workerOrigin)`**
   - *Guarantee:* Guarantees that Free Now radar broadcast notifications reach only customer sockets located within exactly 5.0 km of the worker's locality centroid.

### File: `backend/src/realtime/payloadBuilders.js`
1. **`buildJobNewPayload`, `buildJobFilledPayload`, `buildRadarWorkerFreePayload`, `buildRadarWorkerBusyPayload`, `buildBookingPayload`**
   - *Guarantee:* Guarantees all emitted Socket.io payloads carry IDs and basic status indicators only, with zero personal contact details, emails, coordinates, or private tokens.

---

## 3. Free Now Window Lifecycle & Expiry

### File: `backend/src/services/freeNowService.js`
1. **`startFreeNowWindow({ workerId, hours, user })`**
   - *Guarantee:* Guarantees that only workers with completed profiles who have no in-progress bookings and no blocked calendar date today can start a window, storing the locality centroid location and enforcing strictly one live window per worker.
2. **`extendFreeNowWindow({ workerId, hours })`**
   - *Guarantee:* Guarantees that only active live windows can be extended and the total window duration cannot exceed the 12-hour limit via atomic conditional database update.
3. **`closeFreeNowWindow(workerId, reason)`**
   - *Guarantee:* Guarantees idempotent and atomic closure of an active window across all lifecycle triggers (`stopped`, `expired`, `booked`, `confirmed`, `accepted`, `started`), emitting `radar:worker_busy` only once.

### File: `backend/src/realtime/sweeper.js`
1. **`sweepOnce(now)`**
   - *Guarantee:* Guarantees expired windows are atomically closed with reason `expired` and announced as busy exactly once, without causing double-announcements or unhandled exceptions.

---

## 4. Free Now Booking & Nearby Query Privacy

### File: `backend/src/services/bookingService.js`
1. **`createDirectBooking(...)` (`fromFreeNow` branch)**
   - *Guarantee:* Guarantees that when booking from Free Now, `scheduledAt` cannot be provided by the client, is automatically set to `now + 30 minutes`, the worker has an active window that has not expired, and the window is atomically closed with reason `booked`.

### File: `backend/src/routes/availability.js`
1. **`GET /availability/nearby`**
   - *Guarantee:* Guarantees that only customers can query nearby Free Now workers, applying `$geoNear` strictly on active, unexpired windows with tamper-safe cursor pagination and returning approximate rounded distances without revealing coordinates or contact details.
