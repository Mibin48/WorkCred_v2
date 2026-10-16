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
