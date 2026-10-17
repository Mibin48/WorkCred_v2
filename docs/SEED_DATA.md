# Phase S1: Seed Data & Demo Accounts Specification

This document details the deterministic sample dataset implemented for local testing, demo flows, and offline development.

---

## 1. Overview & Guarantees

Phase S1 populates the database with realistic, honestly labelled sample data (`isSample: true`) covering every user state, booking tab, job status, Free Now window, and Compass rate coverage scenario without requiring real external participants or payment systems.

- **Non-Destructive Reset:** Reset and removal purge exclusively records flagged with `isSample: true` or owned by sample accounts. Real users, real bookings, and real posts are strictly untouched.
- **Cryptographic Integrity:** All 26 completed historical bookings generate valid, verified SHA-256 Passport chains (`runChainVerification` passes for all sample workers).
- **Zero Real Secrets:** All sample accounts authenticate with a shared development password defined in `.env` via `DEMO_PASSWORD`.
- **Fictional & Safe Persona Design:** All emails use RFC 2606 reserved `.example.com` domains; all phone numbers use `9000000xxx` fictional ranges; all captions and notes pass `containsContactInfo` checks.

> [!WARNING]
> **Synthetic Phone Numbers Warning:** Sample phone numbers (`9000000xxx`) are completely fictional. Never attempt to dial, message, or send SMS/OTP to these numbers.

> [!NOTE]
> **Fictional Rate Numbers:** All hourly and daily rates in sample records and Compass baselines are fictional and intended solely for user interface validation and testing.

---

## 2. Seeded Account Directory

All accounts authenticate with `DEMO_PASSWORD` (default: `DemoPassword123#`).

### 2.1 Sample Workers (12 Accounts)

| Key | Name | Email | Phone | Locality | Main Skill | Completed Jobs | Demo Persona / Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **E1** | Suresh Menon | `suresh.menon.sample@example.com` | `9000000101` | Kakkanad | Electrician | 14 | Veteran electrician; 4 endorsements; 3 hidden records; verified posts; live 8h Free Now window. |
| **E2** | Manoj Pillai | `manoj.pillai.sample@example.com` | `9000000102` | Kakkanad | Electrician | 0 | In-progress booking participant; 2 cancellations in last 30d (warns on 3rd); report target. |
| **P1** | Shaji Mathew | `shaji.mathew.sample@example.com` | `9000000103` | Vyttila | Plumber | 5 | Plumber with bookings across Vyttila & Kaloor; live 4h Free Now window; far-from-job booking. |
| **P2** | Biju K. | `biju.k.sample@example.com` | `9000000104` | Palarivattom | Plumber | 2 | Plumber with Palarivattom bookings for city-level Compass distribution. |
| **H1** | Anoop Raj | `anoop.raj.sample@example.com` | `9000000105` | Edappally | Helper | 8 | Top-rated helper; 2 endorsements; live 2h Free Now window; verified work posts. |
| **H2** | Sreejith Mohan | `sreejith.mohan.sample@example.com` | `9000000106` | Edappally | Helper | 0 | Helper with 0 completed jobs for empty profile stats testing. |
| **M1** | Vijayan Joseph | `vijayan.joseph.sample@example.com` | `9000000107` | Aluva | Mason | 1 | Mason with exactly 1 completed job; expired Free Now window; missed appointment. |
| **PA1** | Thomas Mathew | `thomas.mathew.sample@example.com` | `9000000108` | Tripunithura | Painter | 0 | Painter with blocked calendar today to test `BLOCKED_TODAY` guard. |
| **C1** | Harikrishnan P. | `harikrishnan.p.sample@example.com` | `9000000109` | Fort Kochi | Carpenter | 0 | Carpenter in Fort Kochi with work post. |
| **V1** | Mini Soman | `mini.soman.sample@example.com` | `9000000110` | Thevara | Cook | 3 | Cook with 100% private records (`visible: false`) to test private-history privacy checks. |
| **N1** | Naveen Prakash | `naveen.prakash.sample@example.com` | `9000000111` | Kakkanad | Cleaner | 0 | Brand-new cleaner with zero records, no photo, no bio (empty state demo). |
| **D1** | Manoj Varghese | `manoj.varghese.sample@example.com` | `9000000112` | Edappally | Driver | 0 | Driver with work post in Edappally. |

---

### 2.2 Sample Customers (8 Accounts)

| Key | Name | Email | Phone | Locality | Demo Persona / Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CUST_BUSY** | Rahul Nambiar | `rahul.nambiar.sample@example.com` | `9000000201` | Kakkanad | Primary demo customer with bookings in all tabs (pending, confirmed, in-progress, completed, cancelled) and posted jobs. |
| **CUST_EMPTY** | Deepa Kurian | `deepa.kurian.sample@example.com` | `9000000202` | Edappally | Clean customer with zero bookings and zero jobs to verify empty state UI. |
| **CUST_3** | Karthik Shenoy | `karthik.shenoy.sample@example.com` | `9000000203` | Kaloor | Active customer with completed bookings and endorsements. |
| **CUST_4** | Anjali Nair | `anjali.nair.sample@example.com` | `9000000204` | Vyttila | Active customer with completed bookings and endorsements. |
| **CUST_5** | Mathew Abraham | `mathew.abraham.sample@example.com` | `9000000205` | Aluva | Active customer with completed bookings and endorsements. |
| **CUST_6** | Neetha George | `neetha.george.sample@example.com` | `9000000206` | Tripunithura | Active customer with completed bookings. |
| **CUST_7** | Faisal Mohammed | `faisal.mohammed.sample@example.com` | `9000000207` | Fort Kochi | Active customer with completed bookings. |
| **INC_CUST** | Incomplete Customer | `incomplete.customer.sample@example.com` | `9000000208` | — | Unfinished profile (`profileComplete: false`) for testing onboarding flows. |

---

## 3. Booking & Job Lifecycle States Matrix

The sample dataset populates every tab for `CUST_BUSY` and respective workers:

| State / Tab | Scheduled Time | Worker | Customer | Details |
| :--- | :--- | :--- | :--- | :--- |
| **Upcoming (Future Pending)** | Tomorrow 10:00 AM IST | Suresh Menon (E1) | Rahul Nambiar | Pending direct booking request. |
| **Upcoming (Future Confirmed)** | Tomorrow 2:00 PM IST | Anoop Raj (H1) | Rahul Nambiar | Confirmed direct booking request. |
| **Active (In Progress)** | Started 40 mins ago | Manoj Pillai (E2) | Rahul Nambiar | Customer can test the live finish flow with `finishCode`. |
| **Cancelled (Cancelled by Customer)** | 3 days ahead 11:00 AM IST | Shaji Mathew (P1) | Rahul Nambiar | Status: `cancelled`, cancelledBy: `customer`. |
| **Cancelled (Expired Pending)** | Started 4 hours ago | Shaji Mathew (P1) | Rahul Nambiar | Stored as `pending` in the past; read-time resolves to `expired`. |
| **Cancelled (Missed Confirmed)** | Window ended 4 hours ago | Vijayan Joseph (M1) | Rahul Nambiar | Stored as `confirmed` in the past; read-time resolves to `missed`. |
| **Done (Completed with Flags)** | 2 days ago | Shaji Mathew (P1) | Rahul Nambiar | Completed booking with `farFromJob: true` and `shortJob: true` (10 min). |

### Open & Posted Jobs (6 Jobs)
1. **Open Future Job:** 2 helpers needed, 1 accepted, Kakkanad.
2. **Open Future Job:** Electrician needed, high rate (₹180/hr), 280-character detailed description.
3. **Open Future Job:** Painter needed, low rate (₹80/hr), Kaloor.
4. **Filled Job:** Plumber needed, 1 accepted, Kakkanad.
5. **Cancelled Job:** Mason needed, cancelled due to weather.
6. **Expired Job:** Carpenter needed, start time in the past.

---

## 4. Fair Rate Compass Coverage

The historical booking spread guarantees immediate demonstration of all 3 Fair Rate Compass fallback tiers:

| Skill | Locality | Source Returned | Sample Size | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Electrician** | Kakkanad | `locality` | >= 6 | 6+ completed bookings in Kakkanad within the last 90 days. |
| **Plumber** | Kaloor / Vyttila | `city` | >= 7 | Bookings spread across Vyttila (3), Kaloor (2), and Palarivattom (2); under 5 in each locality, but >= 5 across Kochi. |
| **Cook** | Aluva | `baseline` | 0 | 0 completed non-private bookings in Aluva; falls back cleanly to sample baseline table. |

---

## 5. Live Free Now Windows

Three live Free Now availability windows are created with relative timers:
1. **Suresh Menon (E1):** 8-hour window started 1 hour ago (~7 hours remaining).
2. **Shaji Mathew (P1):** 4-hour window started 1 hour ago (~3 hours remaining).
3. **Anoop Raj (H1):** 2-hour window started 80 minutes ago (~40 minutes remaining).
4. **Vijayan Joseph (M1):** Expired window (started 5 hours ago for 4 hours).
5. **Thomas Mathew (PA1):** Blocked calendar date today.

---

## 6. Seed CLI Commands

All commands are run from the repository root:

```bash
# 1. Deterministic Seed (stops safely if already seeded)
npm run seed --prefix backend -- --yes

# 2. Verify all seeded counts, Passport chains, and Compass tiers
npm run seed:verify --prefix backend

# 3. Clean Reset (purges ONLY sample data, preserves real data, reseeds cleanly)
npm run demo:reset --prefix backend -- --yes

# 4. Refresh Free Now windows (re-opens the 3 live windows without touching other data)
npm run demo:refresh-free --prefix backend -- --yes

# 5. Remove all sample data completely
npm run seed:remove --prefix backend -- --yes
```

---

## 7. Frontend Integration Guidelines

1. **Serve Static Placeholder Assets:** Static placeholder images are located at `frontend/assets/sample/work-1.png ... work-6.png`. The web server should map `/assets/sample/` to serve these solid-colour demonstration PNGs.
2. **Sample Flag Display:** When an item (worker, post, booking, job, or Compass rate) includes `isSample: true`, render an honest visual indicator (e.g., a subtle neutral "Sample" pill badge).
3. **Dev Demo Banner:** In development mode (`NODE_ENV === 'development'`), the frontend can fetch `GET /api/v1/demo/accounts` to populate an interactive quick-login switcher for demo presentations.
