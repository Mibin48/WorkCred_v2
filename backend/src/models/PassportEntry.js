import mongoose from 'mongoose';

const passportEntrySchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
      immutable: true
    },
    seq: {
      type: Number,
      required: true,
      immutable: true
    },
    skill: {
      type: String,
      required: true,
      immutable: true
    },
    date: {
      type: Date,
      required: true,
      immutable: true
    },
    hours: {
      type: Number,
      required: true,
      immutable: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      immutable: true
    },
    comment: {
      type: String,
      default: '',
      immutable: true
    },
    employerName: {
      type: String,
      required: true,
      immutable: true // Real unmasked employer name, covered by hash
    },
    employerDisplay: {
      name: { type: String, default: '' },
      masked: { type: String, default: '' }
    },
    maskEmployerName: {
      type: Boolean,
      default: true // May be modified by worker
    },
    visible: {
      type: Boolean,
      default: true // May be modified by worker
    },
    prevHash: {
      type: String,
      required: true,
      immutable: true
    },
    hash: {
      type: String,
      required: true,
      immutable: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

passportEntrySchema.index({ workerId: 1, seq: 1 }, { unique: true });
passportEntrySchema.index({ workerId: 1, visible: 1, seq: -1 });

// Strictly forbid modifying any field other than `visible` and `maskEmployerName` at model level
passportEntrySchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function (next) {
  const update = this.getUpdate();
  if (!update) return next();

  // Extract all modified field names from update object (e.g. $set, direct properties)
  const modifiedFields = new Set();

  for (const [key, val] of Object.entries(update)) {
    if (key === '$set') {
      if (val && typeof val === 'object') {
        for (const subKey of Object.keys(val)) {
          modifiedFields.add(subKey);
        }
      }
    } else if (key === '$setOnInsert') {
      // Ignored for updates on existing entries
      continue;
    } else if (key.startsWith('$')) {
      // Any other update operator (e.g. $inc, $unset, $push) is modifying fields
      if (val && typeof val === 'object') {
        for (const subKey of Object.keys(val)) {
          modifiedFields.add(subKey);
        }
      } else {
        modifiedFields.add(key);
      }
    } else {
      modifiedFields.add(key);
    }
  }

  for (const field of modifiedFields) {
    if (field !== 'visible' && field !== 'maskEmployerName') {
      return next(new Error(`Cannot update immutable field "${field}" in Passport entry`));
    }
  }

  next();
});

export const PassportEntry = mongoose.model('PassportEntry', passportEntrySchema);
