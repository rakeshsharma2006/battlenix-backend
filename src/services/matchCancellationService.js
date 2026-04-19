const Match = require('../models/Match');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');
const { processRefund } = require('../controllers/paymentController');
const { emitMatchSocketEvent, emitMatchUpdated } = require('./matchLifecycleService');

const cancelMatchAndRefund = async (matchId, options = {}) => {
  const match = await Match.findById(matchId);

  if (!match) {
    return null;
  }

  if (match.status === 'COMPLETED') {
    const error = new Error('Completed matches cannot be cancelled');
    error.statusCode = 400;
    throw error;
  }

  const wasAlreadyCancelled = match.status === 'CANCELLED';

  if (!wasAlreadyCancelled) {
    match.status = 'CANCELLED';
    await match.save();
  }

  const successfulPayments = await Payment.find({
    matchId: match._id,
    status: 'SUCCESS',
  }).select('_id refundStatus');

  const refundReason = options.refundReason || 'Match cancelled';
  const refunds = [];

  // processRefund is already idempotent, so repeated cancellations safely
  // reconcile any successful payments that still need refund processing.
  for (const payment of successfulPayments) {
    const refundedPayment = await processRefund(payment._id, refundReason);
    refunds.push({
      paymentId: payment._id,
      refundStatus: refundedPayment?.refundStatus ?? payment.refundStatus ?? null,
    });
  }

  if (!wasAlreadyCancelled && options.emit !== false) {
    const reason = options.reason || refundReason;

    emitMatchSocketEvent('match_cancelled', {
      matchId: match._id,
      status: 'CANCELLED',
      reason,
    }, { type: 'PARTIAL' });
    emitMatchUpdated(match, { includeSensitive: options.includeSensitive });
  }

  logger.info('Match cancelled with refund reconciliation', {
    matchId: match._id,
    actorId: options.actorId || null,
    refundReason,
    refundedPayments: refunds.length,
    wasAlreadyCancelled,
  });

  return {
    match,
    refunds,
    wasAlreadyCancelled,
  };
};

module.exports = {
  cancelMatchAndRefund,
};
