# WorkCred Data Model (MongoDB)

All primary identifiers are ObjectIds (`_id`). Geolocation fields use GeoJSON `Point` coordinates (`[longitude, latitude]`).

---

## Collections Specification

### 1. `users`
Customers and workers registered on the platform.

```javascript
{
  _id: ObjectId,
  email: String,            // Unique, lowercase, indexed
  phone: String,            // Required contact field, not unique
  role: String,             // 'worker' | 'customer' (immutable once created)
  name: String,
  passwordHash: String,     // scrypt hash + salt (select: false)
  failedLoginCount: Number, // default 0
  lockUntil: Date,
  lockLevel: Number,        // default 0 (backoff levels)
  mustChangePassword: Boolean,
  lastLoginAt: Date,
  photoUrl: String,
  location: {
    type: "Point",
    coordinates: [Number]   // [lng, lat]
  },
  localityKey: String,
  isActive: Boolean,        // default true
  // Worker-specific attributes:
  skills: [String],         // 1 to 6 skills
  mainSkill: String,
  hourlyRate: Number,
  dailyRate: Number,
  bio: String,
  radiusKm: Number,         // default 5, max 10
  calendar: {
    weekly: [{
      day: String,          // 'Monday', 'Tuesday', ...
      slot: String          // 'Off' | 'Morning' | 'Afternoon' | 'Evening' | 'Full day'
    }],
    blockedDates: [Date]
  },
  passportStats: {
    jobs: Number,
    avgRating: Number,
    totalHours: Number,
    topSkills: [String]
  },
  passportHead: {
    seq: Number,
    hash: String
  },
  defaultMaskEmployerNames: Boolean, // default true
  penaltyCounters: {
    cancellations: Number
  },
  profileComplete: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:**
- `{ email: 1 }` (unique)
- `{ location: "2dsphere" }`
- `{ role: 1, isActive: 1, skills: 1 }`
- `{ role: 1, "passportStats.avgRating": -1 }`

---

### 2. `refreshTokens`
Active persistent refresh token sessions.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  familyId: String,
  tokenHash: String,        // SHA-256 hash of refresh token
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
  offeredRate: Number,
  description: String,      // max 300 chars
  location: {
    type: "Point",
    coordinates: [Number]
  },
  localityKey: String,
  status: String,           // 'open' | 'filled' | 'cancelled' | 'expired'
  createdAt: Date,
  updatedAt: Date
}
```
**Indexes:**
- `{ location: "2dsphere" }`
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
  agreedRate: Number,
  scheduledAt: Date,
  hours: Number,            // 1 to 12
  status: String,           // 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  startCodeEnc: String,     // AES-256-GCM encrypted (select: false)
  finishCodeEnc: String,    // AES-256-GCM encrypted (select: false)
  startCodeAttempts: Number,
  finishCodeAttempts: Number,
  codeLockUntil: Date,
  startedAt: Date,
  startedGeo: {
    type: "Point",
    coordinates: [Number]
  },
  farFromJob: Boolean,
  finishedAt: Date,
  hoursWorked: Number,
  paidCash: Boolean,
  rating: Number,           // 1 to 5
  comment: String,          // max 200 chars
  source: String,           // 'job' | 'direct' | 'freenow'
  locationSnapshot: {
    type: "Point",
    coordinates: [Number]
  },
  cancelledBy: ObjectId,
  cancelReason: String,
  flags: [String],
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
  bookingId: ObjectId,
  seq: Number,              // 1-indexed strictly increasing integer
  skill: String,
  date: Date,
  hours: Number,
  rating: Number,
  comment: String,
  employerDisplay: {
    name: String,
    masked: String          // e.g. "R*** K."
  },
  maskEmployerName: Boolean,// default true
  visible: Boolean,         // worker visibility toggle, default true
  prevHash: String,         // SHA-256 hash of previous entry (or GENESIS)
  hash: String,             // SHA-256 hash of canonical entry contents
  createdAt: Date
}
```
**Indexes:**
- `{ bookingId: 1 }` (unique)
- `{ workerId: 1, seq: 1 }` (unique)
- `{ workerId: 1, visible: 1, seq: -1 }`

---

### 6. `availability`
Ephemeral Free Now availability windows for workers.

```javascript
{
  _id: ObjectId,
  workerId: ObjectId,
  location: {
    type: "Point",
    coordinates: [Number]
  },
  skills: [String],
  rate: Number,
  startsAt: Date,
  expiresAt: Date,
  active: Boolean,
  createdAt: Date
}
```
**Indexes:**
- `{ location: "2dsphere" }`
- `{ expiresAt: 1 }` (TTL index)
- `{ workerId: 1, active: 1 }`

---

### 7. `rateStats`
Compass price distribution snapshots per skill and area.

```javascript
{
  _id: ObjectId,
  skill: String,
  localityKey: String,
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

---

### 8. `posts`
Work showcase feed items with photos and optional job linkage.

```javascript
{
  _id: ObjectId,
  workerId: ObjectId,
  skill: String,
  caption: String,          // max 140 chars
  afterUrl: String,         // required
  beforeUrl: String,        // optional
  bookingId: ObjectId,      // optional link to verified job
  verifiedJob: Boolean,
  location: {
    type: "Point",
    coordinates: [Number]
  },
  createdAt: Date
}
```
**Indexes:**
- `{ createdAt: -1, _id: -1 }`
- `{ location: "2dsphere" }`
- `{ bookingId: 1 }` (unique, sparse)

---

### 9. `follows`
Worker bookmarks and following relationships.

```javascript
{
  _id: ObjectId,
  fromId: ObjectId,
  toId: ObjectId,
  type: String,             // 'follow' | 'save'
  createdAt: Date
}
```
**Indexes:**
- `{ fromId: 1, toId: 1, type: 1 }` (unique)

---

### 10. `endorsements`
Post-job skill endorsements from customer to worker.

```javascript
{
  _id: ObjectId,
  customerId: ObjectId,
  workerId: ObjectId,
  skill: String,
  createdAt: Date
}
```
**Indexes:**
- `{ customerId: 1, workerId: 1, skill: 1 }` (unique)

---

### 11. `reports`
Moderation submissions sent to the support queue.

```javascript
{
  _id: ObjectId,
  targetType: String,       // 'worker' | 'customer' | 'post' | 'booking'
  targetId: ObjectId,
  reason: String,
  note: String,             // max 200 chars
  reporterId: ObjectId,     // optional
  ipHash: String,
  createdAt: Date
}
```
**Indexes:**
- `{ targetType: 1, targetId: 1 }`
- `{ createdAt: -1 }`

---

### 12. `idempotencyKeys`
Deduplication cache for network retries and duplicate form taps.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  key: String,
  route: String,
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

---

### 13. `pushSubscriptions`
Stored browser push notification endpoints.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  endpoint: String,
  keys: {
    p256dh: String,
    auth: String
  },
  createdAt: Date
}
```
**Indexes:**
- `{ endpoint: 1 }` (unique)
