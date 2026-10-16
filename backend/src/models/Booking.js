import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      default: null
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
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'],
      default: 'pending'
    },
    startCodeEnc: {
      type: String,
      required: true,
      select: false // Never return in API responses by default
    },
    finishCodeEnc: {
      type: String,
      required: true,
      select: false
    },
    startCodeAttempts: {
      type: Number,
      default: 0
    },
    finishCodeAttempts: {
      type: Number,
      default: 0
    },
    codeLockUntil: {
      type: Date,
      default: null
    },
    startedAt: {
      type: Date,
      default: null
    },
    startedGeo: {
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
      default: null
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
    source: {
      type: String,
      enum: ['job', 'direct', 'freenow'],
      default: 'direct'
    },
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
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    cancelReason: {
      type: String,
      default: null
    },
    flags: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true
  }
);

bookingSchema.index({ workerId: 1, status: 1, scheduledAt: 1 });
bookingSchema.index({ customerId: 1, status: 1, scheduledAt: 1 });
bookingSchema.index({ jobId: 1, workerId: 1 }, { unique: true, sparse: true });

export const Booking = mongoose.model('Booking', bookingSchema);
