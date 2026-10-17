import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    skill: {
      type: String,
      required: true
    },
    caption: {
      type: String,
      required: true,
      maxLength: 140
    },
    afterUrl: {
      type: String,
      required: true
    },
    beforeUrl: {
      type: String,
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    },
    verifiedJob: {
      type: Boolean,
      default: false
    },
    localityKey: {
      type: String,
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
    }
  },
  {
    timestamps: true
  }
);

postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ workerId: 1, createdAt: -1 });
postSchema.index({ location: '2dsphere' });
postSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $type: 'objectId' } } }
);

export const Post = mongoose.model('Post', postSchema);
