# Session Summary: Phase B4 (Search, Fair Rate Compass, Jobs)

**Date:** 2026-10-16  
**Phase Completed:** Phase B4 (Search, Fair Rate Compass, Jobs - Backend Only)  
**Status:** Code Written & Ready for Verification (Tests written, NOT yet run)

---

## 1. What Was Built in Phase B4

### A. Core Mathematical & Business Rules (`shared/`)
1. **Compass Rate Unit Standardized (Decision G1, `shared/compassMath.js`):**
   - Converted baseline sample rates table to **RUPEES PER HOUR** (`daily / 8`, rounded) with explicit `SAMPLE` label.
   - Converted table: helper (75/94/113), electrician (100/125/163), plumber (100/125/156), mason (113/144/175), painter (94/119/150), carpenter (106/138/169), cook (88/113/144), cleaner (69/88/106), driver (100/125/150), vendor (75/100/125), other (81/106/138).
   - `hourlyEquivalent(hourly, daily)`: returns `hourly` if set > 0, else `round(daily / 8)`.
   - `fairLabel(rate, bounds)`: returns `low` if `< p25`, `high` if `> p75`, else `fair`.
   - `pickSource(localityStats, cityStats, baseline)`: 3-tier fallback picking first with `sampleSize >= 5`, else baseline with sample disclaimer.
2. **Job Rules & Scheduling Helpers (`shared/jobRules.js`):**
   - `intervalsOverlap(aStart, aHours, bStart, bHours)`: touching intervals do NOT overlap.
   - `hourBoundaries(startAt, hours)`: generates all hourly checkpoints for window availability check.
   - `isWindowAvailable(calendar, startAt, hours)`: verifies weekday schedule and blocked dates for every hour boundary.
   - `formatApproxDistance(meters)`: rounds to nearest 0.5 km with minimum `"under 1 km"`. Never returns coordinates.
   - `validateJobInput(body, context)`: validates job fields, 15m to 30d time window (G4), 1-10 workers, 1-12 hours, 50-100000 ₹/hr, checks contact blocking in description, and rejects unknown fields.
   - `encodeCursor(payload)` and `decodeCursor(cursorStr)`: URL-safe base64url cursor serialization with tamper-proofing.

### B. Endpoints Mounted under `/api/v1` (`backend/src`)
1. **Idempotency Middleware (`backend/src/middleware/idempotency.js`):**
   - Header `Idempotency-Key` (8-80 chars). Concurrent duplicate -> 409 `REQUEST_IN_PROGRESS`. Finished duplicate -> replay status/body with `Idempotent-Replay: true`. Reused key with different payload -> 422 `KEY_REUSED`. 5xx errors not stored. Applied to `POST /jobs`, `POST /jobs/:id/accept`, `POST /jobs/:id/cancel`.
2. **Worker Search (`GET /api/v1/workers`):**
   - `$geoNear` query on `searchLocation` (locality centroid, G2). Ties broken by `_id`. Batch Fair Rate hints. Excludes caller from own results. Excludes inactive/incomplete profiles. Returns approximate distances only. Rate limit: 120/10min.
3. **Worker Viewer Profile (`GET /api/v1/workers/:id`):**
   - Sanitized viewer profile: bio, stats, weekly calendar summary, count of blocked dates in next 14 days (not dates or reasons), empty endorsements object. 404 for missing/inactive/incomplete/invalid IDs. Rate limit: 120/10min.
4. **Fair Rate Compass (`GET /api/v1/compass`):**
   - 3-tier fallback (`locality` if >= 5, `city` if >= 5, else `baseline` with sample disclaimer). Service function `recomputeRateStats` queries completed bookings in past 90 days. Rate limit: 60/10min.
5. **Jobs Endpoints (`/api/v1/jobs`):**
   - `POST /jobs`: Customer only, 20/day limit, stores `searchLocation` = locality centroid, returns Fair Price hint without coordinates.
   - `GET /jobs`: Worker only. Matching skills, open, future, within radius, not accepted.
   - `GET /jobs/mine`: Customer only. Returns status (`open`, `filled`, `cancelled`, read-time `expired` G5), accepted workers list with display names (`"First L."`).
   - `POST /jobs/:id/accept`: Worker only. Conflict check against calendar and active bookings. Atomic slot claim (G7) with conditional pipeline update. Immediate confirmed booking creation (G6) with AES-256-GCM encrypted codes (`codesCrypto`, AAD bound to pre-generated booking `_id`). Rollback on conflict.
   - `POST /jobs/:id/cancel`: Customer owner only. Cancels job and confirmed bookings. Blocked with 409 `JOB_IN_PROGRESS` if work in progress. Repeated cancel is safe.

### C. Scripts and Tests
- `scripts/backfill-search-fields.js`: Backfills `mainSkill`, `rateHourlyEffective`, and `searchLocation` on existing users.
- `scripts/b4-check.js`: Comprehensive manual verification script against running server.
- `backend/tests/unit/shared/jobRules.test.js` & `compassMath.test.js`: Unit tests.
- `backend/tests/integration/b4.integration.test.js`: Integration tests for search ties, compass fallback, job posting, atomic claim (10 parallel accepts on 2 slots -> 2 OK, 8 JOB_FULL), idempotency replay, and cancel.
- Updated `backend/tests/helpers/privacyScanner.js` and authorization matrix in `auth.integration.test.js`.
