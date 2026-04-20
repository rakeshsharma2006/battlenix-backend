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
      default: null,
    },
    razorpay_order_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
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
    currency: {
      type: String,
      required: true,
      default: 'INR',
      trim: true,
      uppercase: true,
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
    refundPaymentId: {
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
    refundRetryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundLastAttemptAt: {
      type: Date,
      default: null,
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

// Safety-net TTL: MongoDB automatically removes PENDING payment documents
// that are older than 20 minutes. This handles the case where the client
// crashed or lost connectivity before cancel-order could fire, preventing
// users from being permanently blocked from re-joining.
paymentSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 1200, // 20 minutes
    partialFilterExpression: { status: 'PENDING' },
    name: 'pending_payment_ttl',
  }
);

module.exports = mongoose.model('Payment', paymentSchema);

