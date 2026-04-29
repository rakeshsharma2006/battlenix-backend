const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userFlagSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    trustPenalty: {
      type: Number,
      required: true,
      min: 0,
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      default: null,
      trim: true,
      minlength: 3,
      maxlength: 30,
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    googleId: {
      type: String,
      default: null,
      index: { sparse: true },
    },
    avatar: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: ['user', 'manager', 'admin'],
      default: 'user',
    },
    trustScore: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
      index: true,
    },
    isFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Legacy field (keep for backward compat)
    gameUID: {
      type: String,
      default: null,
      trim: true,
    },
    gameName: {
      type: String,
      default: null,
      trim: true,
    },
    upiId: {
      type: String,
      default: null,
      trim: true,
    },

    // Per-game fields
    bgmiUID: {
      type: String,
      default: null,
      trim: true,
    },
    bgmiName: {
      type: String,
      default: null,
      trim: true,
    },
    bgmiUpiId: {
      type: String,
      default: null,
      trim: true,
    },

    ffUID: {
      type: String,
      default: null,
      trim: true,
    },
    ffName: {
      type: String,
      default: null,
      trim: true,
    },
    ffUpiId: {
      type: String,
      default: null,
      trim: true,
    },
    // ── Referral fields ──────────────────────────────────────────────────
    referralCode: {
      type: String,
      default: null,
      trim: true,
    },
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReferralCode',
      default: null,
    },
    referredAt: {
      type: Date,
      default: null,
    },
    hashedDeviceFingerprint: {
      type: String,
      default: null,
      trim: true,
      select: false,
    },
    deviceFingerprintConsent: {
      type: Boolean,
      default: false,
    },
    deviceFingerprintSetAt: {
      type: Date,
      default: null,
    },
    signupIp: {
      type: String,
      default: null,
    },
    cashBalance: {
      type: Number,
      default: 0,
    },
    coinBalance: {
      type: Number,
      default: 0,
    },
    installReferrerRaw: {
      type: String,
      default: null,
      trim: true,
    },
    isReferralRewardGiven: {
      type: Boolean,
      default: false,
    },
    firstMatchPlayedAt: {
      type: Date,
      default: null,
    },
    fraudFlags: {
      type: [String],
      default: [],
    },
    // ── End referral fields ──────────────────────────────────────────────

    flags: {
      type: [userFlagSchema],
      default: [],
    },
    loginAttempts: {
      type: Number,
      required: true,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Pre-save hook to handle hashing the virtual device fingerprint if consent is given
  if (this._deviceFingerprint && this.deviceFingerprintConsent) {
    this.hashedDeviceFingerprint = crypto.createHash('sha256').update(this._deviceFingerprint).digest('hex');
    this.deviceFingerprintSetAt = new Date();
  } else if (this._deviceFingerprint && !this.deviceFingerprintConsent) {
    // If no consent, do not store it
    this.hashedDeviceFingerprint = null;
  }
  
  next();
});

// Virtual setter for raw device fingerprint
userSchema.virtual('deviceFingerprint').set(function (fp) {
  this._deviceFingerprint = fp;
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// OPTIMIZATION 2: Explicit named indexes so they appear in explain() plans.
// Note: Mongoose also builds these from `unique: true` in the schema definition
// above — these calls simply assign a name and ensure they won't be skipped.
userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });
userSchema.index({ username: 1 }, { unique: true, name: 'username_unique' });
userSchema.index({ referralCodeId: 1 }, { name: 'user_referral_code' });
userSchema.index({ referredAt: 1 }, { name: 'user_referred_at' });

module.exports = mongoose.model('User', userSchema);
