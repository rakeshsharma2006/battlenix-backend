const mongoose = require('mongoose');

const referralActivityLogSchema = new mongoose.Schema(
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
    event: {
      type: String,
      enum: [
        'CODE_CREATED',
        'CODE_DISABLED',
        'PAYOUT_MARKED_PAID',
        'HIGH_FRAUD_DETECTED',
        'MANUAL_NOTE',
        'COMMISSION_CREATED',
        'COMMISSION_REVERSED',
        'EXPORT_GENERATED',
      ],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
  { timestamps: false }
);

referralActivityLogSchema.index(
  { referralCodeId: 1, createdAt: -1 },
  { name: 'activity_code_date' }
);

module.exports = mongoose.model('ReferralActivityLog', referralActivityLogSchema);
