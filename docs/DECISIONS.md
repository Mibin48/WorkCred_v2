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
