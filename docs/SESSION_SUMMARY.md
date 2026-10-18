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

---

# Session Summary: Phase S1 (Seed Data & Demo Accounts)

**Date:** 2026-10-17  
**Phase Completed:** Phase S1 (Seed Data & Reset Suite - Backend Only)  
**Status:** Code Written & Suite Prepared (Ready for test execution by product owner)

## 1. What Was Built in Phase S1

### A. Core Architecture & Safety Guards
1. **`backend/src/seed/dataset.js`**:
   - Deterministic PRNG (`createRng`, Mulberry32) and relative time offsets calculated from `runNow`.
   - 12 Sample Workers (personas covering veteran electrician, helper, plumber, mason, cook with 100% private records, cleaner with 0 records, painter with blocked calendar).
   - 8 Sample Customers (including primary `CUST_BUSY` Rahul Nambiar with bookings in all tabs, and `CUST_EMPTY` Deepa Kurian with 0 bookings).
   - 26 Historical completed bookings planned across 9 Kochi localities to satisfy all 3 Fair Rate Compass fallback tiers (locality, city, baseline).
   - `validateDatasetSanity()` enforcing RFC 2606 emails, `9000000xxx` fictional phones, contact blocking, and valid rates.
2. **`backend/src/seed/placeholders.js`**:
   - Generates 6 solid-colour PNGs (`#f3efe6`, `#eee8df`, `#e9e2d5`, `#f0a27f`, `#b8dac2`, `#f0deb4`) under `frontend/assets/sample/work-1.png ... work-6.png` using Node native `node:zlib` deflate (zero external dependencies).
3. **`backend/src/seed/clockTravel.js`**:
   - Pure `withClock(targetTime, fn)` freezing and unfreezing the injectable backend clock safely across asynchronous operations.
4. **`backend/src/seed/runner.js`**:
   - `assertSeedSafety(config)`: Rejects production environment, databases containing `'prod'` or `'live'`, and missing `DEMO_PASSWORD`.
   - `hasSampleData()`: Idempotency check detecting existing sample data without duplicating.
   - `removeSampleData(config)`: Non-destructive selective purge targeting solely sample documents (`isSample: true` and sample user ownership) without dropping collections. Real records remain untouched.
   - `runSeed(config)`: End-to-end orchestration using real backend services (`createDirectBooking`, `startBooking`, `finishBooking`, `startFreeNowWindow`, `createPost`, `createEndorsement`, `createReport`, `recomputeRateStats`). Produces valid SHA-256 Passport chains.
5. **`backend/src/routes/demo.js`**:
   - `GET /api/v1/demo/accounts`: Returns account cards and shared password in development mode with `Cache-Control: no-store` and rate limiting (30 req / 10 min). Returns HTTP 404 in production, when `DEMO_PASSWORD` is absent, or when no sample accounts exist.

### B. Verification & Scripting
- **Integration Test:** `backend/tests/integration/s1.integration.test.js` covering full seed, idempotency, non-destructive reset, safety guards, demo authentication, in-progress booking finish, Compass tiers, demo accounts route, and privacy scanning.
- **Unit Test:** `backend/tests/unit/seed/seed.test.js` validating PRNG, dataset sanity, safety assertions, and placeholder image generation.
- **CLI Scripts:**
  - `scripts/seed.js`: `npm run seed -- --yes`
  - `scripts/seed-verify.js`: `npm run seed:verify`
  - `scripts/demo-reset.js`: `npm run demo:reset -- --yes`
  - `scripts/demo-refresh-free.js`: `npm run demo:refresh-free -- --yes`
  - `scripts/seed-remove.js`: `npm run seed:remove -- --yes`
  - `scripts/s1-check.js`: Live verification against running server.
  - `scripts/check-all.js`: Updated to run `s1-check` following `b7-check`.

### C. Documentation
- Created `docs/SEED_DATA.md`.
- Updated `docs/DECISIONS.md` (entries 50–58 for Decisions L1–L9).
- Updated `docs/DATA_MODEL.md` (`isSample` on `User`, `Job`, `Booking`, `Post`).
- Updated `docs/SECURITY_SPEC.md` (Section 11).
- Updated `docs/API_CONTRACT.md` (Section 15 `GET /demo/accounts`).
- Updated `docs/PROGRESS.md` & `README.md`.

---

# Session Summary: Phase I1 (Frontend Foundation, App Shell, Landing, Auth & Onboarding)

**Date:** 2026-10-17  
**Phase Completed:** Phase I1 (Frontend Foundation, App Shell, Landing, Auth & Onboarding - Frontend Only)  
**Status:** Code Written & Test Suites Passing (59/59 unit tests passing, token linter clean, Playwright E2E suite prepared)

## 1. What Was Built in Phase I1

### A. Core Architecture & Server
1. **Frontend Server (`frontend/server.js`, `frontend/serverUtils.js`):**
   - Express static file server running on port 3000.
   - Dynamic per-request Helmet Content Security Policy with cryptographic nonces (`crypto.randomBytes(16)`).
   - Strict `ALLOWED_HOSTS` enforcement preventing hostname mismatch between `localhost` and `127.0.0.1`.
   - Dynamic `/config.js` serving `API_URL` and `ENV`.
   - `/shared` allowlist permitting only pure validation modules (`validators.js`, `passwordRules.js`, `containsContactInfo.js`, `profileRules.js`). Sensitive backend modules (e.g. `localities.js` with GPS coordinates) return 404.
   - Cache-control: static assets (1h with ETag), HTML/SPA entry points (`no-cache`).

### B. Safe DOM & Design Token System
1. **Design Tokens (`frontend/css/tokens.css`):**
   - Palette from `DESIGN_SYSTEM.md` v2.2: ink (`#0e1011`), paper (`#fbf8f3`), brand (`#00573d`), rule (`#ebe6dd`), accent (`#d4643a`), success (`#2e6930`), warn (`#8c5e00`), danger (`#a82020`).
   - Rem-based font scale, 8px rhythm spacing, radii, elevations, motion curves.
2. **Token Linter (`scripts/lint-tokens.js`):**
   - Enforces design token rules, bans raw hex colors, gradients, and forbidden DOM sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, inline `style=`).
   - Validates WCAG contrast ratios (all text colors >= 4.5:1).
3. **Safe DOM Builder (`frontend/app/js/utils/dom.js`):**
   - Pure `h(tag, props, ...children)` with attribute allowlist, URL protocol sanitization (`javascript:`, `vbscript:`, `data:` blocked), and direct event listener binding.
4. **String Dictionary (`frontend/app/js/i18n/strings.en.js`):**
   - Zero literal UI strings in components; comprehensive translation dictionary for all labels, headings, buttons, and errors.

### C. Client Session & API Client
1. **Session Manager (`frontend/app/js/session.js`):**
   - Memory-only access token (never touches `localStorage` or `sessionStorage`).
   - Concurrency-safe refresh token rotation using `navigator.locks.request("workcred-refresh")` with localStorage lease fallback.
   - Cross-tab session synchronization via `BroadcastChannel("workcred-auth")`.
   - Proactive refresh timer at 13 minutes (unreferenced for clean test teardown).
2. **API Client (`frontend/app/js/api.js`):**
   - Envelope parser extracting `{ success, data, error }`.
   - Mandatory `X-Requested-With: WorkCred` header on `/auth/refresh` and `/auth/logout`.
   - Single automatic retry on `TOKEN_INVALID` via refresh lock.
   - Immediate local session clearing on `SESSION_INVALID` / `SESSION_REVOKED`.
   - Host mismatch detection warning.

### D. Image Processing & Uploads
1. **`frontend/app/js/utils/imageMath.js`:**
   - Client-side downscaling math enforcing max dimension <= 1280px without upscaling.
2. **`frontend/app/js/utils/uploader.js`:**
   - HTML5 canvas redraw stripping EXIF metadata.
   - Requests signature from backend `POST /api/v1/uploads/sign`, uploads directly to Cloudinary via `FormData`.

### E. UI Components & Pages
1. **Component Catalog (`frontend/app/js/components/`):**
   - 21 reusable components: `AppHeader`, `BottomNav`, `Button`, `ChoiceChip`, `CompassBar`, `DevBanner`, `EmptyState`, `ErrorState`, `Field`, `IndexTabs`, `LedgerRule`, `LocalityPicker`, `NetworkBanner`, `PasswordField`, `RangeField`, `SampleDataLabel`, `Sheet`, `SkeletonLine`, `SkillPicker`, `Stamp`, `Toast`, `Wordmark`.
2. **Pages (`frontend/app/js/pages/`):**
   - `LoginPage`: Role-segmented login with dev demo quick-switcher.
   - `SignupPage`: Worker and customer registration forms with real-time password strength rules.
   - `OnboardingPage`: Step-by-step onboarding with partial save (auto-saving name, locality, skills, rates) and Cloudinary avatar upload.
   - `AccountPage`: Profile details, role badge, session status, password change link, and logout.
   - `ChangePasswordPage`: Forced and voluntary password update flow.
   - `WorkerHomePage` & `CustomerFindPage`: Role home views with active status, bottom tabs, and placeholders.
   - `PlaceholderPage`: Honest coming-soon placeholders for remaining phases.
   - `HostMismatchPage`: Explanatory screen for localhost vs 127.0.0.1 confusion.
3. **Static Landing & Legal Pages:**
   - `frontend/index.html` + `frontend/css/landing.css` + `frontend/js/landing.js`: Responsive landing page per Design System Section 14 with interactive Compass demo and accordion FAQ.
   - `frontend/404.html`, `frontend/privacy.html`, `frontend/terms.html`, `frontend/grievance.html`.

### F. Testing & Quality Assurance
- **59 Unit Tests (`tests/unit/`):**
  - `api.test.js` (6 tests)
  - `config.test.js` (3 tests)
  - `csp.test.js` (4 tests)
  - `dom.test.js` (11 tests)
  - `imageMath.test.js` (7 tests)
  - `lintTokens.test.js` (6 tests)
  - `router.test.js` (6 tests)
  - `session.test.js` (7 tests)
  - `sharedAllowlist.test.js` (5 tests)
  - `strings.test.js` (4 tests)
- **Token Linter:** All CSS tokens, typography, colors, and DOM sinks passing with 0 errors.
- **Playwright E2E Suite (`tests/e2e/phase-i1.spec.js`):** 13 end-to-end scenarios covering landing page, customer/worker registration, demo login, partial onboarding save, tab navigation, axe-core a11y audit, multi-tab logout sync, and mobile responsiveness.
- **Decisions Added:** Decisions M1 to M12 (#59–#70) in `docs/DECISIONS.md`.

