import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    location: {
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
    localityKey: {
      type: String,
      required: true
    },
    skills: {
      type: [String],
      required: true
    },
    rateHourly: {
      type: Number,
      required: true
    },
    startsAt: {
      type: Date,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    active: {
      type: Boolean,
      default: true
    },
    closedReason: {
      type: String,
      default: null
    },
    closedAt: {
      type: Date,
      default: null
    },
    announcedBusy: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes
availabilitySchema.index({ location: '2dsphere' });
availabilitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
availabilitySchema.index({ workerId: 1 }, { unique: true, partialFilterExpression: { active: true } });
availabilitySchema.index({ active: 1, expiresAt: 1 });

export const Availability = mongoose.model('Availability', availabilitySchema);
