/**
 * bookingService.js – B5 booking business logic.
 *
 * Security-critical functions kept small and commented:
 *   - createDirectBooking   (BOOK-1)
 *   - getBookingDetail      (GET /bookings/:id)
 *   - confirmBooking        (POST /bookings/:id/confirm)
 *   - cancelBooking         (POST /bookings/:id/cancel)
 *   - getBookingCodes       (GET /bookings/:id/codes)
 *   - startBooking          (POST /bookings/:id/start)
 *   - finishBooking         (POST /bookings/:id/finish)
 *   - getBookingReceipt     (GET /bookings/:id/receipt)
 *   - reportBooking         (POST /bookings/:id/report)
 *
 * Helpers:
 *   - resolveDisplayStatus
 *   - isParticipant
 *   - buildListItem
 *   - buildTimeline
 *   - tryTransaction
 */

import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { Booking } from '../models/Booking.js';
import { User } from '../models/User.js';
import { PassportEntry } from '../models/PassportEntry.js';
import { Report } from '../models/Report.js';
import {
  encryptCode,
  decryptCode,
  generate4DigitCode,
  verifyCodeConstantTime
} from '../../../shared/codesCrypto.js';
import {
  displayStatus,
  bookingTabFor,
  isWithinEarlyStartWindow,
  attemptStateCalc,
  computeHoursWorked,
  cashAmount,
  maskEmployerName,
  generateRecordId
} from '../../../shared/bookingHelpers.js';
import { computePassportHash, GENESIS_PREV_HASH } from '../../../shared/passportHash.js';
import { calculateHaversineDistance, isValidCoordinate } from '../../../shared/geo.js';
import { containsContactInfo } from '../../../shared/containsContactInfo.js';
import { getLocalityByKey } from '../../../shared/localities.js';
import { isWindowAvailable, intervalsOverlap } from '../../../shared/jobRules.js';
import { getIndiaTimeParts } from '../../../shared/calendarRules.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { Availability } from '../models/Availability.js';
import { eventBus } from '../realtime/eventBus.js';
import { closeFreeNowWindow } from './freeNowService.js';

// ---------------------------------------------------------------------------
// Transaction helper — retries up to 5 times on TransientTransactionError
// ---------------------------------------------------------------------------
/**
 * Wraps a function in a MongoDB session transaction with up to 5 retries
 * on TransientTransactionError.
 *
 * @param {(session: mongoose.ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function tryTransaction(fn) {
  const MAX_RETRIES = 5;
  const session = await mongoose.startSession();
  let attempt = 0;

  try {
    while (attempt < MAX_RETRIES) {
      session.startTransaction();
      try {
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } catch (err) {
        await session.abortTransaction();
        const isTransient = err.hasErrorLabel && err.hasErrorLabel('TransientTransactionError');
        if (isTransient && attempt < MAX_RETRIES - 1) {
          attempt++;
          continue;
        }
        throw err;
      }
    }
  } finally {
    session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the display status using the injectable clock. */
function resolveDisplayStatus(booking, clock) {
  return displayStatus(booking, clock.now());
}

/** Returns true if the user is a participant (customer or worker) of the booking. */
function isParticipant(booking, userId) {
  return (
    booking.customerId.toString() === userId.toString() ||
    booking.workerId.toString() === userId.toString()
  );
}

/** Returns "First L." style display name. */
function displayName(name) {
  if (!name || typeof name !== 'string') return 'Unknown';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Unknown';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

/**
 * Resolves job location snapshot for a booking.
 * For 'job' source: use the job's exact location (stored in locationSnapshot at creation).
 * For 'direct'/'freenow': customer's exact private point if set, else locality centroid.
 *
 * This function is called at booking CREATION time to capture the snapshot.
 */
export async function resolveLocationSnapshot(source, jobLocation, customerId) {
  // If source is 'job', the job location was passed in
  if (source === 'job' && jobLocation) {
    return jobLocation; // { type: 'Point', coordinates: [lng, lat] }
  }

  // For direct bookings: customer's exact private point or centroid
  const customer = await User.findById(customerId).select('location localityKey');
  if (
    customer.location &&
    customer.location.coordinates &&
    (customer.location.coordinates[0] !== 0 || customer.location.coordinates[1] !== 0)
  ) {
    return { type: 'Point', coordinates: customer.location.coordinates };
  }

  // Fall back to locality centroid
  const loc = customer.localityKey ? getLocalityByKey(customer.localityKey) : null;
  if (loc) {
    return { type: 'Point', coordinates: [loc.lng, loc.lat] };
  }

  // Last resort: [0,0] (invalid coordinates — booking will have no real location)
  return { type: 'Point', coordinates: [0, 0] };
}

/**
 * Builds the list item representation (never any phone, email, code, coordinates).
 */
function buildListItem(booking, role, otherUser, clock) {
  const ds = resolveDisplayStatus(booking, clock);
  const loc = getLocalityByKey(booking.localityKey);
  return {
    id: booking._id.toString(),
    status: booking.status,
    displayStatus: ds,
    skill: booking.skill,
    scheduledAt: booking.scheduledAt,
    hours: booking.hours,
    agreedRate: booking.agreedRate,
    cashAmount: cashAmount(booking.agreedRate, booking.hours),
    otherPartyDisplay: otherUser ? displayName(otherUser.name) : 'Unknown',
    localityName: booking.localityName || (loc ? loc.name : null),
    source: booking.source,
    createdAt: booking.createdAt
  };
}

/**
 * Builds timeline array for booking detail.
 */
function buildTimeline(booking) {
  const timeline = [{ event: 'requested', at: booking.createdAt }];

  if (booking.status === 'confirmed' || booking.status === 'in_progress' ||
      booking.status === 'completed') {
    if (booking.updatedAt && booking.status !== 'pending') {
      // We don't store a separate confirmedAt; use updatedAt approximation.
      // In B5 we just note the confirmed event exists once status != pending.
    }
  }

  if (booking.startedAt) {
    timeline.push({ event: 'started', at: booking.startedAt });
  }
  if (booking.finishedAt) {
    timeline.push({ event: 'finished', at: booking.finishedAt });
  }
  if (booking.status === 'cancelled') {
    timeline.push({
      event: 'cancelled',
      at: booking.updatedAt,
      cancelledBy: booking.cancelledBy
    });
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// POST /bookings  (BOOK-1)
// ---------------------------------------------------------------------------
/**
 * Creates a direct booking. Must be called inside the route handler which
 * already verified:
 *   - caller is customer with profileComplete
 *   - Idempotency-Key is present
 *
 * Rules enforced here:
 *   - worker exists, active, complete, not the caller
 *   - scheduledAt: 15 min to 30 days ahead
 *   - hours: 1 to 12, whole or half
 *   - note: max 200, trimmed, no contact info
 *   - calendar availability and no overlap (race-safe transaction)
 *   - codes generated and encrypted
 *
 * @param {{ workerId, scheduledAt, hours, note }} body
 * @param {object} caller  req.user
 * @param {object} config  { CODES_ENC_KEY }
 * @param {object} clock
 * @returns {object} bookingSummary
 */
export async function createDirectBooking(body, caller, config, clock) {
  const now = clock.now();

  // --- Validate worker ---
  if (!mongoose.Types.ObjectId.isValid(body.workerId)) {
    const err = new Error('Worker not found');
    err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }
  if (body.workerId.toString() === caller._id.toString()) {
    const err = new Error('You cannot book yourself');
    err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const worker = await User.findOne({
    _id: body.workerId,
    role: 'worker',
    isActive: true,
    profileComplete: true
  });
  if (!worker) {
    const err = new Error('Worker not found');
    err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  // --- Validate hours (whole or half, 1..12) ---
  const hours = Number(body.hours);
  if (
    isNaN(hours) ||
    hours < 1 ||
    hours > 12 ||
    (hours * 2) % 1 !== 0 // must be whole or .5
  ) {
    const err = new Error('hours must be between 1 and 12 in 0.5 increments');
    err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
  }

  // --- Validate fromFreeNow and scheduledAt ---
  const isFromFreeNow = Boolean(body.fromFreeNow);
  let scheduledAt;

  if (isFromFreeNow) {
    if (body.scheduledAt !== undefined && body.scheduledAt !== null) {
      const err = new Error('scheduledAt must not be sent for Free Now bookings');
      err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }

    // Server sets scheduledAt = clock now plus 30 minutes
    scheduledAt = new Date(now.getTime() + 30 * 60 * 1000);

    // Worker must have a live window (409 NOT_FREE_NOW)
    const liveWindow = await Availability.findOne({
      workerId: worker._id,
      active: true,
      expiresAt: { $gt: now }
    });

    if (!liveWindow) {
      const err = new Error('Worker does not have an active Free Now window');
      err.code = 'NOT_FREE_NOW'; err.statusCode = 409; throw err;
    }

    // scheduledAt must be before the window's expiresAt (409 FREE_WINDOW_ENDS_SOON)
    if (scheduledAt >= liveWindow.expiresAt) {
      const err = new Error('Free Now window ends in less than 30 minutes');
      err.code = 'FREE_WINDOW_ENDS_SOON'; err.statusCode = 409; throw err;
    }

    // Weekly pattern skipped, blocked dates still enforced (J3)
    const { dateString } = getIndiaTimeParts(scheduledAt);
    if (Array.isArray(worker.calendar?.blockedDates)) {
      const isBlocked = worker.calendar.blockedDates.some((b) => {
        const bDate = typeof b === 'string' ? b : b?.date;
        return bDate === dateString;
      });
      if (isBlocked) {
        const err = new Error('Worker has blocked this date on their calendar');
        err.code = 'BLOCKED_TODAY'; err.statusCode = 409; throw err;
      }
    }
  } else {
    // Normal direct booking validation
    scheduledAt = new Date(body.scheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      const err = new Error('scheduledAt must be a valid ISO date'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    const minAhead = new Date(now.getTime() + 15 * 60 * 1000);   // 15 min
    const maxAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    if (scheduledAt < minAhead) {
      const err = new Error('scheduledAt must be at least 15 minutes in the future');
      err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    if (scheduledAt > maxAhead) {
      const err = new Error('scheduledAt must be within 30 days');
      err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }

    // Check calendar availability
    if (!isWindowAvailable(worker.calendar, scheduledAt, hours)) {
      const err = new Error('Worker is not available at that time');
      err.code = 'NOT_AVAILABLE'; err.statusCode = 409; throw err;
    }
  }

  // --- Validate note ---
  const note = body.note ? String(body.note).trim().normalize('NFC').slice(0, 200) : '';
  if (note && containsContactInfo(note)) {
    const err = new Error('Note contains contact information which is not allowed');
    err.code = 'CONTACT_INFO_BLOCKED'; err.statusCode = 400; throw err;
  }

  // --- Resolve agreedRate ---
  const agreedRate = worker.rateHourlyEffective || 0;

  // --- Pre-generate booking _id so codes can be bound to it (BOOK-1) ---
  const bookingId = new mongoose.Types.ObjectId();

  // --- Generate and encrypt codes ---
  const startCodePlain = generate4DigitCode();
  const finishCodePlain = generate4DigitCode();
  const startCodeEnc = encryptCode(startCodePlain, config.CODES_ENC_KEY, bookingId.toString(), 'start');
  const finishCodeEnc = encryptCode(finishCodePlain, config.CODES_ENC_KEY, bookingId.toString(), 'finish');

  // --- Resolve location snapshot ---
  const locationSnapshot = await resolveLocationSnapshot('direct', null, caller._id);
  const localityInfo = worker.localityKey ? getLocalityByKey(worker.localityKey) : null;
  const skill = worker.mainSkill || (worker.skills && worker.skills[0]) || 'other';

  // --- Race-safe overlap check and insert in transaction ---
  const windowStart = scheduledAt;
  const windowEndMs = scheduledAt.getTime() + hours * 60 * 60 * 1000;

  const booking = await tryTransaction(async (session) => {
    // Check for overlapping bookings (pending, confirmed, in_progress) for the worker
    // that are not expired/missed
    const overlappingQuery = {
      workerId: worker._id,
      status: { $in: ['pending', 'confirmed', 'in_progress'] },
      scheduledAt: {
        // Any booking whose window overlaps [scheduledAt, scheduledAt+hours)
        $lt: new Date(windowEndMs)
      },
      $expr: {
        $gt: [
          { $add: ['$scheduledAt', { $multiply: ['$hours', 3600000] }] },
          windowStart.getTime()
        ]
      }
    };

    // Read-time expiry filter: exclude expired pending and missed confirmed
    // pending: scheduledAt > now (not expired)
    // confirmed: scheduledAt + hours > now (not missed)
    // in_progress: always active
    const now2 = clock.now();
    const nowMs2 = now2.getTime();

    const candidates = await Booking.find(overlappingQuery).session(session);
    for (const c of candidates) {
      const ds = displayStatus(c, now2);
      if (ds === 'expired' || ds === 'missed') continue; // these don't block
      // Actual overlap
      const cStart = c.scheduledAt.getTime();
      const cEnd = cStart + c.hours * 3600000;
      if (intervalsOverlap(windowStart, hours, c.scheduledAt, c.hours)) {
        const err = new Error('The worker already has a booking at that time');
        err.code = 'TIME_CLASH'; err.statusCode = 409; throw err;
      }
    }

    // Create the booking and $inc bookingGuard on the worker atomically
    // so a concurrent booking for the same slot conflicts on the guard update
    const newBooking = new Booking({
      _id: bookingId,
      customerId: caller._id,
      workerId: worker._id,
      skill,
      localityKey: worker.localityKey,
      localityName: localityInfo ? localityInfo.name : null,
      agreedRate,
      scheduledAt,
      hours,
      note,
      status: 'pending',
      source: isFromFreeNow ? 'freenow' : 'direct',
      isSample: Boolean(caller.isSample || worker.isSample),
      startCodeEnc,
      finishCodeEnc,
      locationSnapshot
    });
    await newBooking.save({ session });

    // $inc bookingGuard on worker to serialize concurrent bookings
    await User.updateOne({ _id: worker._id }, { $inc: { bookingGuard: 1 } }, { session });

    return newBooking;
  });

  logAuditEvent('booking_created', {
    userId: caller._id,
    role: 'customer',
    ip: null, // passed from route
    bookingId: booking._id.toString(),
    workerId: worker._id.toString()
  });

  // J4: If booking was created from Free Now, close the worker's window
  if (isFromFreeNow) {
    await closeFreeNowWindow(worker._id, 'booked');
  }

  // Publish booking:request event for worker
  eventBus.publish('booking:request', {
    bookingId: booking._id.toString(),
    workerId: worker._id.toString()
  });

  return buildListItem(booking, 'customer', worker, clock);
}

// ---------------------------------------------------------------------------
// GET /bookings/:id  (participant only)
// ---------------------------------------------------------------------------
/**
 * Returns booking detail with H5 contact release.
 *
 * @param {string} bookingId
 * @param {object} caller req.user
 * @param {object} clock
 * @returns {object}
 */
export async function getBookingDetail(bookingId, caller, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking || !isParticipant(booking, caller._id)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const isCustomer = booking.customerId.toString() === caller._id.toString();
  const isWorker = booking.workerId.toString() === caller._id.toString();

  const ds = resolveDisplayStatus(booking, clock);

  // Fetch both participants
  const [customer, worker] = await Promise.all([
    User.findById(booking.customerId).select('name phone'),
    User.findById(booking.workerId).select('name phone')
  ]);

  const otherUser = isCustomer ? worker : customer;

  // H5: Contact release — only while confirmed or in_progress (and not expired/missed)
  const contactReleasable = (ds === 'confirmed' || ds === 'in_progress');

  const contact = contactReleasable
    ? { name: otherUser?.name || null, phone: otherUser?.phone || null }
    : null;

  // H5: jobLocation released ONLY to the worker, ONLY while confirmed or in_progress
  let jobLocation = null;
  if (isWorker && contactReleasable && booking.locationSnapshot) {
    const [lng, lat] = booking.locationSnapshot.coordinates;
    const localityDoc = booking.localityKey ? getLocalityByKey(booking.localityKey) : null;
    jobLocation = {
      lat,
      lng,
      localityName: booking.localityName || (localityDoc ? localityDoc.name : null)
    };
  }

  // attemptsLeft and lockedUntil — for the CURRENT open step
  let attemptsLeft = null;
  let lockedUntil = null;
  const now = clock.now();

  if (ds === 'confirmed' && isWorker) {
    // Worker can check start code; show their remaining attempts
    const lockUntil = booking.startCodeLockUntil;
    if (lockUntil && lockUntil > now) {
      attemptsLeft = 0;
      lockedUntil = lockUntil;
    } else {
      const attempts = booking.startCodeAttempts >= 5 ? 0 : booking.startCodeAttempts;
      attemptsLeft = 5 - attempts;
    }
  } else if (ds === 'in_progress' && isCustomer) {
    // Customer can check finish code
    const lockUntil = booking.finishCodeLockUntil;
    if (lockUntil && lockUntil > now) {
      attemptsLeft = 0;
      lockedUntil = lockUntil;
    } else {
      const attempts = booking.finishCodeAttempts >= 5 ? 0 : booking.finishCodeAttempts;
      attemptsLeft = 5 - attempts;
    }
  }

  const listFields = buildListItem(booking, isCustomer ? 'customer' : 'worker', otherUser, clock);

  return {
    ...listFields,
    timeline: buildTimeline(booking),
    note: booking.note || '',
    startedAt: booking.startedAt || null,
    finishedAt: booking.finishedAt || null,
    hoursWorked: booking.hoursWorked || null,
    rating: booking.rating || null,
    receiptAvailable: booking.status === 'completed',
    contact: contact || null,
    ...(jobLocation ? { jobLocation } : {}),
    ...(attemptsLeft !== null ? { attemptsLeft } : {}),
    ...(lockedUntil ? { lockedUntil } : {})
  };
}

// ---------------------------------------------------------------------------
// GET /bookings  (list with cursor pagination)
// ---------------------------------------------------------------------------
/**
 * Lists own bookings by tab with cursor pagination.
 *
 * @param {{ tab, limit, cursor }} query
 * @param {object} caller
 * @param {object} clock
 * @returns {{ bookings: [], nextCursor: string|null }}
 */
export async function listBookings(query, caller, clock) {
  const { encodeCursor, decodeCursor } = await import('../../../shared/jobRules.js');
  const role = caller.role;
  const now = clock.now();

  // --- Validate tab ---
  const VALID_TABS = {
    customer: ['upcoming', 'active', 'done', 'cancelled'],
    worker: ['requests', 'upcoming', 'active', 'done', 'cancelled']
  };
  const validTabs = VALID_TABS[role];
  const tab = query.tab;
  if (!tab || !validTabs.includes(tab)) {
    const err = new Error(`tab must be one of: ${validTabs.join(', ')}`);
    err.code = 'INVALID_TAB'; err.statusCode = 400; throw err;
  }

  // --- Limit ---
  let limit = 20;
  if (query.limit !== undefined) {
    const l = Number(query.limit);
    if (isNaN(l) || l < 1 || l > 50) {
      const err = new Error('limit must be between 1 and 50'); err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }
    limit = l;
  }

  // --- Build status filter for the tab ---
  // We over-fetch and apply read-time expiry/missed filter in code for
  // statuses that need it (upcoming includes pending+confirmed, but
  // expired pending should be excluded).
  let statusFilter;
  let sortOrder;

  // Map tab to which stored statuses we need to fetch
  if (role === 'customer') {
    if (tab === 'upcoming') { statusFilter = ['pending', 'confirmed']; sortOrder = 'asc'; }
    else if (tab === 'active') { statusFilter = ['in_progress']; sortOrder = 'asc'; }
    else if (tab === 'done') { statusFilter = ['completed']; sortOrder = 'desc'; }
    else { statusFilter = ['cancelled']; sortOrder = 'desc'; } // cancelled tab also shows expired/missed (stored as pending/confirmed)
  } else {
    if (tab === 'requests') { statusFilter = ['pending']; sortOrder = 'asc'; }
    else if (tab === 'upcoming') { statusFilter = ['confirmed']; sortOrder = 'asc'; }
    else if (tab === 'active') { statusFilter = ['in_progress']; sortOrder = 'asc'; }
    else if (tab === 'done') { statusFilter = ['completed']; sortOrder = 'desc'; }
    else { statusFilter = ['cancelled']; sortOrder = 'desc'; }
  }

  // For 'cancelled' tabs: also include pending/confirmed that are expired/missed
  // We handle this by fetching all and filtering post-query.
  const needsExpiredMissed = tab === 'cancelled';
  let dbStatusFilter = [...statusFilter];
  if (needsExpiredMissed) {
    // Also fetch pending and confirmed to catch expired/missed
    if (!dbStatusFilter.includes('pending')) dbStatusFilter.push('pending');
    if (!dbStatusFilter.includes('confirmed')) dbStatusFilter.push('confirmed');
  }

  const participantFilter = role === 'customer'
    ? { customerId: caller._id }
    : { workerId: caller._id };

  // --- Cursor ---
  let cursorData = null;
  if (query.cursor) {
    cursorData = decodeCursor(query.cursor);
    if (!cursorData || !mongoose.Types.ObjectId.isValid(cursorData.id)) {
      const err = new Error('Cursor is invalid'); err.code = 'BAD_CURSOR'; err.statusCode = 400; throw err;
    }
  }

  // --- Query ---
  const filter = {
    ...participantFilter,
    status: { $in: dbStatusFilter }
  };

  const sortSpec = sortOrder === 'asc'
    ? { scheduledAt: 1, _id: 1 }
    : { updatedAt: -1, _id: -1 };

  // Apply cursor condition
  if (cursorData) {
    const cursorId = new mongoose.Types.ObjectId(cursorData.id);
    const cursorVal = cursorData.val;
    if (sortOrder === 'asc') {
      filter.$or = [
        { scheduledAt: { $gt: new Date(cursorVal) } },
        { scheduledAt: new Date(cursorVal), _id: { $gt: cursorId } }
      ];
    } else {
      filter.$or = [
        { updatedAt: { $lt: new Date(cursorVal) } },
        { updatedAt: new Date(cursorVal), _id: { $lt: cursorId } }
      ];
    }
  }

  // Fetch limit * 3 to have room after expiry/missed filtering
  const raw = await Booking.find(filter).sort(sortSpec).limit((limit + 1) * 3);

  // Post-filter: apply read-time display status mapping
  const filtered = raw.filter((b) => {
    const ds = displayStatus(b, now);
    return bookingTabFor(role, b, now) === tab;
  });

  // Grab limit+1 for next-cursor detection
  const page = filtered.slice(0, limit + 1);
  const hasNext = page.length > limit;
  const results = hasNext ? page.slice(0, limit) : page;

  // Fetch other participants (batch)
  const otherIds = results.map((b) =>
    role === 'customer' ? b.workerId : b.customerId
  );
  const others = await User.find({ _id: { $in: otherIds } }).select('name');
  const othersMap = new Map(others.map((u) => [u._id.toString(), u]));

  const items = results.map((b) => {
    const otherId = (role === 'customer' ? b.workerId : b.customerId).toString();
    const other = othersMap.get(otherId);
    return buildListItem(b, role, other, clock);
  });

  // Build next cursor
  let nextCursor = null;
  if (hasNext && results.length > 0) {
    const last = results[results.length - 1];
    nextCursor = encodeCursor({
      id: last._id.toString(),
      val: sortOrder === 'asc'
        ? last.scheduledAt.getTime()
        : last.updatedAt.getTime()
    });
  }

  return { bookings: items, nextCursor };
}

// ---------------------------------------------------------------------------
// GET /bookings/counts
// ---------------------------------------------------------------------------
/**
 * Returns count per tab for the caller's role.
 */
export async function getBookingCounts(caller, clock) {
  const role = caller.role;
  const now = clock.now();
  const participantFilter = role === 'customer'
    ? { customerId: caller._id }
    : { workerId: caller._id };

  const all = await Booking.find({
    ...participantFilter,
    status: { $in: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'] }
  }).select('status scheduledAt hours updatedAt');

  const tabs = role === 'customer'
    ? { upcoming: 0, active: 0, done: 0, cancelled: 0 }
    : { requests: 0, upcoming: 0, active: 0, done: 0, cancelled: 0 };

  for (const b of all) {
    const t = bookingTabFor(role, b, now);
    if (t && t in tabs) tabs[t]++;
  }

  return tabs;
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/confirm  (worker only)
// ---------------------------------------------------------------------------
export async function confirmBooking(bookingId, caller, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking || booking.workerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const ds = resolveDisplayStatus(booking, clock);
  if (ds !== 'pending') {
    // expired pending also fails here (correct: can't confirm expired)
    const err = new Error('Booking cannot be confirmed in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  // Re-check availability and overlap at confirm time
  const worker = await User.findById(caller._id);
  if (!isWindowAvailable(worker.calendar, booking.scheduledAt, booking.hours)) {
    const err = new Error('Worker is not available at that time');
    err.code = 'NOT_AVAILABLE'; err.statusCode = 409; throw err;
  }

  // Check no other active overlap (excluding this booking)
  const now = clock.now();
  const windowStart = booking.scheduledAt.getTime();
  const windowEnd = windowStart + booking.hours * 3600000;
  const others = await Booking.find({
    workerId: caller._id,
    status: { $in: ['confirmed', 'in_progress'] },
    _id: { $ne: booking._id }
  });
  for (const o of others) {
    const ds2 = displayStatus(o, now);
    if (ds2 === 'missed') continue;
    if (intervalsOverlap(booking.scheduledAt, booking.hours, o.scheduledAt, o.hours)) {
      const err = new Error('Time clash with another booking');
      err.code = 'TIME_CLASH'; err.statusCode = 409; throw err;
    }
  }

  // Atomic conditional update: only if status is still 'pending'
  const updated = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'pending' },
    { $set: { status: 'confirmed' } },
    { new: true }
  );
  if (!updated) {
    const err = new Error('Booking state changed concurrently');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  logAuditEvent('booking_confirmed', { userId: caller._id, bookingId });

  // J4: Worker confirming any booking closes their Free Now window
  await closeFreeNowWindow(caller._id, 'confirmed');

  // Publish booking:created event for the customer
  eventBus.publish('booking:created', {
    bookingId: booking._id.toString(),
    customerId: booking.customerId.toString()
  });

  // Return detail with contact released
  return getBookingDetail(bookingId, caller, clock);
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/cancel
// ---------------------------------------------------------------------------
/**
 * Cancel a booking. Either participant, only while pending or confirmed.
 * Repeating on an already-cancelled booking returns success.
 * H10: worker cancelling a CONFIRMED booking increments cancel counter.
 */
export async function cancelBooking(bookingId, body, caller, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking || !isParticipant(booking, caller._id)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const ds = resolveDisplayStatus(booking, clock);

  // Repeating a cancel on already-cancelled returns success
  if (booking.status === 'cancelled') {
    return { id: booking._id.toString(), status: 'cancelled' };
  }

  if (!['pending', 'confirmed'].includes(booking.status) || ds === 'expired' || ds === 'missed') {
    const err = new Error('Booking cannot be cancelled in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  const reason = body?.reason
    ? String(body.reason).trim().normalize('NFC').slice(0, 100)
    : null;
  if (reason && containsContactInfo(reason)) {
    const err = new Error('Reason contains contact information which is not allowed');
    err.code = 'CONTACT_INFO_BLOCKED'; err.statusCode = 400; throw err;
  }

  const cancelledBy = booking.customerId.toString() === caller._id.toString() ? 'customer' : 'worker';

  // Atomic update
  const updated = await Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: ['pending', 'confirmed'] } },
    {
      $set: {
        status: 'cancelled',
        cancelledBy,
        cancelReason: reason
      }
    },
    { new: true }
  );
  if (!updated) {
    const err = new Error('Booking state changed concurrently');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  // H10: worker cancelling a CONFIRMED booking → increment cancel counter
  if (cancelledBy === 'worker' && booking.status === 'confirmed') {
    const now = clock.now();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Push this timestamp and pull old ones in separate updates to avoid Mongo conflict
    await User.updateOne(
      { _id: caller._id },
      { $push: { cancelledConfirmedAt: now } }
    );
    await User.updateOne(
      { _id: caller._id },
      { $pull: { cancelledConfirmedAt: { $lt: cutoff } } }
    );

    // Re-read to count
    const workerDoc = await User.findById(caller._id).select('cancelledConfirmedAt');
    const recentCount = (workerDoc.cancelledConfirmedAt || []).filter(d => d >= cutoff).length;

    logAuditEvent('booking_cancelled', {
      userId: caller._id,
      bookingId,
      cancelledBy,
      recentCancelCount: recentCount
    });

    if (recentCount >= 3) {
      return {
        id: booking._id.toString(),
        status: 'cancelled',
        warning: 'REPEATED_CANCELLATIONS',
        warningMessage: 'You have cancelled 3 or more confirmed bookings in the last 30 days. Please try to honour your commitments to customers.'
      };
    }
  } else {
    logAuditEvent('booking_cancelled', { userId: caller._id, bookingId, cancelledBy });
  }

  // Publish booking:cancelled event for the other party only
  const otherUserId = caller._id.toString() === booking.customerId.toString()
    ? booking.workerId.toString()
    : booking.customerId.toString();

  eventBus.publish('booking:cancelled', {
    bookingId: booking._id.toString(),
    cancelledBy,
    otherUserId
  });

  return { id: booking._id.toString(), status: 'cancelled' };
}

// ---------------------------------------------------------------------------
// GET /bookings/:id/codes  (customer participant only, H1)
// ---------------------------------------------------------------------------
/**
 * Returns decrypted start and finish codes to the customer only.
 * Status must be confirmed or in_progress (and not missed).
 *
 * @param {string} bookingId
 * @param {object} caller
 * @param {object} config  { CODES_ENC_KEY }
 * @param {object} clock
 * @returns {{ startCode, finishCode, hideAfterSeconds: 30 }}
 */
export async function getBookingCodes(bookingId, caller, config, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  // Only customer sees codes; worker and non-participant get same 404
  const booking = await Booking.findById(bookingId).select('+startCodeEnc +finishCodeEnc');
  if (!booking || booking.customerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const ds = resolveDisplayStatus(booking, clock);
  if (!['confirmed', 'in_progress'].includes(ds)) {
    const err = new Error('Codes are not available in the current booking state');
    err.code = 'CODES_NOT_AVAILABLE'; err.statusCode = 409; throw err;
  }

  // Decrypt — AAD is bound to bookingId + step (cannot be swapped)
  const startCode = decryptCode(
    booking.startCodeEnc,
    config.CODES_ENC_KEY,
    bookingId,
    'start'
  );
  const finishCode = decryptCode(
    booking.finishCodeEnc,
    config.CODES_ENC_KEY,
    bookingId,
    'finish'
  );

  // Audit: log ids only, NEVER the codes themselves
  logAuditEvent('code_revealed', {
    userId: caller._id,
    bookingId,
    ip: null
  });

  return { startCode, finishCode, hideAfterSeconds: 30 };
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/start  (worker only)
// ---------------------------------------------------------------------------
/**
 * Handles the start handshake (HAND-2).
 * Atomic attempt counting with aggregation-pipeline reset on lock expiry.
 *
 * @param {string} bookingId
 * @param {{ code, location? }} body
 * @param {object} caller req.user (worker)
 * @param {object} config { CODES_ENC_KEY }
 * @param {object} clock
 */
export async function startBooking(bookingId, body, caller, config, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId).select('+startCodeEnc +startCodeLockUntil');
  if (!booking || booking.workerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const ds = resolveDisplayStatus(booking, clock);
  if (ds !== 'confirmed') {
    const err = new Error('Booking cannot be started in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  // TOO_EARLY check: must be within 60 min before scheduledAt
  const now = clock.now();
  if (!isWithinEarlyStartWindow(booking.scheduledAt, now)) {
    const earliest = new Date(booking.scheduledAt.getTime() - 60 * 60 * 1000);
    const err = new Error(`Start code can only be entered from ${earliest.toISOString()}`);
    err.code = 'TOO_EARLY'; err.statusCode = 409;
    err.earliestAt = earliest;
    throw err;
  }

  // --- Validate location (if provided) BEFORE counting attempts ---
  let startedGeo = null;
  let farFromJob = null;
  let locationWarning = null;

  if (body.location !== undefined && body.location !== null) {
    const loc = body.location;
    const lat = typeof loc.lat === 'number' ? loc.lat : parseFloat(loc.lat);
    const lng = typeof loc.lng === 'number' ? loc.lng : parseFloat(loc.lng);

    if (!isValidCoordinate(lat, lng)) {
      // Invalid coordinates: 400, attempt NOT counted
      const err = new Error('Invalid location coordinates');
      err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
    }

    // Compute distance to booking's location snapshot
    const [jobLng, jobLat] = booking.locationSnapshot.coordinates;
    const distMeters = calculateHaversineDistance(lat, lng, jobLat, jobLng);

    startedGeo = { type: 'Point', coordinates: [lng, lat] };
    if (distMeters <= 500) {
      farFromJob = false;
    } else {
      farFromJob = true;
      locationWarning = 'FAR_FROM_JOB';
    }
  }

  // --- Atomic attempt reservation ---
  // Uses aggregation pipeline update to reset counter if lock expired.
  const LOCK_DURATION_MS = 10 * 60 * 1000;
  const nowMs = now.getTime();

  // Reserve a slot atomically: only allow if status === 'confirmed' and not locked
  const reserved = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: 'confirmed',
      $or: [
        { startCodeLockUntil: null },
        { startCodeLockUntil: { $lte: now } }
      ],
      $expr: {
        $lt: [
          {
            $cond: [
              { $or: [{ $eq: ['$startCodeLockUntil', null] }, { $lte: ['$startCodeLockUntil', now] }] },
              // If lock expired (attempts were at 5), use 0 as base; else current
              {
                $cond: [
                  { $gte: ['$startCodeAttempts', 5] },
                  0,
                  '$startCodeAttempts'
                ]
              },
              '$startCodeAttempts'
            ]
          },
          5
        ]
      }
    },
    [
      {
        $set: {
          // Reset attempts to 0 if lock has expired (attempts >= 5)
          startCodeAttempts: {
            $cond: [
              {
                $and: [
                  { $gte: ['$startCodeAttempts', 5] },
                  {
                    $or: [
                      { $eq: ['$startCodeLockUntil', null] },
                      { $lte: ['$startCodeLockUntil', now] }
                    ]
                  }
                ]
              },
              1, // reset to 0 then inc → start at 1
              { $add: ['$startCodeAttempts', 1] }
            ]
          }
        }
      }
    ],
    { new: true, select: '+startCodeEnc +startCodeLockUntil' }
  );

  if (!reserved) {
    // Either locked or attempts exceeded — re-read to determine which
    const fresh = await Booking.findById(bookingId).select('+startCodeLockUntil');
    if (fresh && fresh.startCodeLockUntil && fresh.startCodeLockUntil > now) {
      const minutesLeft = Math.ceil((fresh.startCodeLockUntil.getTime() - nowMs) / 60000);
      logAuditEvent('start_locked', { userId: caller._id, bookingId });
      const err = new Error(`Code is locked. Try again in ${minutesLeft} minute(s).`);
      err.code = 'CODE_LOCKED'; err.statusCode = 429; err.minutesLeft = minutesLeft; throw err;
    }
    // Status changed concurrently
    const err = new Error('Booking cannot be started in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  const newAttempts = reserved.startCodeAttempts;
  const attemptsLeft = Math.max(0, 5 - newAttempts);

  // Verify code (constant-time)
  const isCorrect = verifyCodeConstantTime(
    String(body.code).trim(),
    reserved.startCodeEnc,
    config.CODES_ENC_KEY,
    bookingId,
    'start'
  );

  if (!isCorrect) {
    // Set lock if this was the 5th attempt
    if (newAttempts >= 5) {
      const lockUntil = new Date(nowMs + LOCK_DURATION_MS);
      await Booking.updateOne({ _id: bookingId }, { $set: { startCodeLockUntil: lockUntil } });
      logAuditEvent('start_locked', { userId: caller._id, bookingId });
      const err = new Error('Code is locked. Try again in 10 minute(s).');
      err.code = 'CODE_LOCKED'; err.statusCode = 429; err.minutesLeft = 10;
      throw err;
    } else {
      logAuditEvent('start_code_failed', {
        userId: caller._id,
        bookingId,
        attemptsLeft
      });
      const err = new Error('Incorrect start code');
      err.code = 'WRONG_CODE'; err.statusCode = 400;
      err.attemptsLeft = attemptsLeft;
      throw err;
    }
  }

  // Correct code: atomically transition confirmed → in_progress
  const started = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'confirmed' },
    {
      $set: {
        status: 'in_progress',
        startedAt: now,
        startedGeo: startedGeo,
        farFromJob
      }
    },
    { new: true }
  );

  if (!started) {
    // Concurrent start won the race — this is fine, idempotent
    const fresh = await Booking.findById(bookingId);
    if (fresh && fresh.status === 'in_progress') {
      logAuditEvent('booking_started', { userId: caller._id, bookingId });
      const detail = await getBookingDetail(bookingId, caller, clock);
      return {
        booking: detail,
        ...(locationWarning ? { warning: locationWarning, warningMessage: 'Your location appears to be more than 500 m from the job location. Please confirm you are at the right place.' } : {})
      };
    }
    const err = new Error('Booking state changed concurrently');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  logAuditEvent('booking_started', { userId: caller._id, bookingId });

  // J4: Starting work closes any Free Now window for this worker
  await closeFreeNowWindow(caller._id, 'started');

  // Publish booking:started event for the customer
  eventBus.publish('booking:started', {
    bookingId: bookingId.toString(),
    customerId: booking.customerId.toString()
  });

  const detail = await getBookingDetail(bookingId, caller, clock);

  return {
    booking: detail,
    ...(locationWarning
      ? {
          warning: locationWarning,
          warningMessage: 'Your location appears to be more than 500 m from the job location. Please confirm you are at the right place.'
        }
      : {})
  };
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/finish  (customer only)
// ---------------------------------------------------------------------------
/**
 * Finish handshake (HAND-3, HAND-5).
 * Runs one MongoDB transaction:
 *   (a) Move booking in_progress → completed
 *   (b) Create passport entry (seq, prevHash, hash, recordId)
 *   (c) Update worker passportStats and passportHead
 * After commit: recompute rate stats (non-fatal).
 */
export async function finishBooking(bookingId, body, caller, config, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId).select('+finishCodeEnc +finishCodeLockUntil');
  if (!booking || booking.customerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  if (booking.status !== 'in_progress') {
    const err = new Error('Booking cannot be finished in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  // Validate paidCash
  if (body.paidCash !== true) {
    const err = new Error('You must confirm that cash was paid to proceed');
    err.code = 'PAID_CASH_REQUIRED'; err.statusCode = 400; throw err;
  }

  // Validate rating
  const rating = Math.round(Number(body.rating));
  if (isNaN(rating) || rating < 1 || rating > 5) {
    const err = new Error('rating must be an integer between 1 and 5');
    err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
  }

  // Validate comment
  const comment = body.comment
    ? String(body.comment).trim().normalize('NFC').slice(0, 200)
    : '';
  if (comment && containsContactInfo(comment)) {
    const err = new Error('Comment contains contact information which is not allowed');
    err.code = 'CONTACT_INFO_BLOCKED'; err.statusCode = 400; throw err;
  }

  // --- Atomic attempt reservation for finish code ---
  const now = clock.now();
  const nowMs = now.getTime();
  const LOCK_DURATION_MS = 10 * 60 * 1000;

  const reserved = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: 'in_progress',
      $or: [
        { finishCodeLockUntil: null },
        { finishCodeLockUntil: { $lte: now } }
      ],
      $expr: {
        $lt: [
          {
            $cond: [
              { $and: [{ $gte: ['$finishCodeAttempts', 5] }, { $or: [{ $eq: ['$finishCodeLockUntil', null] }, { $lte: ['$finishCodeLockUntil', now] }] }] },
              0,
              '$finishCodeAttempts'
            ]
          },
          5
        ]
      }
    },
    [
      {
        $set: {
          finishCodeAttempts: {
            $cond: [
              { $and: [{ $gte: ['$finishCodeAttempts', 5] }, { $or: [{ $eq: ['$finishCodeLockUntil', null] }, { $lte: ['$finishCodeLockUntil', now] }] }] },
              1,
              { $add: ['$finishCodeAttempts', 1] }
            ]
          }
        }
      }
    ],
    { new: true, select: '+finishCodeEnc +finishCodeLockUntil' }
  );

  if (!reserved) {
    const fresh = await Booking.findById(bookingId).select('+finishCodeLockUntil');
    if (fresh && fresh.finishCodeLockUntil && fresh.finishCodeLockUntil > now) {
      const minutesLeft = Math.ceil((fresh.finishCodeLockUntil.getTime() - nowMs) / 60000);
      logAuditEvent('finish_locked', { userId: caller._id, bookingId });
      const err = new Error(`Code is locked. Try again in ${minutesLeft} minute(s).`);
      err.code = 'CODE_LOCKED'; err.statusCode = 429; err.minutesLeft = minutesLeft; throw err;
    }
    const err = new Error('Booking cannot be finished in its current state');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  const newAttempts = reserved.finishCodeAttempts;
  const attemptsLeft = Math.max(0, 5 - newAttempts);

  // Verify finish code (constant-time)
  const isCorrect = verifyCodeConstantTime(
    String(body.finishCode).trim(),
    reserved.finishCodeEnc,
    config.CODES_ENC_KEY,
    bookingId,
    'finish'
  );

  if (!isCorrect) {
    if (newAttempts >= 5) {
      const lockUntil = new Date(nowMs + LOCK_DURATION_MS);
      await Booking.updateOne({ _id: bookingId }, { $set: { finishCodeLockUntil: lockUntil } });
      logAuditEvent('finish_locked', { userId: caller._id, bookingId });
      const err = new Error('Code is locked. Try again in 10 minute(s).');
      err.code = 'CODE_LOCKED'; err.statusCode = 429; err.minutesLeft = 10;
      throw err;
    } else {
      logAuditEvent('finish_code_failed', { userId: caller._id, bookingId, attemptsLeft });
      const err = new Error('Incorrect finish code');
      err.code = 'WRONG_CODE'; err.statusCode = 400;
      err.attemptsLeft = attemptsLeft;
      throw err;
    }
  }

  // Correct code — run the transaction
  const finishedAt = now;
  const hoursWorked = computeHoursWorked(booking.startedAt, finishedAt);
  const bookedHours = booking.hours;
  const cash = cashAmount(booking.agreedRate, bookedHours);

  // Quality flags (H9)
  const shortJob = hoursWorked < 0.25;

  // repeatedPair: count completed bookings between this pair in last 30 days
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const pairCount = await Booking.countDocuments({
    customerId: booking.customerId,
    workerId: booking.workerId,
    status: 'completed',
    finishedAt: { $gte: thirtyDaysAgo }
  });
  const repeatedPair = pairCount >= 3;

  // Load customer's real name for passport hash
  const customer = await User.findById(booking.customerId).select('name');
  const employerName = customer ? customer.name : 'Unknown';

  // Date in UTC YYYY-MM-DD format
  const dateUTC = finishedAt.toISOString().slice(0, 10);

  let receipt;

  try {
    receipt = await tryTransaction(async (session) => {
      // (a) Move booking in_progress → completed
      const completedBooking = await Booking.findOneAndUpdate(
        { _id: bookingId, status: 'in_progress' },
        {
          $set: {
            status: 'completed',
            finishedAt,
            hoursWorked,
            paidCash: true,
            rating,
            comment,
            shortJob,
            repeatedPair
          }
        },
        { new: true, session }
      );

      if (!completedBooking) {
        // Another parallel finish won the race
        const err = new Error('Booking has already been finished');
        err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
      }

      // (b) Read worker's current head to determine seq and prevHash
      const workerDoc = await User.findById(booking.workerId)
        .select('passportStats passportHead name')
        .session(session);

      const currentSeq = workerDoc.passportHead.seq;
      const currentHash = workerDoc.passportHead.hash;
      const newSeq = currentSeq + 1;
      const prevHash = currentSeq === 0 ? GENESIS_PREV_HASH : currentHash;

      // Build the hash
      const hashInput = {
        prevHash,
        seq: newSeq,
        bookingId: bookingId.toString(),
        skill: booking.skill,
        date: dateUTC,
        hours: hoursWorked,
        rating,
        comment,
        employerName
      };
      const entryHash = computePassportHash(hashInput);

      // Generate unique record ID (H3)
      const recordId = generateRecordId();

      // Build employer display
      const maskedDisplay = maskEmployerName(employerName);

      // (b) Create passport entry
      const entry = new PassportEntry({
        workerId: booking.workerId,
        recordId,
        bookingId: bookingId,
        seq: newSeq,
        skill: booking.skill,
        date: new Date(dateUTC + 'T00:00:00.000Z'),
        hours: hoursWorked,
        rating,
        comment,
        employerName,
        employerDisplay: {
          name: employerName,
          masked: maskedDisplay
        },
        maskEmployerName: true,
        visible: true,
        prevHash,
        hash: entryHash
      });

      await entry.save({ session });

      // (c) Update passportStats and passportHead with conditional check
      const currentStats = workerDoc.passportStats;
      const newJobs = (currentStats.jobs || 0) + 1;
      const newRatingSum = (currentStats.ratingSum || 0) + rating;
      const newAvgRating = Number((newRatingSum / newJobs).toFixed(2));
      const newTotalHours = Number(((currentStats.totalHours || 0) + hoursWorked).toFixed(2));

      // Update skillCounts
      const skillCounts = currentStats.skillCounts || {};
      const newSkillCount = (skillCounts[booking.skill] || 0) + 1;
      const updatedSkillCounts = { ...skillCounts, [booking.skill]: newSkillCount };

      // topSkills: up to 3 by count, ties by name
      const sortedSkills = Object.entries(updatedSkillCounts)
        .sort(([aSkill, aCount], [bSkill, bCount]) =>
          bCount !== aCount ? bCount - aCount : aSkill.localeCompare(bSkill)
        )
        .slice(0, 3)
        .map(([s]) => s);

      // Conditional update requiring the head seq we read
      const workerUpdated = await User.findOneAndUpdate(
        {
          _id: booking.workerId,
          'passportHead.seq': currentSeq // serialize concurrent finishes
        },
        {
          $set: {
            'passportStats.jobs': newJobs,
            'passportStats.ratingSum': newRatingSum,
            'passportStats.avgRating': newAvgRating,
            'passportStats.totalHours': newTotalHours,
            [`passportStats.skillCounts.${booking.skill}`]: newSkillCount,
            'passportStats.topSkills': sortedSkills,
            'passportHead.seq': newSeq,
            'passportHead.hash': entryHash
          }
        },
        { new: true, session }
      );

      if (!workerUpdated) {
        // Concurrent finish on same worker — transaction will retry
        const err = new Error('Concurrent finish detected; retrying');
        err.hasErrorLabel = (label) => label === 'TransientTransactionError';
        throw err;
      }

      logAuditEvent('booking_finished', { userId: caller._id, bookingId });
      logAuditEvent('passport_entry_created', {
        userId: booking.workerId,
        bookingId,
        seq: newSeq,
        recordId
      });

      return {
        bookingId: bookingId.toString(),
        recordId,
        skill: booking.skill,
        date: dateUTC,
        startedAt: booking.startedAt,
        finishedAt,
        bookedHours: booking.hours,
        hoursWorked,
        agreedRate: booking.agreedRate,
        cashAmount: cash,
        paymentNote: 'Cash payment reported by customer',
        rating,
        comment,
        isSample: Boolean(booking.isSample),
        otherPartyDisplay: displayName(workerDoc.name)
      };
    });
  } catch (err) {
    if (err.code === 'INVALID_STATE') throw err;
    throw err;
  }

  // Publish booking:completed event for the worker
  eventBus.publish('booking:completed', {
    bookingId: bookingId.toString(),
    workerId: booking.workerId.toString()
  });

  // After commit: recompute rate stats (non-fatal)
  try {
    const { recomputeRateStats } = await import('../services/compassService.js');
    recomputeRateStats(booking.skill, booking.localityKey || 'kakkanad', clock).catch((e) => {
      console.error('recomputeRateStats failed after finish (non-fatal):', e.message);
    });
  } catch {
    // Ignore
  }

  return receipt;
}

// ---------------------------------------------------------------------------
// GET /bookings/:id/receipt  (participants only, status completed)
// ---------------------------------------------------------------------------
export async function getBookingReceipt(bookingId, caller, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking || !isParticipant(booking, caller._id)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  if (booking.status !== 'completed') {
    const err = new Error('Receipt is only available for completed bookings');
    err.code = 'NOT_COMPLETED'; err.statusCode = 409; throw err;
  }

  // Find the passport entry by bookingId to get recordId
  const entry = await PassportEntry.findOne({ bookingId: booking._id });

  const isCustomer = booking.customerId.toString() === caller._id.toString();
  const otherId = isCustomer ? booking.workerId : booking.customerId;
  const other = await User.findById(otherId).select('name');

  const dateUTC = booking.startedAt
    ? booking.startedAt.toISOString().slice(0, 10)
    : booking.scheduledAt.toISOString().slice(0, 10);

  return {
    bookingId: booking._id.toString(),
    recordId: entry ? entry.recordId : null,
    skill: booking.skill,
    date: dateUTC,
    startedAt: booking.startedAt,
    finishedAt: booking.finishedAt,
    bookedHours: booking.hours,
    hoursWorked: booking.hoursWorked,
    agreedRate: booking.agreedRate,
    cashAmount: cashAmount(booking.agreedRate, booking.hours),
    paymentNote: 'Cash payment reported by customer',
    rating: booking.rating,
    comment: booking.comment || '',
    isSample: Boolean(booking.isSample),
    otherPartyDisplay: other ? displayName(other.name) : 'Unknown'
  };
}

// ---------------------------------------------------------------------------
// POST /bookings/:id/report  (worker participant, in_progress only)
// ---------------------------------------------------------------------------
const VALID_REPORT_CATEGORIES = ['customer_not_there', 'wrong_place', 'unsafe', 'other'];

export async function reportBooking(bookingId, body, caller, clock) {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  const booking = await Booking.findById(bookingId);
  if (!booking || booking.workerId.toString() !== caller._id.toString()) {
    const err = new Error('Not found'); err.code = 'NOT_FOUND'; err.statusCode = 404; throw err;
  }

  if (booking.status !== 'in_progress') {
    const err = new Error('Reports can only be submitted while a booking is in progress');
    err.code = 'INVALID_STATE'; err.statusCode = 409; throw err;
  }

  const category = String(body.category || '').trim().toLowerCase();
  if (!VALID_REPORT_CATEGORIES.includes(category)) {
    const err = new Error(`category must be one of: ${VALID_REPORT_CATEGORIES.join(', ')}`);
    err.code = 'VALIDATION_ERROR'; err.statusCode = 400; throw err;
  }

  const note = body.note
    ? String(body.note).trim().normalize('NFC').slice(0, 200)
    : '';
  if (note && containsContactInfo(note)) {
    const err = new Error('Note contains contact information which is not allowed');
    err.code = 'CONTACT_INFO_BLOCKED'; err.statusCode = 400; throw err;
  }

  // Duplicate suppression: same worker, booking, category within 24 hours
  const twentyFourHoursAgo = new Date(clock.now().getTime() - 24 * 60 * 60 * 1000);
  const existing = await Report.findOne({
    targetType: 'booking',
    targetId: booking._id,
    reporterId: caller._id,
    reason: category,
    createdAt: { $gte: twentyFourHoursAgo }
  });

  if (!existing) {
    // Hash IP for storage
    const ipHash = crypto.createHash('sha256').update(caller._ip || '').digest('hex');
    await Report.create({
      targetType: 'booking',
      targetId: booking._id,
      reason: category,
      note,
      reporterId: caller._id,
      ipHash
    });
    logAuditEvent('booking_reported', { userId: caller._id, bookingId, category });
  }

  return { message: 'Report received. Support will review it.' };
}
