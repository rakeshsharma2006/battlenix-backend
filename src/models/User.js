const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
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
      index: true,
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
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// OPTIMIZATION 2: Explicit named indexes so they appear in explain() plans.
// Note: Mongoose also builds these from `unique: true` in the schema definition
// above — these calls simply assign a name and ensure they won't be skipped.
userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });
userSchema.index({ username: 1 }, { unique: true, name: 'username_unique' });

module.exports = mongoose.model('User', userSchema);
