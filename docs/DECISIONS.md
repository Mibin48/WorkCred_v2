# Architectural Decisions Log

This document records key architectural, security, and product design decisions for WorkCred.

---

## 2026-10-16

### 1. Authentication Identifiers and Phone Role
- **Decision:** Login and sign-up use **email and password**. Phone number is a required contact field collected at registration (10 digits starting with 6-9), but is **not unique** and **not a login identifier**.
- **Rationale:** Aligns with PRD v3.2 / Design System v2.2 specifications and mitigates denial-of-service/lockout risks inherent to public phone numbers.

### 2. Verification Scope for V1
- **Decision:** Neither email nor phone number is verified (no SMS/email OTP gateways) in this version.
- **Rationale:** Strict focus on a self-contained local build running on localhost without external paid telecom gateways. Unverified phone numbers are kept private and released only after a booking is confirmed.

### 3. Role Assignment and Verification Order
- **Decision:** Role (`worker` or `customer`) is fixed at sign-up and cannot be toggled or altered. The user's role is checked **only after** password validity is confirmed.
- **Rationale:** Constant-time authentication and brute-force prevention; avoids leaking user role or account existence via pre-check role branching.

### 4. Backend Technology Stack
- **Decision:** The backend is built on **Node.js 20+**, **Express 4**, and **MongoDB (Mongoose 8)**, using native **ES Modules (ESM)** with **no build or compilation step**.
- **Rationale:** Simplicity, zero overhead, fast cold-starts, and direct parity with local Node environments.

### 5. Cash-First Payment Model
- **Decision:** The application strictly facilitates matching, scheduling, and proof of work. All monetary settlements are **cash only** directly between customer and worker. There are no digital wallets, commissions, QR codes, public pages, or external sharing links in this version.
- **Rationale:** Eliminates payment gateway compliance, KYC liabilities, and custodial money handling, preserving 100% of earnings for workers.

### 6. Feature Removal: Messaging and Alerts Center
- **Decision:** In-app inbox messaging, browser alerts, and background subscriptions are **completely removed** from the product scope for v1. No dedicated inbox collection, no browser subscription collection, no header alert icon, and no related message dispatch endpoints.
- **Rationale:** Smaller MVP; lists and live socket updates cover the need.
- **Replacement Behavior:**
  - Active booking and job status changes stream over Socket.io while connected.
  - Tab labels display actionable pending counts derived directly from bookings data (e.g. `My work (2)` for workers needing to respond; `Bookings (1)` for customers needing to provide code or payment confirmation).
  - Worker Home preserves "Needs your answer" prominently at top.
  - Header: Customers show initials account button only; workers show no action icons.

### 7. Global API Response and Cache Control Specifications (Phase B1)
- **Decision:** Every API endpoint strictly outputs `{ success: true, data: {}, message: "" }` or `{ success: false, error: { code: "", message: "", details?: [] } }`. All `/api/v1/*` responses include `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`. Errors never leak stack traces.
- **Rationale:** Uniform client error handling, zero information leakage in error flows, and absolute prevention of stale authenticated responses in intermediary or browser caches.

### 8. Work Passport Record Immutability Enforcement
- **Decision:** Immutability of Passport record content (`workerId`, `bookingId`, `seq`, `skill`, `date`, `hours`, `rating`, `comment`, `employerName`, `prevHash`, `hash`) is enforced via Mongoose pre-update middleware hooks rejecting any modifications targeting fields other than `visible` and `maskEmployerName`.
- **Rationale:** Guarantees append-only audit trail integrity at the database model layer so application bugs cannot tamper with historical records.

### 9. Scrypt Password Hashing and Concurrency Limiting (Phase B2)
- **Decision:** All user passwords are encrypted using `node:crypto` scrypt with a per-user 16-byte cryptographically secure salt, producing `scrypt$<saltHex>$<derivedKeyHex>`. Comparisons execute via `crypto.timingSafeEqual`. To protect system memory and the event loop against hash-flooding DoS, scrypt operations run through a concurrency cap limiting simultaneous hash jobs.
- **Rationale:** State-of-the-art memory-hard protection against ASIC/GPU offline cracking without risking Node.js process starvation under load.

### 10. Timing-Neutral Authentication and Dummy Verification (Phase B2)
- **Decision:** Unknown emails and incorrect passwords return identical HTTP 401 `INVALID_CREDENTIALS` error responses. When an unknown email is provided, a dummy scrypt verification against a pre-computed hash runs to normalize execution latency and eliminate account enumeration side-channel timing leaks.
- **Rationale:** Absolute prevention of user enumeration attacks.

### 11. Refresh Token HMAC Storage and Family Revocation (Phase B2)
- **Decision:** Refresh tokens are generated as 64-character random opaque hex strings and stored exclusively as keyed HMAC-SHA256 digests (`tokenHash`) using `JWT_REFRESH_SECRET`. Tokens rotate on every refresh. Replaying an already-consumed refresh token immediately revokes the entire session family (`revokedAt = now`) and returns `401 SESSION_INVALID`.
- **Rationale:** Defense against cookie theft and replay attacks while ensuring compromised or stolen tokens cannot maintain silent refresh access.

### 12. Server-Computed Profile Completeness (Phase B3)
- **Decision:** Profile completeness (`profileComplete`) is evaluated strictly by the server via pure function `isProfileComplete()` on every profile modification and profile fetch, never accepted from client inputs. Worker fields start empty with no fake defaults.
- **Rationale:** Prevents spoofed onboarding bypasses; ensures workers only appear in booking and matching pipelines when required skills, rates, locality, and radius are actually established.

### 13. Location Privacy and Exact Coordinate Secrecy (Phase B3)
- **Decision:** Exact GPS coordinates submitted by users (`{ lat, lng }`) within India bounds (lat 6-38, lng 68-98) are stored privately as GeoJSON points on the User document for internal radius queries, but are strictly scrubbed from all API responses (even for the owner). Callers receive only `localityKey`, `localityName`, and `hasExactLocation: true/false`. If coordinates are provided without a `localityKey`, the system automatically resolves the nearest locality within 25 km or prompts `CHOOSE_AREA`.
- **Rationale:** Safeguards worker and customer home locations against stalkerware, scraped geolocations, and frontend coordinate exposure.

### 14. Server-Signed Direct Browser Uploads to Cloudinary (Phase B3)
- **Decision:** Direct uploads to Cloudinary are authenticated via server-signed requests without including any third-party Cloudinary SDK. Signatures are computed using SHA-1 over sorted parameters with the API secret. Upload paths are rigidly locked server-side to `workcred/<NODE_ENV>/<userId>/avatar`. The server rejects avatar photo URLs that do not strictly target the authenticated user's assigned folder. If Cloudinary environment variables are absent, `/uploads/sign` responds with HTTP 503 `UPLOADS_DISABLED` without breaking profile functionality.
- **Rationale:** Zero server bandwidth or RAM consumed streaming binary photos, zero leakage of API secrets, and bulletproof user folder tenancy isolation.

### 15. Rate Unit Standardized on Rupees Per Hour (Phase B4 - G1)
- **Date:** 2026-10-16
- **Decision:** ALL price comparisons, rate filter evaluations, Fair Rate Compass benchmarks, and job calculations are conducted in **RUPEES PER HOUR**. A worker's effective hourly rate is evaluated as `hourlyRate` if set, otherwise `round(dailyRate / 8)`. Job `offeredRate` is rupees per hour per worker (total pay = `offeredRate * hours`). Completed bookings store `agreedRate` per hour. Sample baselines are converted from daily to hourly (`daily / 8`, rounded) and explicitly labelled SAMPLE.
- **Rationale:** Eliminates ambiguity and mismatch between daily-wage and hourly-wage workers, ensuring fair filtering, uniform compass guidance, and accurate job compensation calculations across the entire system.

### 16. Search Privacy: Locality Centroid Only (Phase B4 - G2)
- **Date:** 2026-10-16
- **Decision:** Workers are searched and indexed via `searchLocation` set strictly to the **centroid of their locality** (from `shared/localities.js`), NEVER their private exact coordinates. Distance calculations in search use the centroid, and returned distances are approximate (nearest 0.5 km, minimum "under 1 km"). Exact coordinates and GeoJSON geometries are never exposed in search or profile responses.
- **Rationale:** Prevents worker location triangulation, stalking, and home address reverse-engineering while maintaining realistic neighborhood-level matching.

### 17. Maintained Derived Worker Fields on Save (Phase B4 - G3)
- **Date:** 2026-10-16
- **Decision:** The profile service automatically maintains derived fields on save: `mainSkill` (first skill or designated main), `rateHourlyEffective` (`hourlyRate || round(dailyRate / 8)`), and `searchLocation` (locality centroid Point). Existing records are updated via `scripts/backfill-search-fields.js`.
- **Rationale:** Eliminates runtime re-computations in geo-queries and sorting pipelines, allowing high-performance compound indexing on `{ role: 1, rateHourlyEffective: 1 }` and `2dsphere` on `searchLocation`.

### 18. Job Start Time Boundaries (Phase B4 - G4)
- **Date:** 2026-10-16
- **Decision:** Job `startAt` must be at least 15 minutes ahead of the current time (`>= now + 15m`) and at most 30 days in the future (`<= now + 30d`), evaluated using the injectable clock. Stored in UTC; displays localized to India Standard Time (+05:30).
- **Rationale:** Prevents immediate impossible bookings, gives workers reasonable arrival windows, and avoids unbounded forward-dated ghost listings.

### 19. Read-Time Job Expiry (Phase B4 - G5)
- **Date:** 2026-10-16
- **Decision:** Job expiration is evaluated strictly at read-time: an open job where `startAt <= now` is treated as expired. It is filtered out from `GET /jobs` (search) and surfaced as `status: 'expired'` in `GET /jobs/mine`. No background cron or polling sweeper is required in Phase B4.
- **Rationale:** Minimizes operational complexity, avoids race conditions with background schedulers, and ensures zero stale jobs are ever presented to workers.

### 20. Immediate Confirmed Booking Creation on Job Accept with Encrypted Codes (Phase B4 - G6)
- **Date:** 2026-10-16
- **Decision:** Accepting a job creates the booking immediately with `status: 'confirmed'` and `source: 'job'`. Start and finish codes are 4-digit numbers generated via `crypto.randomInt`, encrypted using AES-256-GCM (`codesCrypto`) with Additional Authenticated Data (AAD) bound to `bookingId + ":" + ("start" | "finish")`. The booking `_id` is generated before insertion so the AAD can bind to it. Codes and exact locations are never returned in B4 responses.
- **Rationale:** Binds codes cryptographically to individual bookings, preventing code swapping attacks, while ensuring slot confirmation is immediate.

### 21. Atomic Slot Claim and Conflict Rollback (Phase B4 - G7)
- **Date:** 2026-10-16
- **Decision:** Claiming a job slot executes via a single atomic conditional update that increments `acceptedCount` only when `status === 'open'`, `startAt > now`, and `acceptedCount < workersNeeded`, flipping `status` to `'filled'` when `acceptedCount + 1 === workersNeeded`. If booking creation fails or worker calendar/booking clash checks fail post-claim, the increment is cleanly decremented and the job is reopened.
- **Rationale:** Guarantees zero overselling of job slots under high concurrency without requiring multi-document replica-set transactions.

### 22. Hidden Until Tapped Code Retrieval (Phase B5 - H1)
- **Date:** 2026-10-16
- **Decision:** Booking details returned by `GET /bookings/:id` never contain start or finish codes. A separate endpoint `GET /bookings/:id/codes` returns codes exclusively to the customer participant while status is `confirmed` or `in_progress` with `Cache-Control: no-store`.
- **Rationale:** Enforces "hidden until tapped" in UI, prevents shoulder-surfing, avoids caching codes in HTTP caches/service workers, and prevents workers from accessing codes ahead of arrival.

### 23. Cash Amount Calculation and Hours Worked (Phase B5 - H2)
- **Date:** 2026-10-16
- **Decision:** `cashAmount = agreedRate (rupees/hr) * bookedHours`. Passport hours = `hoursWorked = minutes(startedAt, finishedAt) / 60`, rounded to 2 decimals (never negative). Receipt wording is strictly "Cash payment reported by customer" (never "verified payment").
- **Rationale:** Prevents disputes over rate adjustments on cash handshakes; cleanly separates financial expectation from physical duration logged to the Passport.

### 24. Crockford Base32 Record ID (Phase B5 - H3)
- **Date:** 2026-10-16
- **Decision:** Every passport entry is assigned a unique 8-character Crockford base32 identifier (`recordId`, omitting ambiguous characters I, L, O, U). It is stored with a unique index. It is not derived from or included in the cryptographic hash, and no hash or fingerprint is ever returned by public endpoints.
- **Rationale:** Provides short, human-readable, auditable, and typo-resistant public references without leaking cryptographic hash chain internals.

### 25. Read-Time Booking Expiry and Missed States (Phase B5 - H4)
- **Date:** 2026-10-16
- **Decision:** A pending booking whose `scheduledAt <= now` is evaluated as `displayStatus: "expired"`. A confirmed booking whose execution window (`scheduledAt + hours`) has passed without starting is evaluated as `displayStatus: "missed"`. Neither blocks worker availability. Stored status remains unchanged; no cron job is required.
- **Rationale:** Eliminates ghost schedule locks without operational background worker overhead or race conditions with background schedulers.

### 26. Dynamic Contact and Job Location Release (Phase B5 - H5)
- **Date:** 2026-10-16
- **Decision:** Counterparty name and phone appear in `GET /bookings/:id` strictly while status is `confirmed` or `in_progress`. Email is never released. Exact job location `{ lat, lng, localityName }` is released exclusively to the worker participant while `confirmed` or `in_progress`.
- **Rationale:** Protects user privacy before confirmation and after completion/cancellation. This is the single, documented exception to the system-wide "no coordinates in responses" rule, enforced strictly by the privacy scanner.

### 27. Booking Source Tracking (Phase B5 - H6)
- **Date:** 2026-10-16
- **Decision:** Bookings created through the direct booking API have `source: "direct"`. Job board bookings have `source: "job"`. Future instant bookings will use `source: "freenow"`.
- **Rationale:** Cleanly identifies booking origin for UI tab filtering, audit tracking, and fee/guarantee policies across phases.

### 28. Passport Entry Chain Fields and Employer Masking (Phase B5 - H7)
- **Date:** 2026-10-16
- **Decision:** Passport entries store `workerId, bookingId, seq, recordId, skill, date, hours, rating, comment, employerName, visible, maskEmployer, prevHash, hash`. The SHA-256 hash strictly covers `employerName` (real customer name), but not presentation flags `visible` or `maskEmployer`. Pure helper `maskEmployerName("Ravi Kumar")` yields `"R*** K."`.
- **Rationale:** Secures the cryptographic integrity of the work record against retroactive forgery while allowing workers to safely curate their public profile visibility and anonymity settings.

### 29. Maintained Worker PassportStats and PassportHead (Phase B5 - H8)
- **Date:** 2026-10-16
- **Decision:** The worker document maintains `passportStats` (`jobs, totalHours, ratingSum, avgRating, skillCounts, topSkills`) and `passportHead` (`seq, hash`). `avgRating` is derived as `ratingSum / jobs` rounded to 2 decimals.
- **Rationale:** Enables fast worker search sorting by rating and job count without scanning passport entries.

### 30. Internal Quality Flags (Phase B5 - H9)
- **Date:** 2026-10-16
- **Decision:** Internal flags are computed on booking completion: `shortJob` (`hoursWorked < 0.25`) and `repeatedPair` (>=3 completed bookings between same customer and worker in last 30 days). Stored with `select: false` on Booking, never exposed to users.
- **Rationale:** Provides silent operational telemetry to flag potential collusion, spam, or platform gaming.

### 31. Worker Cancellation Counter and Warning (Phase B5 - H10)
- **Date:** 2026-10-16
- **Decision:** Cancelling a `confirmed` booking records a timestamp in `cancelledConfirmedAt`. Declining a `pending` booking does not count. When a worker accumulates 3 cancellations within 30 days, the cancel response returns a `warning: "REPEATED_CANCELLATIONS"`.
- **Rationale:** Deters unreliable last-minute worker cancellations without penalizing prompt declination of pending booking requests.

### 32. Multi-Document Transactions for Handshake Safety (Phase B5 - H11)
- **Date:** 2026-10-16
- **Decision:** Booking creation (overlap check + insert + worker `bookingGuard` update) and booking finish (booking completion + passport entry creation + worker head/stats update) execute inside MongoDB multi-document transactions with automated retry on `TransientTransactionError` (up to 5 attempts).
- **Rationale:** Guarantees zero double-booking, race conditions, gap/fork in passport entry sequences, or desynchronization between booking completion and passport issuance.

---

## 2026-10-17

### 33. Events Are Hints, Never Data (Phase B6 - J1)
- **Date:** 2026-10-17
- **Decision:** Socket.io event payloads carry IDs and display basics only. Clients refetch authoritative data over REST after receiving any event and after every (re)connect. The backend performs no message replay, queuing, or buffering of missed events.
- **Rationale:** Keeps realtime simple, idempotent, and resilient; REST remains the single source of truth so dropped or missed socket events never corrupt application state or lose data.

### 34. Free Now Location Privacy and Centroid Storage (Phase B6 - J2)
- **Date:** 2026-10-17
- **Decision:** Free Now availability windows store the worker's `searchLocation` (locality centroid GeoJSON Point), never their exact private residence point. In `GET /availability/nearby`, customer origin follows the B4 rule (exact private point if set, else locality centroid). Returned distances are approximate and rounded to the nearest 0.5 km. No coordinates are ever included in any API response or Socket event.
- **Rationale:** Prevents worker tracking or home location reverse-engineering while providing sufficient geographic precision for instant local matching.

### 35. Free Now Calendar Override and Blocked Dates (Phase B6 - J3)
- **Date:** 2026-10-17
- **Decision:** Going Free Now explicitly overrides the worker's recurring weekly availability pattern (active action beats passive pattern), but NOT explicit blocked calendar dates. If the current Indian calendar date is blocked, starting Free Now returns HTTP 409 `BLOCKED_TODAY`. Free Now instant bookings similarly bypass weekly availability rules while strictly respecting blocked dates.
- **Rationale:** Honors conscious, immediate worker availability without compromising worker vacation or explicitly blocked personal dates.

### 36. Deterministic Window Closure Triggers (Phase B6 - J4)
- **Date:** 2026-10-17
- **Decision:** A Free Now window closes under six specific conditions with tracked `closedReason`: worker stops it (`stopped`), window expires (`expired`), a Free Now booking is created (`booked`), worker confirms ANY direct booking (`confirmed`), worker accepts a job post (`accepted`), or worker starts a job (`started`). A declined or cancelled Free Now booking does NOT reopen the window (worker taps again).
- **Rationale:** Guarantees workers broadcasting live availability are genuinely ready to work right now and not engaged in parallel assignments.

### 37. Read-Time Expiry Rule Everywhere and Passive Sweeper (Phase B6 - J5)
- **Date:** 2026-10-17
- **Decision:** Expiry is strictly a read-time filter across all endpoints and queries (`expiresAt > now`). An in-process background sweeper running every 30 seconds atomically marks expired windows (`closedReason: "expired"`) and announces `radar:worker_busy` once. Correctness never relies on sweeper execution or MongoDB TTL index cleanup. All time calculations use the injectable `clock` module.
- **Rationale:** Guarantees zero latency in removing expired workers from searches even if the background sweeper is delayed or halted.

### 38. Grid Cell Rooms and Precise Server-Side Recipient Filtering (Phase B6 - J6)
- **Date:** 2026-10-17
- **Decision:** Socket.io rooms are partitioned by 0.05° geographic grid cells (`w:<cellX>:<cellY>` for workers, `c:<cellX>:<cellY>` for customers) as a coarse first filter. Clients cannot choose rooms or emit custom join events. Before emitting, the server evaluates pure filtering functions against per-socket cached memory data (role, skills, radius, exact distance).
- **Rationale:** Prevents client spoofing, prevents message leakage to uninterested clients, and enforces strict cryptographic privacy boundaries on real-time event dissemination.

### 39. Single Process Local Architecture (Phase B6 - J7)
- **Date:** 2026-10-17
- **Decision:** Built for a single Node.js process local instance. The in-process event bus and memory Socket.io adapter are self-contained. Multi-instance horizontal scaling would require a shared Redis/Mongo pub-sub adapter.
- **Rationale:** Simplicity and zero-dependency local development footprint in accordance with project constraints.

### 40. Free Now Booking Window Boundary and Immediate Confirmation (Phase B6 - J8)
- **Date:** 2026-10-17
- **Decision:** When creating a booking from Free Now (`fromFreeNow: true`), the booking's `scheduledAt` is set automatically to `clock.now() + 30 minutes` and must start before `window.expiresAt` (else HTTP 409 `FREE_WINDOW_ENDS_SOON`). The total requested booking hours (`hours`) are not constrained by the Free Now window duration. The worker must still explicitly confirm the booking.
- **Rationale:** Allows customers to book workers for substantive multi-hour jobs starting immediately while giving the worker final confirmation control.

### 41. Feed Shape and Highlights (Phase B7 - K1)
- **Date:** 2026-10-17
- **Decision:** Unified endpoint `GET /feed` with two tabs: `nearby` (default) and `following`. Both tabs are ordered newest first with cursor pagination (`nextCursor`). The first page of the `nearby` tab includes non-paginated `highlights` (max 5 items): for workers, nearest open jobs matching their skills (reusing the B4 jobs service); for customers, nearest live Free Now workers (reusing the B6 nearby service). Highlights return empty arrays when none are available, and are omitted on subsequent pages and on the `following` tab.
- **Rationale:** Delivers an engaging, consolidated home stream without chat/comments/likes complexity while driving discovery of immediate nearby economic opportunities.

### 42. Post Location Privacy and Nearby Geo Radius (Phase B7 - K2)
- **Date:** 2026-10-17
- **Decision:** A post stores the author's `searchLocation` (locality centroid, never the exact point) and `localityKey` at creation time. Nearby feed filters posts whose stored location is within 10 km of the viewer's origin (using the same origin rule as B4 search: private GPS point if set, else locality centroid). Distances are approximate and rounded using the shared helper. Exact coordinates are never returned.
- **Rationale:** Protects worker residential locations from triangulation while preserving community-level proof of work.

### 43. Author Inactivity Hiding and Hard Deletes (Phase B7 - K3)
- **Date:** 2026-10-17
- **Decision:** Posts of inactive workers or workers who are no longer `profileComplete` are automatically filtered out from all feed and social queries. Posts are hard deleted by their author. Any existing reports retain the `postId` and author `reportedUserId` so moderation and support can still take action.
- **Rationale:** Ensures stale or incomplete worker content does not degrade the feed experience, and respects worker rights to fully remove content.

### 44. Cloudinary Post Photo Path Isolation (Phase B7 - K4)
- **Date:** 2026-10-17
- **Decision:** Post photos upload directly to Cloudinary using the B3 signing flow with `purpose: "post"` and server-enforced folder `workcred/<NODE_ENV>/<userId>/posts`. Both `afterUrl` and `beforeUrl` must be HTTPS URLs targeting `res.cloudinary.com` inside that specific user's `posts` folder (no query strings, no cross-user folders, no alternate cloud names).
- **Rationale:** Enforces strict multi-tenant asset containment and prevents cross-user image spoofing or linking external unvetted resources.

### 45. Verified Job Association and Sparse Indexing (Phase B7 - K5)
- **Date:** 2026-10-17
- **Decision:** An optional `bookingId` marks a post as a verified job only if the booking status is `completed`, belongs to the posting worker, and matches the post's skill (403 `NOT_YOUR_JOB`, 409 `SKILL_MISMATCH`). A single booking can back at most one post, enforced by a unique sparse/partial index and 409 `BOOKING_ALREADY_POSTED`. The `bookingId` is never returned in any response; clients only receive `verifiedJob: true|false`.
- **Rationale:** Provides tamper-proof authenticity for genuine platform-completed jobs without leaking booking identifiers or customer transaction details.

### 46. Race-Safe Quota and Cap Enforcement (Phase B7 - K6)
- **Date:** 2026-10-17
- **Decision:** Quotas are enforced atomically using conditional MongoDB updates on counters stored directly on the User document (`activePostCount`, `postQuota: { dayKey, count }`, `followCounts: { follow, save }`), never read-then-insert alone. Daily post quota: 10 per India calendar day (IST, midnight rollover, 429 `POST_LIMIT_DAILY`). Active post cap: 100 per worker (409 `POST_LIMIT_ACTIVE`). Follow and save caps: 500 each per user (409 `FOLLOW_LIMIT`, 409 `SAVE_LIMIT`).
- **Rationale:** Prevents race conditions and spam flooding across concurrent client requests without distributed locks.

### 47. Endorsement Rules and Atomic Transaction Updates (Phase B7 - K7)
- **Date:** 2026-10-17
- **Decision:** Customers only. The caller must have at least one completed booking with that worker whose skill equals the endorsed skill (403 `NOT_ELIGIBLE`). Exactly one endorsement per customer, worker, and skill (unique index; 409 `ALREADY_ENDORSED`). No un-endorse in this version. Worker `endorsementCounts` (skill map) is updated atomically in the same multi-document transaction as the endorsement document insertion.
- **Rationale:** Guarantees peer-to-peer endorsements are strictly grounded in completed real-world work, immune to fake reviews, vote manipulation, or desynchronized counters.

### 48. Content Reporting and Privacy-Safe HMAC IP Hashing (Phase B7 - K8)
- **Date:** 2026-10-17
- **Decision:** Logged-in users can report posts or workers (`targetType: 'post' | 'worker'`). Client IP is never stored raw; it is saved as `ipHash` (HMAC-SHA256 of IP using a key derived from `JWT_REFRESH_SECRET`). Duplicate suppression: identical reporter, target, and reason within 24 hours returns success without creating a duplicate document. Self-reporting returns 400 `CANNOT_REPORT_SELF`. Content is not automatically hidden upon report creation (support reviews manually). Responses return a neutral acknowledgment without revealing reporter or target identities.
- **Rationale:** Provides reliable abuse reporting while protecting reporter privacy, user data, and preventing malicious denial-of-service deplatforming.

### 49. Zero Socket Events for Feed and Social in Phase B7 (Phase B7 - K9)
- **Date:** 2026-10-17
- **Decision:** Feed, follow, endorsement, and report events do NOT emit any Socket.io events. Clients refetch the feed via REST after creating or deleting posts.
- **Rationale:** Prevents high-frequency socket noise, maintains the "events are hints" architecture, and leaves socket bandwidth focused on high-priority live booking and safety handshakes.



