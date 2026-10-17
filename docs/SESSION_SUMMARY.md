# Session Summary: Phase B7 (Feed, Social, Endorsements, Reports)

**Date:** 2026-10-17  
**Phase Completed:** Phase B7 (Feed & Social, Endorsements, Content Reports - Backend Only)  
**Status:** Code Written & Verified (All tests written and passing; manual check scripts ready; backend feature-complete once accepted)

---

## 1. What Was Built in Phase B7

### A. Shared Pure Modules (`shared/`)
1. **`shared/postRules.js`**:
   - `validatePostInput(body, context)`: Enforces caption max 140 chars NFC, zero contact info (`containsContactInfo`), skill in worker's skills, and image URLs targeting Cloudinary.
   - `validatePhotoUrlByFolder(photoUrl, options)`: Shared validator parameterized by folder (`avatar` or `posts`). Enforces HTTPS, `res.cloudinary.com`, exact cloud name, exact user folder `workcred/<NODE_ENV>/<userId>/<folder>`, no query strings, no fragments.
2. **`shared/quotaRules.js`**:
   - `getIndiaDayKey(date)`: Formats date to `YYYY-MM-DD` in Asia/Kolkata (UTC+05:30) time.
   - `QUOTA_CAPS`: Authoritative limits: 10 daily posts, 100 active posts, 500 follows, 500 saves.
3. **`shared/endorsementEligibility.js`**:
   - `checkEndorsementEligibility(...)` & `getCanEndorseSkills(...)`: Validates that customer has at least one completed booking with worker for that skill and has not yet endorsed.
4. **`shared/feedCursor.js`**:
   - `encodeFeedCursor(payload, secret)` & `decodeFeedCursor(cursorStr, secret)`: HMAC-signed, tamper-evident opaque cursor over `(createdAt, id)`.
5. **`shared/reportRules.js`**:
   - Validates target types (`post`, `worker`), allowed reasons (`spam`, `inappropriate`, `fake`, `unsafe`, `other`), note <= 200 chars without contact info.
   - `hashClientIp(clientIp, secret)`: HMAC-SHA256 of IP using a subkey derived from `JWT_REFRESH_SECRET`. Raw IPs are never stored.
6. **`shared/followRules.js`**:
   - Validates follow type (`follow` | `save`) and blocks self-follow (`CANNOT_FOLLOW_SELF`).

### B. Core Services and Endpoints (`/api/v1`)
1. **Posts (`/posts`, `backend/src/routes/posts.js`, `postService.js`):**
   - `POST /posts`: Workers only, `profileComplete` required. Race-safe quota check: 10 daily (429 `POST_LIMIT_DAILY`), 100 active (409 `POST_LIMIT_ACTIVE`). Verified job link (403 `NOT_YOUR_JOB`, 409 `SKILL_MISMATCH`, 409 `BOOKING_ALREADY_POSTED`). Stored author locality centroid.
   - `GET /posts/mine`: Own posts newest first, cursor pagination.
   - `DELETE /posts/:id`: Owner only (others/unknown get identical 404). Decrements `activePostCount` safely (never below 0).
2. **Feed (`/feed`, `backend/src/routes/feed.js`, `feedService.js`):**
   - `GET /feed`: Unified endpoint with `nearby` and `following` tabs. Opaque cursor pagination.
   - Nearby tab: 10 km geographic radius from viewer origin. Distance formatted as approximate. First page includes non-paginated `highlights` (max 5 matching open jobs for workers, live Free Now workers for customers).
   - Following tab: Shows posts by workers followed by caller (`type === 'follow'`).
   - One batch query per page resolves `isFollowing` and `isSaved` flags. Inactive/incomplete workers filtered out everywhere.
3. **Follows (`/follows`, `backend/src/routes/follows.js`, `followService.js`):**
   - `POST /follows`: Idempotent follow/save worker. Caps at 500 (409 `FOLLOW_LIMIT`, 409 `SAVE_LIMIT`).
   - `DELETE /follows/:workerId`: Query `type=follow|save`. Decrements counter only on actual delete.
   - `GET /follows`: Search-style worker cards newest first with cursor pagination.
4. **Endorsements (`/endorsements`, `backend/src/routes/endorsements.js`, `endorsementService.js`):**
   - `POST /endorsements`: Customers only. Requires completed booking for skill (403 `NOT_ELIGIBLE`). Unique index prevents duplicate endorsements (409 `ALREADY_ENDORSED`). Atomic transaction updates endorsement and worker's `endorsementCounts`.
5. **Reports (`/reports`, `backend/src/routes/reports.js`, `reportService.js`):**
   - `POST /reports`: Reports post or worker. Suppresses duplicates within 24 hours. Self-report returns 400. Stored with `ipHash` and `reportedUserId`. Content remains visible pending support review.
6. **Hook Points Extended:**
   - `POST /uploads/sign`: Accepts `purpose: "post"` and locks folder to `workcred/<NODE_ENV>/<userId>/posts`.
   - `GET /workers/:id`: Returns `endorsements: { skill: count }`, `viewer: { isFollowing, isSaved }`, and customer `canEndorse: [skills]`.
   - `GET /workers` (search): Extended with `isFollowing` and `isSaved` in one batch query.

### C. Testing and Verification
- **Unit Tests:** 283 unit tests passing.
- **Integration Tests:**
  - `b7.integration.test.js`: 24/24 integration tests passing (parallel quota safety, delete ownership, feed radius, highlights, follows, endorsements atomic transaction, reports duplicate suppression, privacy scans).
  - `auth.integration.test.js`: Full authorization matrix test covering visitor, customer, worker roles across all routes.
  - `contract.test.js`: Contract parity test confirming all Express routes match `docs/API_CONTRACT.md` and all AppError codes are documented.
- **Manual Verification Scripts:**
  - `scripts/b7-check.js`: Standalone manual verification script against running server.
  - `scripts/check-all.js`: Master script running all check scripts (`auth-check`, `profile-check`, `b4-check`, `b5-check`, `b6-check`, `b7-check`).
