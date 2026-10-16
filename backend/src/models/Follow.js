import mongoose from 'mongoose';

const followSchema = new mongoose.Schema(
  {
    fromId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    toId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: ['follow', 'save'],
      required: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

followSchema.index({ fromId: 1, toId: 1, type: 1 }, { unique: true });

export const Follow = mongoose.model('Follow', followSchema);
