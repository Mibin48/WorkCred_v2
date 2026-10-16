import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
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
    skills: {
      type: [String],
      required: true
    },
    rate: {
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
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

availabilitySchema.index({ location: '2dsphere' });
availabilitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
availabilitySchema.index({ workerId: 1, active: 1 });

export const Availability = mongoose.model('Availability', availabilitySchema);
