import mongoose from 'mongoose';

const endorsementSchema = new mongoose.Schema(
  {
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
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

endorsementSchema.index({ customerId: 1, workerId: 1, skill: 1 }, { unique: true });
endorsementSchema.index({ workerId: 1, skill: 1 });

export const Endorsement = mongoose.model('Endorsement', endorsementSchema);
