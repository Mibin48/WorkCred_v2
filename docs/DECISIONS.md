# Architectural Decisions Log

This document records key architectural, security, and product design decisions for WorkCred.

---

## 2026-10-16

### 1. Authentication Identifiers and Phone Role
- **Decision:** Login and sign-up use **email and password**. Phone number is a required contact field collected at registration, but is **not unique** and **not a login identifier**.
- **Rationale:** Aligns with PRD v3.1 / Design System v2.1 specifications and mitigates denial-of-service/lockout risks inherent to public phone numbers.

### 2. Verification Scope for V1
- **Decision:** Neither email nor phone number is verified (no SMS/email OTP gateways) in this version.
- **Rationale:** Strict focus on a self-contained local build running on localhost without external paid telecom gateways. Unverified phone numbers are kept private and released only after a booking is confirmed.

### 3. Role Assignment and Verification Order
- **Decision:** Role (`worker` or `customer`) is fixed at sign-up and cannot be toggled or altered. The user's role is checked **only after** password validity is confirmed.
- **Rationale:** Constant-time authentication and brute-force prevention; avoids leaking user role or account existence via pre-check role branching.

### 4. Backend Technology Stack
- **Decision:** The backend is built on **Node.js 20+**, **Express 4/5**, and **MongoDB (Mongoose 8)**, using native **ES Modules (ESM)** with **no build or compilation step**.
- **Rationale:** Simplicity, zero overhead, fast cold-starts, and direct parity with local Node environments.

### 5. Cash-First Payment Model
- **Decision:** The application strictly facilitates matching, scheduling, and proof of work. All monetary settlements are **cash only** directly between customer and worker. There are no digital wallets, commissions, QR codes, public pages, or external sharing links in this version.
- **Rationale:** Eliminates payment gateway compliance, KYC liabilities, and custodial money handling, preserving 100% of earnings for workers.
