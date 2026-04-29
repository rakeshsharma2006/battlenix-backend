const mongoose = require('mongoose');

const creatorPayoutSchema = new mongoose.Schema(
  {
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
    creatorName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ['UPI', 'BANK', 'CASH'],
      default: 'UPI',
    },
    transactionRef: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

creatorPayoutSchema.index({ referralCodeId: 1, paidAt: -1 }, { name: 'payout_code_date' });

module.exports = mongoose.model('CreatorPayout', creatorPayoutSchema);
