# WorkCred Security & Cryptography Specification

**Version:** 1.0 · **Date:** 16 Oct 2026 · **Scope:** Backend Authentication, Session Management, Encryption, Hash Integrity & Data Design

---

## 1. Authentication & Session Architecture

### 1.1 Identity Model
- **Login Credentials:** `email` + `password`.
- **Email Rules:** Normalized to lowercase, trimmed, validated via standard email regex, unique index in MongoDB.
- **Phone Number Rules:** Required at registration as a contact field (`phone`). Validated as exactly 10 digits starting with 6, 7, 8, or 9 (`/^[6-9]\d{9}$/`). **Not unique** and **never used as a login identifier**.
- **Role Order & Constant Time:** Account role (`customer` | `worker`) is immutable. Role checking occurs **strictly after** password verification. Responses for unknown email and incorrect password are timing-neutral and identical: `"Email or password is wrong."`

### 1.2 Access & Refresh Token Management
- **Access Token:** Short-lived (15 minutes), signed JWT (`jose` library) using `JWT_ACCESS_SECRET`, held exclusively in client memory (never localStorage or IndexedDB).
  - Claims: `{ sub: userId, role: role, tokenVersion: int, iat, exp }`.
- **Refresh Cookie (`wc_rt`):**
  - Name: `wc_rt`
  - Lifespan: 30 days (`maxAge = 30 * 24 * 60 * 60 * 1000`). Absolute session maximum: 90 days.
  - Attributes: `httpOnly: true`, `SameSite: Lax`, `Path: /api/v1/auth`.
  - `Secure`: Enabled dynamically when `NODE_ENV === 'production'`.
  - Storage: Stored hashed (SHA-256) in MongoDB `refreshTokens` collection with token family tracking. Reusing an invalidated refresh token immediately revokes the entire token family.
  - Revocation: Increments user `tokenVersion` or marks family revoked upon explicit logout or password change.

### 1.3 CORS & Network Origin Boundaries
- **Cross-Origin Configuration:**
  - Strict exact-origin allowlist parsed from `FRONTEND_ORIGINS` (no wildcards `*`).
  - `credentials: true`.
  - Allowed Headers: `Content-Type`, `Authorization`, `X-Requested-With`, `Idempotency-Key`.
- **CSRF Defense:**
  - Token refresh (`POST /auth/refresh`) and logout (`POST /auth/logout`) strictly require the header:
    ```http
    X-Requested-With: WorkCred
    ```
  - Port `3000` (frontend) and Port `4000` (backend) sharing the same hostname (e.g., `localhost`) share same-site cookie context.
  - `localhost` and `127.0.0.1` must never be mixed within the same session.

---

## 2. Booking Handshake Code Cryptography

### 2.1 Encryption Parameters
- Handshake codes (4 digits: `0000` to `9999`) are generated via `node:crypto` using `crypto.randomInt(0, 10000)`.
- Key: `CODES_ENC_KEY` (32-byte cryptographically secure random key, base64-encoded in environment).
- Cipher: **AES-256-GCM** with a fresh, cryptographically random 12-byte IV for every code generation.

### 2.2 Storage Representation
Encrypted codes are stored in MongoDB as a single colon-delimited string:
```text
v1:<base64url(iv, 12 bytes)>:<base64url(authTag, 16 bytes)>:<base64url(ciphertext)>
```

### 2.3 Additional Authenticated Data (AAD)
To cryptographically bind the ciphertext to its specific booking and lifecycle stage, Additional Authenticated Data is enforced:
```text
AAD = bookingId.toString() + ":" + ("start" | "finish")
```
This guarantees that an encrypted start code cannot be replayed or substituted as a finish code, nor transplanted across different bookings.

### 2.4 Code Verification
- Decrypt ciphertext with AES-256-GCM using `CODES_ENC_KEY`, `iv`, `authTag`, and `AAD`.
- Compare candidate input with decrypted plaintext using `crypto.timingSafeEqual` over UTF-8 buffers.
- Rate limiting: 5 failed attempts per booking step triggers an atomic 10-minute lockout. Attempt counts are managed via atomic `$inc` operations in MongoDB.

---

## 3. Work Passport Hash Chain Integrity

### 3.1 Overview
The Work Passport is an append-only, tamper-evident audit ledger. Each entry is cryptographically chained to its predecessor. Verification traverses the entire sequence from genesis to head.

### 3.2 Canonical Hash Formula
The hash is computed over canonical JSON serialization of an array containing 10 fields in exact sequence:
```text
["v1", prevHash, seq, bookingId, skill, dateUTC, hoursToTwoDecimalsAsString, ratingInteger, commentTrimmedNFC, employerRealName]
```

Where:
- `v1`: Version literal string `"v1"`.
- `prevHash`: Hex string of previous entry's hash. For `seq === 1`, `prevHash` is 64 zeros (`"0000000000000000000000000000000000000000000000000000000000000000"`).
- `seq`: Integer sequence number (1, 2, 3...).
- `bookingId`: String representation of MongoDB ObjectId.
- `skill`: Normalized skill identifier string.
- `dateUTC`: Date string in `"YYYY-MM-DD"` format.
- `hoursToTwoDecimalsAsString`: Decimal hours formatted to exactly 2 decimal places (e.g., `"3.50"`, `"8.00"`).
- `ratingInteger`: Integer rating `1` to `5`.
- `commentTrimmedNFC`: Customer review comment, trimmed with Unicode NFC normalization.
- `employerRealName`: Real legal display name of employer (unmasked string).

> **Crucial Rule:** The hash input binds `employerRealName`, but does **not** bind `visible` or `maskEmployerName`. A worker toggling public visibility or masking on their profile alters display flags only and **never breaks the cryptographic hash chain**.

### 3.3 Reference Test Vector
The following test vector must be implemented in unit tests (`shared/test/passport-hash.test.js`) to guarantee bit-for-bit determinism:

**Input Array:**
```json
[
  "v1",
  "0000000000000000000000000000000000000000000000000000000000000000",
  1,
  "670f5e128b9c2a1122334455",
  "electrician",
  "2026-10-16",
  "3.50",
  5,
  "Great work fixing the distribution board.",
  "Ramesh Kumar"
]
```

**Serialized JSON String:**
```text
["v1","0000000000000000000000000000000000000000000000000000000000000000",1,"670f5e128b9c2a1122334455","electrician","2026-10-16","3.50",5,"Great work fixing the distribution board.","Ramesh Kumar"]
```

**Expected SHA-256 Digest (hex):**
```text
98ac98ecd2d07703d180823047245583f3c073ff47de9054327404aa45fafcbd
```

---

## 4. Shared Locality & Rate Compass Baseline Design

### 4.1 Locality Data Design (`shared/localities.js`)
All localities include an approximate geographic centroid and associate with an administrative `cityKey`:
```javascript
export const LOCALITIES = [
  { key: "kakkanad", name: "Kakkanad", cityKey: "kochi", lat: 10.0159, lng: 76.3419 }, // approximate, verify before use
  { key: "edappally", name: "Edappally", cityKey: "kochi", lat: 10.0243, lng: 76.3081 }, // approximate, verify before use
  { key: "vyttila", name: "Vyttila", cityKey: "kochi", lat: 9.9676, lng: 76.3197 },     // approximate, verify before use
  { key: "kaloor", name: "Kaloor", cityKey: "kochi", lat: 9.9939, lng: 76.2975 },       // approximate, verify before use
  { key: "palarivattom", name: "Palarivattom", cityKey: "kochi", lat: 10.0033, lng: 76.3089 }, // approximate, verify before use
  { key: "fort_kochi", name: "Fort Kochi", cityKey: "kochi", lat: 9.9658, lng: 76.2421 }, // approximate, verify before use
  { key: "aluva", name: "Aluva", cityKey: "kochi", lat: 10.1076, lng: 76.3516 },       // approximate, verify before use
  { key: "tripunithura", name: "Tripunithura", cityKey: "kochi", lat: 9.9500, lng: 76.3450 }, // approximate, verify before use
  { key: "maradu", name: "Maradu", cityKey: "kochi", lat: 9.9328, lng: 76.3267 },       // approximate, verify before use
  { key: "thevara", name: "Thevara", cityKey: "kochi", lat: 9.9333, lng: 76.2981 }      // approximate, verify before use
];
```

### 4.2 Sample Baseline Daily Rates Table (SAMPLE ONLY - Subject to Product Owner Review)

> [!IMPORTANT]
> **SAMPLE DATA DISCLAIMER:** The following rate figures represent baseline seed defaults for development, demonstrations, and cold-start fallback when local transaction samples are fewer than 5. These are **not** certified market wage statistics.

| Skill | p25 (₹/day) | Median (₹/day) | p75 (₹/day) | Label / Status |
|---|---|---|---|---|
| helper | 600 | 750 | 900 | SAMPLE BASELINE |
| electrician | 800 | 1000 | 1300 | SAMPLE BASELINE |
| plumber | 800 | 1000 | 1250 | SAMPLE BASELINE |
| mason | 900 | 1150 | 1400 | SAMPLE BASELINE |
| painter | 750 | 950 | 1200 | SAMPLE BASELINE |
| carpenter | 850 | 1100 | 1350 | SAMPLE BASELINE |
| cook | 700 | 900 | 1150 | SAMPLE BASELINE |
| cleaner | 550 | 700 | 850 | SAMPLE BASELINE |
| driver | 800 | 1000 | 1200 | SAMPLE BASELINE |
| vendor | 600 | 800 | 1000 | SAMPLE BASELINE |
| other | 650 | 850 | 1100 | SAMPLE BASELINE |

---

## 5. Contact Information Blocking Design (`containsContactInfo`)

### 5.1 Pipeline Steps
1. **Unicode NFKC normalization** and conversion to lowercase.
2. **Numeral Standardisation:** Map non-Latin digits (Devanagari `०-९`, Malayalam `൦-൯`) to standard ASCII digits `0-9`.
3. **Punctuation Stripping:** Remove delimiters (`.`, `-`, `_`, `(`, `)`, space, `/`, `\`) situated between digits.
4. **Heuristic Pattern Matchers:**
   - Digit run length: $\ge 7$ consecutive digits.
   - Word digit run: $\ge 6$ spelled-out number words in sequence (`zero`, `one`, `two`, `three`, `four`, `five`, `six`, `seven`, `eight`, `nine`).
   - Email regex: Standard email or phonetic disguise patterns (e.g., `word [at] domain [dot] com`, `word at domain dot com`).
   - URLs: `http://`, `https://`, `www.`, `wa.me/`, `t.me/`, `bit.ly/`, or `\b\w+\.(com|in|net|org|co|io|me)\b`.
   - Social Handles: Mentions of `whatsapp`, `telegram`, or `insta` followed within 20 characters by a 4+ digit number or `@handle`.
5. **Exceptions Permitted:** Common operational phrases (e.g., `"2 workers for 4 hours"`, `"Rs 1,200"`, `"3 PM to 6 PM"`, `"12/10/2026"`, `"room 204"`) must not be blocked.

---

## 6. Handshake Attempt Counting & Lockout Security (Phase B5)

### 6.1 Atomic Slot Reservation & Brute-Force Defense
Both start and finish handshakes use separate attempt counters (`startCodeAttempts`, `finishCodeAttempts`) and separate lockouts (`startCodeLockUntil`, `finishCodeLockUntil`):
1. **Atomic Attempt Reservation:**
   - Each guess initiates an atomic conditional update (`findOneAndUpdate`) using an aggregation pipeline that checks `status` and `lockUntil <= now`.
   - If the lock has expired, counters are reset to 1 atomically within the same operation (no window of vulnerability).
   - If active and under the limit, the attempt counter is incremented.
   - If 5 incorrect guesses are reached, `lockUntil` is set to `now + 10 minutes`.
2. **Comparison Cap:**
   - Exactly at most 5 attempts are ever compared per 10-minute window. Even if 50 parallel requests arrive, atomic slot reservation ensures only the first 5 are compared, and subsequent requests immediately return `429 CODE_LOCKED`.
3. **Timing Neutrality:**
   - Codes are compared using `crypto.timingSafeEqual` over fixed-length UTF-8 buffers to prevent timing side channels.

---

## 7. Multi-Document Transaction Architecture (Phase B5)

### 7.1 Booking Creation Overlap Safety
- Concurrent requests for the same worker slot run inside a MongoDB transaction (`tryTransaction`).
- The transaction queries existing `pending`, `confirmed`, and `in_progress` bookings for schedule clashes.
- To prevent serialization anomalies between read and insert, the transaction updates the target worker document (`$inc: { bookingGuard: 1 }`).
- Concurrent transactions for the same worker serialize at the database level; one succeeds, and the other retries and fails cleanly with `409 TIME_CLASH`.

### 7.2 Booking Finish & Passport Chain Linking
- The finish operation runs inside an atomic transaction:
  1. Conditionally updates booking from `in_progress` to `completed` with timestamps, hours worked, and quality flags.
  2. Inserts exactly one `passportEntries` document with `seq = worker.passportHead.seq + 1` and `prevHash = worker.passportHead.hash`.
  3. Updates the worker document with `passportStats` and conditionally sets `passportHead` matching the previous head sequence.
- If two finishes occur concurrently for the same worker across different bookings, the conditional head check forces serialization; one commits, and the second retries seamlessly with the new head sequence, preventing chain forks or sequence gaps.
- Post-commit, `recomputeRateStats` is invoked asynchronously outside the transaction; failures are logged without rolling back the completed handshake.

---

## 8. Geolocation Privacy Exception (H5)

### 8.1 Single Documented Exception Rule
- Standard API responses across the entire system are prohibited from returning latitude, longitude, or raw coordinates (strictly verified by automated privacy scanners).
- **The Sole Exception:** `GET /bookings/:id` returns `jobLocation: { lat, lng, localityName }` strictly to the worker participant, and strictly while the booking status is `confirmed` or `in_progress`.
- The customer never receives worker coordinates. In all other booking states (`pending`, `completed`, `cancelled`, `expired`, `missed`), `jobLocation` is omitted from the response.

---

## 9. Realtime & Free Now Security Architecture (Phase B6)

### 9.1 Realtime Handshake Authentication
1. **Handshake Token Only:** Access tokens are accepted exclusively within the handshake auth payload: `auth: { token: "<jwt>" }`.
2. **Query String Rejection:** Passing a token in query parameter `?token=...` is immediately rejected with `AUTH_INVALID` and discarded without being logged.
3. **CORS and Origin Allowlist:** Checked strictly against `FRONTEND_ORIGINS`. An absent Origin header is accepted (native apps/testing); an unlisted Origin header is rejected with `AUTH_INVALID`.
4. **Credential Verification:** The JWT is verified using `JWT_ACCESS_SECRET`. The database is queried to guarantee the user exists, is active (`isActive: true`), and that the token's `tokenVersion` matches the current record in the database.

### 9.2 Realtime Security Limits & DoS Mitigation
1. **Connection Attempts:** Limited to a maximum of 30 connection attempts per minute per IP address (`RATE_LIMITED`).
2. **Simultaneous Sockets:** Capped at 5 concurrent socket connections per user (`TOO_MANY_CONNECTIONS`).
3. **Payload Buffering:** Max HTTP buffer size is pinned to 10 KB (`maxHttpBufferSize`) to avoid memory exhaustion attacks.
4. **Client Event Rate Limiting:** A connected socket may send at most 10 events per minute. Sending more immediately disconnects the socket with reason `RATE_LIMITED`.
5. **No Client Room Joins:** Clients cannot emit join or leave room events. Any unrecognized client events are silently ignored.

### 9.3 In-Process Recipient Filtering & Privacy Enclaves
1. **Coarse Grid Cells:** Sockets automatically join server-assigned rooms based on 0.05° geographic grid cells (`w:<x>:<y>` for workers, `c:<x>:<y>` for customers) and personal room `user:<userId>`.
2. **Fine Server Filtering:** Before broadcasting any event, the server extracts target candidate sockets from cell rooms and executes pure mathematical filter functions (`recipientFilter.js`) against cached server-memory metadata:
   - `filterWorkersForJob`: Verifies worker has matching skill and that distance between job locality centroid and worker origin point does not exceed the worker's configured `radiusKm`.
   - `filterCustomersForRadar`: Verifies distance between worker's locality centroid and customer origin point is within 5.0 km.
3. **Events as Hints (J1):** Domain events carry only IDs and minimal display status. Payloads never include contact numbers, email addresses, names beyond established list items, notes, or coordinates. Clients refetch authoritative data via authenticated REST endpoints.

### 9.4 Token Lifetime, Revalidation, and Grace Period
1. **Token Lifetime & Grace Period:** Sockets track token expiration (`exp`). If token expiration has passed by more than 60 seconds without an `auth:refresh` exchange, the socket is severed with reason `AUTH_EXPIRED`.
2. **Token Refresh:** Clients send `auth:refresh` with a freshly signed token. The server verifies that the new token belongs to the identical user and matches current `tokenVersion`. Supplying a different user's token or invalid token disconnects the socket.
3. **Periodic Revalidation (`revalidateAll`):** Every 60 seconds, the server re-queries active connected users from MongoDB. Any user account that was disabled (`isActive: false`) or whose `tokenVersion` was incremented (e.g., following a password change or security revocation) is terminated immediately with `AUTH_INVALID`.

### 9.5 Free Now Privacy and Centroid Constraints (J2)
1. **Centroid Storage:** The `availability` document stores `location` as the centroid of the worker's selected locality (`searchLocation`), never the worker's private exact residence coordinates.
2. **Approximate Distances:** Customer distances to Free Now workers in `GET /availability/nearby` are computed using Haversine math and formatted into rounded human-readable approximations (e.g., `"2.5 km away"`), preventing trilateration attacks.

---

## 10. Feed, Social, Endorsements, and Reports Security Architecture (Phase B7)

### 10.1 Post Media Path Enforcement (K4)
1. **Server-Signed Upload Flow:** Direct image uploads to Cloudinary require signed credentials obtained via `POST /uploads/sign` with `purpose: "post"`.
2. **Deterministic Folder Tenancy:** The server exclusively issues upload signatures for the path:
   ```text
   workcred/<NODE_ENV>/<userId>/posts
   ```
   Clients cannot override or customize the folder parameter.
3. **Strict URL Validation:** When creating a post, both `afterUrl` and `beforeUrl` are validated against strict regex:
   - Must use `https://`.
   - Host must be `res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>`.
   - Path must start with `/image/upload/` followed by optional transformation tags, followed strictly by `workcred/<NODE_ENV>/<userId>/posts/<filename>`.
   - Query strings and URL fragments are forbidden.
   - Any attempt to use another user's folder or the `avatar` folder returns `400 VALIDATION_ERROR`.

### 10.2 Verified Job Integrity & Information Isolation (K5)
1. **Pre-requisites:** An optional `bookingId` marks a post as a verified job only if:
   - The booking exists and its status is `completed`.
   - The booking's `workerId` strictly equals the posting worker (`403 NOT_YOUR_JOB`).
   - The booking's `skill` exactly matches the post's `skill` (`409 SKILL_MISMATCH`).
2. **One-to-One Job Verification:** A completed booking can back at most one post, enforced by unique partial index `{ bookingId: 1 }` with `{ partialFilterExpression: { bookingId: { $type: "objectId" } } }` and application check `409 BOOKING_ALREADY_POSTED`.
3. **Data Isolation:** The `bookingId`, customer identity, and booking financial details are **never returned** in post or feed responses. API responses only expose `verifiedJob: true | false`.

### 10.3 Post & Social Abuse Prevention: Atomic Quota Guard (K6)
1. **Daily Post Quota:** Maximum 10 posts per India calendar day (IST, reset at 00:00:00 IST).
2. **Active Post Cap:** Maximum 100 active posts per worker.
3. **Atomic Conditional Updates:** All quota checks and increments occur in single atomic MongoDB operations on the `users` document:
   ```javascript
   User.findOneAndUpdate(
     { _id: user._id, activePostCount: { $lt: 100 }, 'postQuota.dayKey': todayKey, 'postQuota.count': { $lt: 10 } },
     { $inc: { activePostCount: 1, 'postQuota.count': 1 } }
   );
   ```
   If the limit is exceeded, an atomic read determines whether to return `429 POST_LIMIT_DAILY` or `409 POST_LIMIT_ACTIVE`.
4. **Follow and Save Caps:** Users are capped at 500 follows and 500 saves. Follow creations conditionally check `{ 'followCounts.follow': { $lt: 500 } }` returning `409 FOLLOW_LIMIT` or `409 SAVE_LIMIT`.

### 10.4 Tamper-Proof Endorsements & Multi-Document Transactions (K7)
1. **Eligibility Gate:** Customers only (`403 FORBIDDEN_ROLE`). Customer must possess at least one completed booking with the worker for that specific skill (`403 NOT_ELIGIBLE`).
2. **Single Endorsement Guarantee:** Compound unique index `{ customerId: 1, workerId: 1, skill: 1 }`. Duplicate submissions return `409 ALREADY_ENDORSED`.
3. **Atomic Counter Sync:** Endorsement insertion and the worker's `endorsementCounts.<skill>` increment execute inside a MongoDB multi-document transaction with automated retry. If the update fails, the endorsement rolls back completely.

### 10.5 Abuse Reporting & IP Privacy (K8)
1. **HMAC Client IP Hashing:** The client IP is **never** stored in plaintext. It is stored as `ipHash`, derived via HMAC-SHA256:
   ```javascript
   const ipHmacKey = crypto.createHmac('sha256', JWT_REFRESH_SECRET).update('workcred:report:ip_key').digest();
   const ipHash = crypto.createHmac('sha256', ipHmacKey).update(clientIp).digest('hex');
   ```
2. **Duplicate Suppression:** Submitting identical reports (`reporterId`, `targetType`, `targetId`, `reason`) within a 24-hour window returns the same success response (`"Report received. Support will review it."`) without creating a duplicate record or altering review status.
3. **Privacy Enforcement:** Responses never echo target details, notes, or identify who reported whom. Automated privacy scanners assert that `ipHash`, `reporterId`, and `reportedUserId` are forbidden from all client responses.



