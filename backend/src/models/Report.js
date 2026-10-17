import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ['worker', 'customer', 'post', 'booking'],
      required: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    reason: {
      type: String,
      required: true
    },
    note: {
      type: String,
      default: '',
      maxLength: 200
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    ipHash: {
      type: String,
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1, reason: 1, createdAt: -1 });
reportSchema.index({ createdAt: -1 });

export const Report = mongoose.model('Report', reportSchema);
