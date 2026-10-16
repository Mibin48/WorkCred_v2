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
