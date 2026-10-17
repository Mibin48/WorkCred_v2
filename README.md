# WorkCred

**Proof of work, work near you.**

WorkCred is a mobile-first web app where daily-wage workers build a verified work history and get hired nearby at fair prices, and customers find trusted help fast, with cash paid directly and no middleman.

---

## How It Works

1. **Verified work records:** A job is recorded only when both parties complete a two-code handshake (start code and finish code). Each record is appended to the worker's tamper-evident **Work Passport**.
2. **Real-time availability:** Workers tap **I'm Free Now** for 2, 4, or 8 hours, instantly visible to nearby customers.
3. **Fair Rate Compass:** Median and 25th–75th percentile price guidance per skill and locality from completed jobs.
4. **Cash only:** Direct customer-to-worker payment. No middleman, no digital wallet, no commissions.

---

## Running Locally

### Prerequisites
- Node.js 20+
- Git
- MongoDB Atlas cluster (free tier) or local MongoDB
- Cloudinary account (optional, for image uploads)

### Setup & Run
```bash
# Clone and enter repo
cd WorkCred

# Setup environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Run doctor and setup
npm run setup
npm run doctor

# Start local servers (Frontend on :3000, Backend on :4000)
npm start
```

---

## Backend Commands Reference (`backend/`)

All backend commands can be run from the `backend/` directory or at root using standard npm patterns:

### Setup & Startup
- `npm run setup`: Run backend initialization and environment check (`backend/scripts/setup.js`).
- `npm start`: Start backend server with environment variables (`node --env-file=.env src/server.js`).
- `npm run dev`: Start backend server in development mode with auto-reload (`node --env-file=.env --watch src/server.js`).

### Testing & Verification
- `npm test`: Run unit tests and contract smoke tests (`node --test tests/unit/**/*.test.js tests/smoke/**/*.test.js`).
- `npm run test:integration`: Run all MongoDB integration suites (`node --test tests/integration/**/*.test.js`).
- `npm run check:all`: Run master verification suite against a running local server (`auth-check`, `profile-check`, `b4-check`, `b5-check`, `b6-check`, `b7-check`).
- `node scripts/b7-check.js`: Run standalone B7 verification script against running local server.
- `node scripts/socket-watch.js`: Real-time socket event monitor CLI tool.

### Support & Maintenance Scripts
- `npm run support:reset-password`: Manually reset a user password via CLI.
- `npm run support:unlock`: Unlock a rate-limited or locked account via CLI.
- `node scripts/backfill-search-fields.js`: Backfill derived worker search fields (`mainSkill`, `rateHourlyEffective`, `searchLocation`).


---

## Project Delivery Phases

| Phase | Description |
|---|---|
| **1** | System Design & Documentation Context Pack |
| **B1–B7** | Backend Foundation, Auth, Jobs, Handshake, Passport, Compass, Feeds |
| **S1** | Shared Pure Modules (Validation, Integrity, Compass Math) |
| **I1–I6** | Frontend App Shell, Discovery, Handshake UI, Passport, Feeds, PWA |
| **N1** | In-App Notifications |
| **P1** | Brand, Assets & Design Polish |
| **D1** | Hardening, Concurrency Tests & Resilience |
| **H1** | Local Launch Readiness & Demo Script |
