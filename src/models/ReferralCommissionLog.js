const mongoose = require('mongoose');

const referralCommissionLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null,
    },
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReferralCode',
      required: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    commissionModel: {
      type: String,
      enum: ['PER_FIRST_MATCH', 'PERCENT_REVENUE', 'HYBRID'],
      required: true,
    },
    entryFee: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    isFirstMatch: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['CREATED', 'REVERSED'],
      default: 'CREATED',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// Unique on paymentId prevents double commission
referralCommissionLogSchema.index({ paymentId: 1 }, { unique: true, name: 'commission_payment_unique' });
referralCommissionLogSchema.index({ code: 1, createdAt: -1 }, { name: 'commission_code_date' });

module.exports = mongoose.model('ReferralCommissionLog', referralCommissionLogSchema);
