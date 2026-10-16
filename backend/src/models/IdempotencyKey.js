import mongoose from 'mongoose';

const idempotencyKeySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    key: {
      type: String,
      required: true
    },
    route: {
      type: String,
      required: true
    },
    responseSnapshot: {
      statusCode: {
        type: Number,
        required: true
      },
      body: {
        type: mongoose.Schema.Types.Mixed,
        required: true
      }
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 24 * 60 * 60 // 24 hours TTL
    }
  },
  {
    timestamps: false
  }
);

idempotencyKeySchema.index({ userId: 1, key: 1, route: 1 }, { unique: true });

export const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
