import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
      // NOTE: Non-unique per Decision B and F1
    },
    role: {
      type: String,
      required: true,
      enum: ['worker', 'customer'],
      immutable: true // Role is fixed at sign-up
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false // Never return in queries by default
    },
    failedLoginCount: {
      type: Number,
      default: 0
    },
    lockUntil: {
      type: Date,
      default: null
    },
    lockLevel: {
      type: Number,
      default: 0
    },
    tokenVersion: {
      type: Number,
      default: 0
    },
    mustChangePassword: {
      type: Boolean,
      default: false
    },
    lastLoginAt: {
      type: Date,
      default: null
    },
    photoUrl: {
      type: String,
      default: null
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [0, 0]
      }
    },
    localityKey: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    // Worker specific fields
    skills: {
      type: [String],
      default: []
    },
    mainSkill: {
      type: String,
      default: null
    },
    hourlyRate: {
      type: Number,
      default: 0
    },
    dailyRate: {
      type: Number,
      default: 0
    },
    bio: {
      type: String,
      default: '',
      maxLength: 200
    },
    radiusKm: {
      type: Number,
      default: null
    },
    calendar: {
      weekly: {
        mon: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        tue: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        wed: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        thu: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        fri: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        sat: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' },
        sun: { type: String, enum: ['off', 'morning', 'afternoon', 'evening', 'full'], default: 'full' }
      },
      blockedDates: [
        {
          date: { type: String, required: true },
          reason: { type: String, default: '', maxLength: 60 }
        }
      ]
    },
    passportStats: {
      jobs: { type: Number, default: 0 },
      avgRating: { type: Number, default: 0 },
      totalHours: { type: Number, default: 0 },
      topSkills: { type: [String], default: [] }
    },
    passportHead: {
      seq: { type: Number, default: 0 },
      hash: { type: String, default: '0'.repeat(64) }
    },
    defaultMaskEmployerNames: {
      type: Boolean,
      default: true
    },
    penaltyCounters: {
      cancellations: { type: Number, default: 0 }
    },
    profileComplete: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ location: '2dsphere' });
userSchema.index({ role: 1, isActive: 1, skills: 1 });
userSchema.index({ role: 1, 'passportStats.avgRating': -1 });

export const User = mongoose.model('User', userSchema);
