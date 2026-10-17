# Security Review Guide: Phase B5 (Bookings, Handshake & Work Passport)

**Purpose:** This document specifies the exact security-critical files and functions in Phase B5 that the Product Owner must review line-by-line, along with the precise guarantee each function must enforce.

---

## 1. Security-Critical Modules & Guarantees

### A. Handshake Code Handling & Cryptography
1. **`shared/codesCrypto.js` -> `encryptCode(code, bookingId, step, key)`**
   - *Guarantee:* Encrypts 4-digit codes using AES-256-GCM with a fresh random 12-byte IV and enforces Additional Authenticated Data (AAD) bound to `bookingId:step`, preventing code reuse across steps or different bookings.
2. **`shared/codesCrypto.js` -> `decryptCode(encryptedString, bookingId, step, key)`**
   - *Guarantee:* Authenticates and decrypts the stored ciphertext against the exact booking ID and step AAD, throwing an error immediately if modified, transplanted, or deciphered with the wrong parameters.
3. **`shared/codesCrypto.js` -> `verifyCodeConstantTime(actualCode, inputCode)`**
   - *Guarantee:* Compares code strings using `crypto.timingSafeEqual` over fixed-length buffers to eliminate timing side channels.
4. **`backend/src/routes/bookings.js` -> `GET /bookings/:id/codes`**
   - *Guarantee:* Delivers decrypted codes exclusively to the customer participant while confirmed or in progress, returning `Cache-Control: no-store` and emitting an audit log with IDs only.

---

### B. Attempt Reservation & Brute-Force Lockout
1. **`shared/bookingHelpers.js` -> `attemptStateCalc(currentAttempts, lockUntil, now)`**
   - *Guarantee:* Purely determines state transitions, capping comparisons at 5 attempts, enforcing a 10-minute lockout upon the 5th failure, and resetting counters atomically once the lockout expires.
2. **`backend/src/services/bookingService.js` -> `startBooking(bookingId, body, caller, clock)`**
   - *Guarantee:* Reserves attempt slots via an atomic conditional aggregation update before code verification, ensuring concurrent guess floods never exceed 5 comparisons before locking.
3. **`backend/src/services/bookingService.js` -> `finishBooking(bookingId, body, caller, clock)`**
   - *Guarantee:* Atomically reserves finish attempt slots and requires explicit `paidCash: true` confirmation and 1-5 rating before executing the completion transaction.

---

### C. Multi-Document Transactions & Concurrency Safety
1. **`backend/src/services/bookingService.js` -> `tryTransaction(fn)`**
   - *Guarantee:* Executes multi-document operations inside a MongoDB transaction session, automatically retrying up to 5 times upon receiving `TransientTransactionError`.
2. **`backend/src/services/bookingService.js` -> `createDirectBooking(body, caller, idempKey, clock)`**
   - *Guarantee:* Performs conflict checks and booking insertion within a transaction that increments the worker's `bookingGuard`, serializing concurrent booking attempts for the same worker.
3. **`backend/src/services/bookingService.js` -> `finishBooking` Transaction Block**
   - *Guarantee:* Atomically transitions booking to `completed`, writes a single `passportEntries` record, and updates worker `passportHead` and `passportStats` under a conditional sequence check to eliminate chain forks and duplicate records.

---

### D. Work Passport Hash Chain & Verification
1. **`shared/passportHash.js` -> `computePassportHash(entry)`**
   - *Guarantee:* Generates canonical SHA-256 hash over `[prevHash, seq, workerId, bookingId, skill, date, hours, rating, comment, employerName]`, binding the private customer legal name without exposing it in public responses.
2. **`shared/bookingHelpers.js` -> `verifyChain(entries, head, stats)`**
   - *Guarantee:* Evaluates complete worker entry histories, returning `"needs_attention"` if any sequence is non-contiguous from 1, genesis hash differs from 64 zeros, hashes mismatch, head diverges, stats job count disagrees, or booking IDs duplicate.
3. **`backend/src/services/passportService.js` -> `patchPassportEntry(recordId, body, caller)`**
   - *Guarantee:* Restricts worker mutations strictly to `visible` and `maskEmployerName`, rejecting any modification to immutable transaction, rating, or hash fields with HTTP 400.
4. **`backend/src/models/PassportEntry.js` -> Pre-update Hook**
   - *Guarantee:* Enforces immutability at the Mongoose ODM layer by aborting any update operation that targets fields other than `visible` or `maskEmployerName`.

---

### E. Privacy & Contact Release Boundaries
1. **`backend/src/services/bookingService.js` -> `getBookingDetail(bookingId, caller, clock)`**
   - *Guarantee:* Releases counterparty phone numbers and worker `jobLocation` strictly during `confirmed` and `in_progress` states, withholding exact coordinates and contact information at all other times.
2. **`shared/bookingHelpers.js` -> `maskEmployerName(name)`**
   - *Guarantee:* Transforms full names into privacy-preserving representations (e.g., `"Ravi Kumar"` -> `"R*** K."`), never returning unmasked customer surnames to public viewers.
