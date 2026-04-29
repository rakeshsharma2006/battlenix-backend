const mongoose = require('mongoose');

const referralCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    creatorName: {
      type: String,
      required: true,
      trim: true,
    },
    channelName: {
      type: String,
      default: null,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['YOUTUBE', 'INSTAGRAM', 'TELEGRAM', 'DISCORD', 'OTHER'],
      default: 'OTHER',
    },
    channelUrl: {
      type: String,
      default: null,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Commission configuration
    commissionModel: {
      type: String,
      enum: ['PER_FIRST_MATCH', 'PERCENT_REVENUE', 'HYBRID'],
      default: 'PER_FIRST_MATCH',
    },
    commissionPerUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 50,
    },

    // Reward to referred user
    rewardCoinsToUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    rewardCashToUser: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Aggregated stats (updated via atomic $inc)
    totalClicks: {
      type: Number,
      default: 0,
    },
    totalSignups: {
      type: Number,
      default: 0,
    },
    totalVerifiedUsers: {
      type: Number,
      default: 0,
    },
    totalFirstMatches: {
      type: Number,
      default: 0,
    },
    totalMatchesPlayed: {
      type: Number,
      default: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
    },
    totalCommissionEarned: {
      type: Number,
      default: 0,
    },
    totalCommissionPaid: {
      type: Number,
      default: 0,
    },

    expiresAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

referralCodeSchema.virtual('pendingCommission').get(function () {
  return (this.totalCommissionEarned || 0) - (this.totalCommissionPaid || 0);
});

referralCodeSchema.set('toJSON', { virtuals: true });
referralCodeSchema.set('toObject', { virtuals: true });

referralCodeSchema.index({ code: 1 }, { unique: true, name: 'referral_code_unique' });
referralCodeSchema.index({ isActive: 1, expiresAt: 1 }, { name: 'referral_active_expiry' });

module.exports = mongoose.model('ReferralCode', referralCodeSchema);
