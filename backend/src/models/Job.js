import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    skill: {
      type: String,
      required: true
    },
    workersNeeded: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    acceptedCount: {
      type: Number,
      default: 0
    },
    hours: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    startAt: {
      type: Date,
      required: true
    },
    offeredRate: {
      type: Number,
      required: true,
      min: 1
    },
    description: {
      type: String,
      required: true,
      maxLength: 300
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
    status: {
      type: String,
      enum: ['open', 'filled', 'cancelled', 'expired'],
      default: 'open'
    }
  },
  {
    timestamps: true
  }
);

jobSchema.index({ location: '2dsphere' });
jobSchema.index({ status: 1, skill: 1, startAt: 1 });

export const Job = mongoose.model('Job', jobSchema);
