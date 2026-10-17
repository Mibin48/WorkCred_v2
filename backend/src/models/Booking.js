import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job'
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    skill: {
      type: String,
      required: true
    },
    localityKey: {
      type: String,
      default: null
    },
    agreedRate: {
      type: Number,
      required: true
    },
    scheduledAt: {
      type: Date,
      required: true
    },
    hours: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    note: {
      // Customer's note at booking time (max 200, contact-blocked)
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'],
      default: 'pending'
    },
    source: {
      type: String,
      enum: ['job', 'direct', 'freenow'],
      default: 'direct'
    },
    isSample: {
      type: Boolean,
      default: false
    },

    // ── Encrypted codes (select:false – never returned by default) ──────────
    startCodeEnc: {
      type: String,
      required: true,
      select: false
    },
    finishCodeEnc: {
      type: String,
      required: true,
      select: false
    },

    // ── Separate attempt counters and lock for start and finish steps ────────
    // Start counters (worker enters code)
    startCodeAttempts: {
      type: Number,
      default: 0
    },
    startCodeLockUntil: {
      type: Date,
      default: null,
      select: false  // never exposed via API
    },

    // Finish counters (customer enters code)
    finishCodeAttempts: {
      type: Number,
      default: 0
    },
    finishCodeLockUntil: {
      type: Date,
      default: null,
      select: false  // never exposed via API
    },

    // ── Timeline ─────────────────────────────────────────────────────────────
    startedAt: {
      type: Date,
      default: null
    },
    startedGeo: {
      // null when no coordinates provided (HAND-2)
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: null
      }
    },
    farFromJob: {
      type: Boolean,
      default: null  // null = unknown (no coords); false = within 500m; true = beyond
    },
    finishedAt: {
      type: Date,
      default: null
    },
    hoursWorked: {
      type: Number,
      default: null
    },
    paidCash: {
      type: Boolean,
      default: false
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    comment: {
      type: String,
      maxLength: 200,
      default: ''
    },

    // ── Location copy for the booking (H5) ───────────────────────────────────
    // For 'job' bookings: the job's exact point.
    // For 'direct'/'freenow': customer's exact point (if set) else locality centroid.
    // Released to worker only while confirmed or in_progress.
    locationSnapshot: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        required: true
      }
    },
    localityName: {
      // Human-readable locality name snapshotted at booking time
      type: String,
      default: null
    },

    // ── Cancellation ─────────────────────────────────────────────────────────
    cancelledBy: {
      // 'customer' or 'worker'
      type: String,
      enum: ['customer', 'worker'],
      default: null
    },
    cancelReason: {
      type: String,
      default: null
    },

    // ── Quality flags (internal, NEVER shown to users) (H9) ─────────────────
    flags: {
      type: [String],
      default: []
    },
    shortJob: {
      // hoursWorked < 0.25 (H9)
      type: Boolean,
      default: null,
      select: false
    },
    repeatedPair: {
      // 3+ completed bookings between same pair in last 30 days before this one (H9)
      type: Boolean,
      default: null,
      select: false
    },

    // ── Race-safety guard for concurrent booking creation (BOOK-1) ───────────
    // $inc-ed on every booking creation attempt so concurrent bookings for
    // the same worker conflict on update and one retries then fails with TIME_CLASH.
    bookingGuard: {
      type: Number,
      default: 0,
      select: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
bookingSchema.index({ workerId: 1, status: 1, scheduledAt: 1 });
bookingSchema.index({ customerId: 1, status: 1, scheduledAt: 1 });
bookingSchema.index(
  { jobId: 1, workerId: 1 },
  { unique: true, partialFilterExpression: { jobId: { $type: 'objectId' } } }
);

export const Booking = mongoose.model('Booking', bookingSchema);
