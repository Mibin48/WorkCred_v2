# Phase B7 Security Review: Feed, Social, Endorsements & Reports

This document lists the exact files and functions introduced or modified in Phase B7 that must be read and verified line-by-line, with the core invariant each must guarantee.

---

### 1. `shared/postRules.js`
- **Function:** `validatePostInput(body, context)`
  - **Guarantee:** Guarantees post input conforms to strictly bounded constraints: caption length <= 140 chars with Unicode NFC normalization, zero contact numbers/emails/links (via `containsContactInfo`), skill strictly in worker's declared skill set, and image URLs strictly conform to `validatePhotoUrlByFolder(url, { folder: 'posts', ... })`.
- **Function:** `validatePhotoUrlByFolder(photoUrl, options)`
  - **Guarantee:** Guarantees image URLs are HTTPS, target `res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>`, belong strictly to `workcred/<NODE_ENV>/<userId>/<folder>`, possess no query strings or fragments, and prevent cross-tenant folder access (e.g. avatar folder used for posts or vice versa).

### 2. `shared/quotaRules.js`
- **Function:** `getIndiaDayKey(date)`
  - **Guarantee:** Computes deterministic `YYYY-MM-DD` date keys pinned strictly to India Standard Time (UTC+05:30), ensuring daily quota rollover triggers exactly at midnight IST.
- **Constant:** `QUOTA_CAPS`
  - **Guarantee:** Centralizes authoritative race-safe quotas: 10 daily posts per worker, 100 active posts per worker, 500 follows per user, 500 saves per user.

### 3. `shared/endorsementEligibility.js`
- **Function:** `checkEndorsementEligibility({ customerId, workerId, skill, completedBookings, existingEndorsements })`
  - **Guarantee:** Asserts that an endorsement can only be granted by a customer who completed at least one verified booking with the target worker for that specific skill, and blocks duplicate endorsements for the same customer, worker, and skill.

### 4. `shared/feedCursor.js`
- **Function:** `encodeFeedCursor(payload, secret)` & `decodeFeedCursor(cursorStr, secret)`
  - **Guarantee:** Guarantees pagination cursor `{ createdAt, id }` is opaque and cryptographically tamper-evident using HMAC-SHA256 signatures, rejecting manipulated or forged cursors with HTTP 400 `BAD_CURSOR`.

### 5. `shared/reportRules.js`
- **Function:** `validateReportInput(body)`
  - **Guarantee:** Restricts report target types to `post` and `worker` (rejecting `booking` with 400), validates allowed reason codes (`spam`, `inappropriate`, `fake`, `unsafe`, `other`), caps notes at 200 chars NFC, and rejects contact information in notes.
- **Function:** `hashClientIp(clientIp, secret)`
  - **Guarantee:** Hashes caller IP addresses using HMAC-SHA256 keyed from `JWT_REFRESH_SECRET`, ensuring raw IP addresses are never persisted or exposed.

### 6. `backend/src/services/postService.js`
- **Function:** `createPost({ body, user, config })`
  - **Guarantee:** Enforces worker role and profile completion, atomically increments and verifies race-safe daily (10) and active (100) quotas on the User document, verifies completed booking ownership and skill matching for verified jobs, stores author locality centroid (never exact coordinates), and logs audit event `post_created`.
- **Function:** `deletePost({ postId, user })`
  - **Guarantee:** Allows only the post owner to delete their post, returns identical 404 for non-owners, missing, or invalid IDs, hard deletes the post document, decrements `activePostCount` safely (never below 0), and logs audit event `post_deleted`.

### 7. `backend/src/services/feedService.js`
- **Function:** `getFeed({ user, query })`
  - **Guarantee:** Filters out posts from inactive or incomplete workers, enforces 10 km geographic radius from viewer origin on nearby tab without ever returning raw coordinates, loads highlights (max 5 matching open jobs for workers, live Free Now workers for customers) only on page 1 of nearby tab, and batch-queries `isFollowing` and `isSaved` flags in a single database roundtrip.

### 8. `backend/src/services/followService.js`
- **Function:** `followWorker({ fromUser, workerId, type })`
  - **Guarantee:** Prevents self-following (400 `CANNOT_FOLLOW_SELF`), rejects non-worker or inactive targets with 404, atomically enforces the 500 cap per type (`FOLLOW_LIMIT`, `SAVE_LIMIT`), handles idempotent repeat calls without duplicate counts, and logs audit event `follow_added`.
- **Function:** `unfollowWorker({ fromUser, workerId, type })`
  - **Guarantee:** Idempotently removes follow/save record, safely decrements the corresponding counter only when a record was actually deleted, and logs audit event `follow_removed`.

### 9. `backend/src/services/endorsementService.js`
- **Function:** `createEndorsement({ customer, workerId, skill })`
  - **Guarantee:** Restricts caller to customers, verifies completed booking eligibility, and inserts endorsement record while atomically incrementing the worker's `endorsementCounts.<skill>` in a MongoDB transaction with automatic rollback on error.

### 10. `backend/src/services/reportService.js`
- **Function:** `createReport({ reporter, body, clientIp, secret })`
  - **Guarantee:** Prevents self-reports (400 `CANNOT_REPORT_SELF`), verifies target existence (returning uniform 404), suppresses duplicates within 24 hours without creating secondary records, stores `reportedUserId` and `ipHash` with zero raw IPs, and returns neutral acknowledgment without revealing reporter or target identities.

### 11. `backend/tests/helpers/privacyScanner.js`
- **Function:** `assertNoSensitiveFields(obj)`
  - **Guarantee:** Recursively traverses all API responses and asserts absolute absence of forbidden keys: `email`, `phone`, `lat`, `lng`, `coordinates`, `location`, `bookingId`, `tokenVersion`, `lockUntil`, `hashes`, `ipHash`, `reportedUserId`, and `reporterId`.
