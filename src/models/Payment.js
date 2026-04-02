const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
    },
    razorpay_order_id: {
      type: String,
      required: true,
      unique: true,
    },
    razorpay_payment_id: {
      type: String,
      default: null,
    },
    razorpay_signature: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true, // stored in rupees (e.g. 50 = Rs 50)
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    processingAt: {
      type: Date,
      default: null,
    },
    refundId: {
      type: String,
      default: null,
    },
    refundStatus: {
      type: String,
      enum: ['PENDING', 'PROCESSED', 'FAILED', null],
      default: null,
    },
    refundAmount: {
      type: Number,
      default: null, // stored in rupees
    },
    refundReason: {
      type: String,
      default: null,
      trim: true,
    },
    refundCreatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

paymentSchema.index(
  { userId: 1, matchId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PENDING' },
  }
);
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ refundStatus: 1, refundCreatedAt: -1 });
paymentSchema.index({ processingAt: 1, status: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
