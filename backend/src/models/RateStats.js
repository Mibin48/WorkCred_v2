import mongoose from 'mongoose';

const rateStatsSchema = new mongoose.Schema(
  {
    skill: {
      type: String,
      required: true
    },
    localityKey: {
      type: String,
      required: true
    },
    cityKey: {
      type: String,
      required: true
    },
    p25: {
      type: Number,
      required: true
    },
    median: {
      type: Number,
      required: true
    },
    p75: {
      type: Number,
      required: true
    },
    sampleSize: {
      type: Number,
      required: true
    },
    isSeed: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: { createdAt: false, updatedAt: true }
  }
);

rateStatsSchema.index({ skill: 1, localityKey: 1 }, { unique: true });
rateStatsSchema.index({ skill: 1, cityKey: 1 });

export const RateStats = mongoose.model('RateStats', rateStatsSchema);
