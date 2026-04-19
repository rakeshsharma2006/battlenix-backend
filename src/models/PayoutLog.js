const mongoose = require('mongoose');

const payoutLogSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
      index: true,
    },
    winnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    winnerUsername: {
      type: String,
      required: true,
      trim: true,
    },
    winnerUpiId: {
      type: String,
      required: true,
      trim: true,
    },
    winnerGameUID: {
      type: String,
      default: null,
      trim: true,
    },
    winnerGameName: {
      type: String,
      default: null,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    matchTitle: {
      type: String,
      required: true,
    },
    matchMap: {
      type: String,
      default: null,
    },
    matchMode: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID'],
      default: 'PENDING',
      index: true,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    paidByUsername: {
      type: String,
      default: null,
    },
    paidAt: {
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

payoutLogSchema.index({ status: 1, createdAt: -1 });
payoutLogSchema.index({ matchId: 1, winnerId: 1 });

module.exports = mongoose.model('PayoutLog', payoutLogSchema);
