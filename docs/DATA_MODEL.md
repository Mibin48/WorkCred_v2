# WorkCred Data Model (MongoDB)

All primary identifiers are ObjectIds (`_id`). Geolocation fields use GeoJSON `Point` coordinates (`[longitude, latitude]`).

---

## Collections Specification

### 1. `users`
Customers and workers registered on the platform.

```javascript
{
  _id: ObjectId,
  email: String,            // Unique, lowercase, trimmed, indexed
  phone: String,            // Required 10 digits (6-9 first digit), NOT unique
  role: String,             // 'worker' | 'customer' (immutable once created)
  name: String,
  passwordHash: String,     // scrypt hash + salt (select: false)
  failedLoginCount: Number, // default 0
  lockUntil: Date,
  lockLevel: Number,        // default 0 (backoff levels)
  tokenVersion: Number,     // default 0 (incremented on logout/password change)
  mustChangePassword: Boolean,
  lastLoginAt: Date,
  photoUrl: String,
  location: {
    type: "Point",
    coordinates: [Number]   // [lng, lat]
  },
  localityKey: String,
  isActive: Boolean,        // default true
  isSample: Boolean,        // default false (true for seeded sample accounts)
  // Worker-specific attributes:
  skills: [String],         // 1 to 6 skills (from 11 recognized options)
  mainSkill: String,        // exactly one isMain (derived on save)
  hourlyRate: Number,       // integer 50 to 100000
  dailyRate: Number,        // integer 50 to 100000
  rateHourlyEffective: Number, // derived on save: hourlyRate || round(dailyRate / 8)
  searchLocation: {         // Centroid of worker's locality (from shared/localities.js)
    type: "Point",
    coordinates: [Number]   // [lng, lat]
  },
  bio: String,              // max 200 chars, no contact info
  radiusKm: Number,         // integer 1 to 10
  calendar: {
    weekly: {               // 'off' | 'morning' | 'afternoon' | 'evening' | 'full'
      mon: String,
      tue: String,
      wed: String,
      thu: String,
      fri: String,
      sat: String,
      sun: String
    },
    blockedDates: [{        // Max 60, sorted ascending YYYY-MM-DD
      date: String,         // 'YYYY-MM-DD'
      reason: String        // max 60 chars, no contact info
    }]
  },
  passportStats: {
    jobs: Number,           // starts at 0
    avgRating: Number,      // derived: ratingSum / jobs (2 decimals, starts at 0)
    ratingSum: Number,      // starts at 0 (H8)
    totalHours: Number,     // starts at 0
    skillCounts: Object,    // { [skill]: count } (H8)
    topSkills: [String]     // up to 3 skills sorted by count then name (H8)
  },
  passportHead: {
    seq: Number,            // starts at 0
    hash: String            // starts at 64 zeros ('0000...0000')
  },
  defaultMaskEmployerNames: Boolean, // default true
  penaltyCounters: {
    cancellations: Number
  },
  cancelledConfirmedAt: [Date], // Timestamps of confirmed cancellations in last 30d (select: false) (H10)
  profileComplete: Boolean, // Computed server-side on save
  // Phase B7: Feed, Social & Endorsements counters
  endorsementCounts: Map,   // Map of skill -> count (Number)
  activePostCount: Number,  // default 0, max 100
  postQuota: {
    dayKey: String,         // YYYY-MM-DD in India Standard Time
    count: Number           // max 10 per India calendar day
  },
  followCounts: {
    follow: Number,         // max 500
    save: Number            // max 500
  },
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:**
- `{ email: 1 }` (unique)
- `{ location: "2dsphere" }`
- `{ searchLocation: "2dsphere" }`
- `{ role: 1, isActive: 1, profileComplete: 1, skills: 1 }`
- `{ role: 1, "passportStats.avgRating": -1 }`
- `{ role: 1, rateHourlyEffective: 1 }`

---

### 2. `refreshTokens`
Active persistent refresh token sessions.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  familyId: String,
  tokenHash: String,        // HMAC-SHA256 keyed hash of refresh token (with JWT_REFRESH_SECRET)
  usedAt: Date,
  replacedByHash: String,
  revokedAt: Date,
  expiresAt: Date,
  createdAt: Date
}
```
**Indexes:**
- `{ tokenHash: 1 }` (unique)
- `{ expiresAt: 1 }` (TTL index)

---

### 3. `jobs`
Open work postings posted by customers for nearby workers.

```javascript
{
  _id: ObjectId,
  customerId: ObjectId,
  skill: String,
  workersNeeded: Number,    // 1 to 10
  acceptedCount: Number,    // atomic counter
  hours: Number,            // 1 to 12
  startAt: Date,
  offeredRate: Number,      // rupees per hour per worker
  description: String,      // max 300 chars, contact blocked
  location: {
    type: "Point",
    coordinates: [Number]   // Private customer exact coordinates or locality centroid
  },
  searchLocation: {
    type: "Point",
    coordinates: [Number]   // Centroid of locality
  },
  localityKey: String,
  status: String,           // 'open' | 'filled' | 'cancelled' | 'expired'
  isSample: Boolean,        // default false (true for seeded sample jobs)
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:**
- `{ location: "2dsphere" }`
- `{ searchLocation: "2dsphere" }`
- `{ status: 1, skill: 1, startAt: 1 }`

---

### 4. `bookings`
1-on-1 job engagements and direct booking contracts.

```javascript
{
  _id: ObjectId,
  jobId: ObjectId,          // optional (if converted from posted job)
  customerId: ObjectId,
  workerId: ObjectId,
  skill: String,
  localityKey: String,
  agreedRate: Number,
  scheduledAt: Date,
  hours: Number,            // 1 to 12
  note: String,             // max 200 chars, contact blocked
  status: String,           // 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  source: String,           // 'job' | 'direct' | 'freenow'
  isSample: Boolean,        // default false (true for seeded sample bookings)
  startCodeEnc: String,     // AES-256-GCM encrypted "v1:iv:tag:cipher", select: false
  finishCodeEnc: String,    // AES-256-GCM encrypted "v1:iv:tag:cipher", select: false
  startCodeAttempts: Number,// default 0
  startCodeLockUntil: Date, // select: false
  finishCodeAttempts: Number,// default 0
  finishCodeLockUntil: Date,// select: false
  startedAt: Date,
  startedGeo: {
    type: "Point",
    coordinates: [Number]   // null if not provided
  },
  farFromJob: Boolean,      // null if coords not provided; true if > 500m; false if <= 500m
  finishedAt: Date,
  hoursWorked: Number,      // minutes / 60 rounded to 2 decimals
  paidCash: Boolean,        // must be true to finish
  rating: Number,           // integer 1 to 5
  comment: String,          // max 200 chars, contact blocked
  locationSnapshot: {       // Copy of location: job point or customer private point/centroid (H5)
    type: "Point",
    coordinates: [Number]
  },
  localityName: String,
  cancelledBy: String,      // 'customer' | 'worker'
  cancelReason: String,
  flags: [String],
  shortJob: Boolean,        // hoursWorked < 0.25 (internal quality flag, select: false)
  repeatedPair: Boolean,    // >=3 completed bookings between pair in 30d (select: false)
  bookingGuard: Number,     // incremented on create for race safety (select: false)
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:**
- `{ workerId: 1, status: 1, scheduledAt: 1 }`
- `{ customerId: 1, status: 1, scheduledAt: 1 }`
- `{ jobId: 1, workerId: 1 }` (unique, sparse)

---

### 5. `passportEntries`
Append-only, cryptographically chained verified work records.

```javascript
{
  _id: ObjectId,
  workerId: ObjectId,
  recordId: String,         // Crockford base32 8-char random unique identifier (H3)
  bookingId: ObjectId,      // unique 1:1 binding to booking
  seq: Number,              // 1-indexed strictly increasing integer
  skill: String,
  date: Date,               // UTC midnight of booking startedAt
  hours: Number,            // hoursWorked
  rating: Number,           // integer 1 to 5
  comment: String,          // customer's review comment
  employerName: String,     // Real customer name (private, covered by cryptographic hash)
  employerDisplay: {
    name: String,
    masked: String          // e.g. "R*** K." (derived at read time)
  },
  maskEmployerName: Boolean,// default true (mutable by worker)
  visible: Boolean,         // default true (mutable by worker, not in hash)
  prevHash: String,         // SHA-256 hex string of previous entry (or 64 zeros)
  hash: String,             // SHA-256 hex string of canonical array per docs F4
  createdAt: Date
}
```
**Indexes:**
- `{ recordId: 1 }` (unique)
- `{ bookingId: 1 }` (unique)
- `{ workerId: 1, seq: 1 }` (unique)
- `{ workerId: 1, visible: 1, seq: -1 }`

---

### 6. `availability`
Ephemeral Free Now availability windows for workers (Phase B6).

```javascript
{
  _id: ObjectId,
  workerId: ObjectId,           // worker participant ref
  location: {
    type: "Point",
    coordinates: [Number]       // [lng, lat] = locality centroid (never exact private point)
  },
  localityKey: String,          // worker's locality key
  skills: [String],             // list of worker's skill names
  rateHourly: Number,           // worker's effective hourly rate at window creation
  startsAt: Date,               // clock now when window was started
  expiresAt: Date,              // window expiration time (startsAt + hours)
  active: Boolean,              // true if currently open, false when closed/expired
  closedReason: String,         // 'stopped' | 'expired' | 'booked' | 'confirmed' | 'accepted' | 'started' | null
  closedAt: Date,               // timestamp when window closed (or null)
  announcedBusy: Boolean,       // default false; set true when radar:worker_busy is emitted
  createdAt: Date
}
```
**Indexes:**
- `{ location: "2dsphere" }` (for `$geoNear` radius search in `GET /availability/nearby`)
- `{ expiresAt: 1 }` (TTL index with `expireAfterSeconds: 0`, passive database cleanup only)
- `{ workerId: 1 }` (unique, partialFilterExpression: `{ active: true }` — enforces strictly one live window per worker)
- `{ active: 1, expiresAt: 1 }` (for read-time filtering and background sweeper queries)

---

### 7. `rateStats`
Compass price distribution snapshots per skill and area (including city aggregations as localityKey `"city:<cityKey>"`).

```javascript
{
  _id: ObjectId,
  skill: String,
  localityKey: String,      // localityKey OR "city:<cityKey>"
  cityKey: String,
  p25: Number,
  median: Number,
  p75: Number,
  sampleSize: Number,
  isSeed: Boolean,
  updatedAt: Date
}
```
**Indexes:**
- `{ skill: 1, localityKey: 1 }` (unique)
- `{ skill: 1, cityKey: 1 }`

---

### 8. `posts`
Work showcase feed items with photos and optional job linkage.

```javascript
{
  _id: ObjectId,
  workerId: ObjectId,       // Worker who created the post
  skill: String,            // Must be one of the worker's skills
  caption: String,          // max 140 chars, NFC trimmed, contact blocked
  afterUrl: String,         // required Cloudinary URL in worker's posts folder
  beforeUrl: String,        // optional Cloudinary URL in worker's posts folder
  bookingId: ObjectId,      // optional link to completed verified job (sparse)
  verifiedJob: Boolean,     // true if backed by caller's completed booking
  isSample: Boolean,        // default false (true for seeded sample posts)
  localityKey: String,
  location: {               // Author's searchLocation (locality centroid)
    type: "Point",
    coordinates: [Number]   // [lng, lat]
  },
  createdAt: Date
}
```
**Indexes:**
- `{ createdAt: -1, _id: -1 }`
- `{ location: "2dsphere" }`
- `{ workerId: 1, createdAt: -1 }`
- `{ bookingId: 1 }` (unique, sparse partial: `{ bookingId: { $type: "objectId" } }`)

---

### 9. `follows`
Worker bookmarks and following relationships.

```javascript
{
  _id: ObjectId,
  fromId: ObjectId,         // Customer or worker follower
  toId: ObjectId,           // Target worker
  type: String,             // 'follow' | 'save'
  createdAt: Date
}
```
**Indexes:**
- `{ fromId: 1, toId: 1, type: 1 }` (unique)
- `{ fromId: 1, type: 1, createdAt: -1 }`
- `{ toId: 1, type: 1 }`

---

### 10. `endorsements`
Post-job skill endorsements from customer to worker.

```javascript
{
  _id: ObjectId,
  customerId: ObjectId,     // Customer who had a completed job with worker for skill
  workerId: ObjectId,       // Endorsed worker
  skill: String,            // Recognized platform skill
  createdAt: Date
}
```
**Indexes:**
- `{ customerId: 1, workerId: 1, skill: 1 }` (unique)
- `{ workerId: 1, skill: 1 }`

---

### 11. `reports`
Moderation submissions sent to the support queue.

```javascript
{
  _id: ObjectId,
  reporterId: ObjectId,     // Authenticated user submitting report
  targetType: String,       // 'post' | 'worker' | 'booking'
  targetId: ObjectId,
  reportedUserId: ObjectId, // Author of post or worker being reported
  reason: String,           // 'spam' | 'inappropriate' | 'fake' | 'unsafe' | 'other'
  note: String,             // max 200 chars, contact blocked
  ipHash: String,           // HMAC-SHA256 of client IP using key derived from JWT_REFRESH_SECRET
  createdAt: Date
}
```
**Indexes:**
- `{ targetType: 1, targetId: 1 }`
- `{ reporterId: 1, targetType: 1, targetId: 1, reason: 1, createdAt: -1 }`

---

### 12. `idempotencyKeys`
Deduplication cache for network retries and duplicate form taps.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  key: String,              // 8 to 80 chars
  route: String,
  requestHash: String,      // SHA-256 of normalized body
  state: String,            // 'processing' | 'done'
  responseSnapshot: {
    statusCode: Number,
    body: Object
  },
  createdAt: Date
}
```
**Indexes:**
- `{ userId: 1, key: 1, route: 1 }` (unique)
- `{ createdAt: 1 }` (TTL 24 hours)
