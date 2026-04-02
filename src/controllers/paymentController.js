const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Match = require('../models/Match');
const logger = require('../utils/logger');
const { promoteMatchToReadyIfEligible } = require('../services/matchLifecycleService');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PROCESSING_LOCK_TTL_MS = 2 * 60 * 1000;

const getJoinRestrictionMessage = (status) => {
  switch (status) {
    case 'READY':
      return 'Match is full and waiting to go live';
    case 'LIVE':
      return 'Match is already live';
    case 'COMPLETED':
      return 'Match is already completed';
    case 'CANCELLED':
      return 'Match has been cancelled';
    default:
      return 'Match is not open for joining';
  }
};

const atomicJoin = async (matchId, userId) => Match.findOneAndUpdate(
  {
    _id: matchId,
    status: 'UPCOMING',
    players: { $ne: userId },
    $expr: { $lt: ['$playersCount', '$maxPlayers'] },
  },
  {
    $addToSet: { players: userId },
    $inc: { playersCount: 1 },
  },
  { new: true }
);

const validateCapturedPaymentRecord = ({
  paymentRecord,
  razorpayOrderId,
  razorpayPaymentId,
  amount,
  status,
}) => {
  if (paymentRecord.razorpay_order_id !== razorpayOrderId) {
    return { valid: false, code: 'ORDER_MISMATCH', message: 'Payment order mismatch' };
  }

  if (paymentRecord.amount * 100 !== amount) {
    return { valid: false, code: 'AMOUNT_MISMATCH', message: 'Payment amount mismatch' };
  }

  if (status !== 'captured') {
    return { valid: false, code: 'NOT_CAPTURED', message: 'Payment is not captured yet' };
  }

  if (
    paymentRecord.razorpay_payment_id &&
    paymentRecord.razorpay_payment_id !== razorpayPaymentId &&
    paymentRecord.status !== 'FAILED'
  ) {
    return { valid: false, code: 'PAYMENT_ID_CONFLICT', message: 'Payment id conflict detected' };
  }

  return { valid: true };
};

const claimProcessingLock = async (paymentId, razorpayPaymentId, updateFields = {}) => {
  const now = new Date();
  const staleLockCutoff = new Date(now.getTime() - PROCESSING_LOCK_TTL_MS);

  return Payment.findOneAndUpdate(
    {
      _id: paymentId,
      status: 'PENDING',
      $or: [
        { processingAt: { $exists: false } },
        { processingAt: null },
        { processingAt: { $lt: staleLockCutoff } },
      ],
      $and: [
        {
          $or: [
            { razorpay_payment_id: { $exists: false } },
            { razorpay_payment_id: null },
            { razorpay_payment_id: razorpayPaymentId },
          ],
        },
      ],
    },
    {
      $set: {
        ...updateFields,
        processingAt: now,
      },
    },
    { new: true }
  );
};

const processRefund = async (paymentId, reason) => {
  const existingPayment = await Payment.findById(paymentId);
  if (!existingPayment) {
    logger.warn('Refund skipped because payment record was not found', { paymentId, reason });
    return null;
  }

  if (existingPayment.refundStatus === 'PROCESSED' || existingPayment.refundStatus === 'PENDING') {
    logger.info('Refund skipped because it is already processed or in progress', {
      paymentId,
      refundStatus: existingPayment.refundStatus,
      refundId: existingPayment.refundId,
      reason,
    });
    return existingPayment;
  }

  if (!existingPayment.razorpay_payment_id) {
    logger.warn('Refund skipped because Razorpay payment id is missing', {
      paymentId,
      reason,
    });
    return existingPayment;
  }

  const lockedPayment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      razorpay_payment_id: { $ne: null },
      $or: [{ refundStatus: null }, { refundStatus: 'FAILED' }],
    },
    {
      $set: {
        refundStatus: 'PENDING',
        refundReason: reason,
      },
    },
    { new: true }
  );

  if (!lockedPayment) {
    const latestPayment = await Payment.findById(paymentId);
    logger.info('Refund skipped because another process claimed it first', {
      paymentId,
      refundStatus: latestPayment?.refundStatus ?? null,
      reason,
    });
    return latestPayment;
  }

  try {
    const refund = await razorpay.payments.refund(lockedPayment.razorpay_payment_id, {
      amount: lockedPayment.amount * 100,
      receipt: `refund_${lockedPayment._id}`,
      notes: {
        paymentId: String(lockedPayment._id),
        reason,
      },
    });

    const updatedPayment = await Payment.findByIdAndUpdate(
      paymentId,
      {
        $set: {
          refundId: refund.id,
          refundStatus: 'PROCESSED',
          refundAmount: typeof refund.amount === 'number' ? refund.amount / 100 : lockedPayment.amount,
          refundReason: reason,
          refundCreatedAt: refund.created_at ? new Date(refund.created_at * 1000) : new Date(),
        },
      },
      { new: true }
    );

    logger.info('Refund triggered successfully', {
      paymentId,
      refundId: refund.id,
      refundAmount: updatedPayment.refundAmount,
      refundReason: reason,
    });
    return updatedPayment;
  } catch (error) {
    const updatedPayment = await Payment.findByIdAndUpdate(
      paymentId,
      {
        $set: {
          refundStatus: 'FAILED',
          refundReason: reason,
        },
      },
      { new: true }
    );

    logger.error('Refund trigger failed', {
      paymentId,
      refundReason: reason,
      error: error.message,
    });
    return updatedPayment;
  }
};

const diagnoseJoinFailure = async (matchId, userId) => {
  const match = await Match.findById(matchId).select('status players playersCount maxPlayers');
  if (!match) return { status: 404, message: 'Match not found' };

  const alreadyJoined = match.players.some(
    (playerId) => playerId.toString() === userId.toString()
  );

  if (alreadyJoined) {
    return { status: 'DUPLICATE', message: 'User is already in the match' };
  }

  if (match.status !== 'UPCOMING') {
    return { status: match.status, message: getJoinRestrictionMessage(match.status) };
  }

  if (match.playersCount >= match.maxPlayers) {
    return { status: 'FULL', message: 'Match is full' };
  }

  return { status: 'UNKNOWN', message: 'Unable to join match' };
};

const settleCapturedPayment = async ({
  paymentId,
  razorpayPaymentId,
  razorpaySignature = null,
  source,
}) => {
  const lockedPayment = await claimProcessingLock(paymentId, razorpayPaymentId, {
    razorpay_payment_id: razorpayPaymentId,
    ...(razorpaySignature !== null ? { razorpay_signature: razorpaySignature } : {}),
  });

  if (!lockedPayment) {
    const latestPayment = await Payment.findById(paymentId);
    if (!latestPayment) {
      return { kind: 'NOT_FOUND' };
    }

    if (
      latestPayment.razorpay_payment_id &&
      latestPayment.razorpay_payment_id !== razorpayPaymentId &&
      latestPayment.status === 'PENDING'
    ) {
      logger.error(`${source}: Payment settlement rejected due to payment id conflict`, {
        paymentId,
        storedPaymentId: latestPayment.razorpay_payment_id,
        incomingPaymentId: razorpayPaymentId,
      });
      return { kind: 'PAYMENT_ID_CONFLICT', payment: latestPayment };
    }

    if (latestPayment.status === 'SUCCESS') {
      logger.info(`${source}: Payment already settled successfully`, {
        paymentId,
        orderId: latestPayment.razorpay_order_id,
      });
      return { kind: 'ALREADY_SUCCESS', payment: latestPayment };
    }

    if (latestPayment.status === 'FAILED') {
      logger.info(`${source}: Payment already failed`, {
        paymentId,
        orderId: latestPayment.razorpay_order_id,
      });
      return { kind: 'ALREADY_FAILED', payment: latestPayment };
    }

    logger.info(`${source}: Payment settlement lock is already held`, {
      paymentId,
      orderId: latestPayment.razorpay_order_id,
      processingAt: latestPayment.processingAt,
    });
    return { kind: 'IN_PROGRESS', payment: latestPayment };
  }

  const updatedMatch = await atomicJoin(lockedPayment.matchId, lockedPayment.userId);

  if (!updatedMatch) {
    const diagnosis = await diagnoseJoinFailure(lockedPayment.matchId, lockedPayment.userId);
    const refundReason =
      diagnosis.status === 'FULL'
        ? 'Match full'
        : diagnosis.status === 'DUPLICATE'
          ? 'Duplicate join prevented'
          : diagnosis.status === 404
            ? 'Match not found'
            : diagnosis.message;

    const failedPayment = await Payment.findByIdAndUpdate(
      lockedPayment._id,
      {
        $set: {
          status: 'FAILED',
          processingAt: null,
          razorpay_payment_id: razorpayPaymentId,
          ...(razorpaySignature !== null ? { razorpay_signature: razorpaySignature } : {}),
        },
      },
      { new: true }
    );

    const refundedPayment = await processRefund(failedPayment._id, refundReason);
    logger.warn(`${source}: Join failed after payment capture`, {
      paymentId: failedPayment._id,
      orderId: failedPayment.razorpay_order_id,
      matchId: failedPayment.matchId,
      userId: failedPayment.userId,
      reason: diagnosis.message,
    });

    return {
      kind: 'FAILED_REFUNDED',
      payment: refundedPayment || failedPayment,
      diagnosis,
    };
  }

  const readyMatch = await promoteMatchToReadyIfEligible(updatedMatch._id, { source });

  const successfulPayment = await Payment.findByIdAndUpdate(
    lockedPayment._id,
    {
      $set: {
        status: 'SUCCESS',
        processingAt: null,
        razorpay_payment_id: razorpayPaymentId,
        ...(razorpaySignature !== null ? { razorpay_signature: razorpaySignature } : {}),
      },
    },
    { new: true }
  );

  const finalMatch = readyMatch || updatedMatch;
  logger.info(`${source}: Payment settled and user joined match`, {
    paymentId: successfulPayment._id,
    orderId: successfulPayment.razorpay_order_id,
    matchId: successfulPayment.matchId,
    userId: successfulPayment.userId,
    playersJoined: finalMatch.playersCount,
    maxPlayers: finalMatch.maxPlayers,
    matchStatus: finalMatch.status,
  });

  return { kind: 'SUCCESS', payment: successfulPayment, match: finalMatch };
};

const createOrder = async (req, res) => {
  try {
    const { matchId } = req.body;
    const userId = req.user._id;

    const match = await Match.findById(matchId)
      .select('status playersCount maxPlayers players entryFee');

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status !== 'UPCOMING') {
      return res.status(400).json({ message: getJoinRestrictionMessage(match.status) });
    }

    if (match.playersCount >= match.maxPlayers) {
      return res.status(400).json({ message: 'Match is full' });
    }

    const alreadyJoined = match.players.some(
      (playerId) => playerId.toString() === userId.toString()
    );
    if (alreadyJoined) {
      return res.status(400).json({ message: 'You have already joined this match' });
    }

    const existingPending = await Payment.findOne({
      userId,
      matchId,
      status: 'PENDING',
    }).select('razorpay_order_id amount');

    if (existingPending) {
      logger.info('Returning existing pending payment order', {
        userId,
        matchId,
        orderId: existingPending.razorpay_order_id,
      });

      return res.status(200).json({
        message: 'Existing pending order found',
        order_id: existingPending.razorpay_order_id,
        amount: existingPending.amount * 100,
        currency: 'INR',
        payment_id: existingPending._id,
      });
    }

    const order = await razorpay.orders.create({
      amount: match.entryFee * 100,
      currency: 'INR',
      receipt: `receipt_${matchId}_${userId}_${Date.now()}`,
    });

    let payment;
    try {
      payment = await Payment.create({
        userId,
        matchId,
        razorpay_order_id: order.id,
        amount: match.entryFee,
        status: 'PENDING',
      });
    } catch (error) {
      if (error?.code === 11000) {
        const duplicatePending = await Payment.findOne({
          userId,
          matchId,
          status: 'PENDING',
        }).select('razorpay_order_id amount');

        logger.warn('Duplicate pending payment prevented by unique index', {
          userId,
          matchId,
          attemptedOrderId: order.id,
          existingOrderId: duplicatePending?.razorpay_order_id ?? null,
        });

        if (duplicatePending) {
          return res.status(200).json({
            message: 'Existing pending order found',
            order_id: duplicatePending.razorpay_order_id,
            amount: duplicatePending.amount * 100,
            currency: 'INR',
            payment_id: duplicatePending._id,
          });
        }

        return res.status(409).json({ message: 'A payment for this match is already pending.' });
      }

      throw error;
    }

    logger.info('Payment order created', {
      paymentId: payment._id,
      userId,
      matchId,
      orderId: order.id,
      amount: match.entryFee,
    });

    return res.status(201).json({
      message: 'Order created successfully',
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      payment_id: payment._id,
    });
  } catch (error) {
    logger.error('createOrder error', { error: error.message });
    return res.status(500).json({ message: 'Failed to create order', error: error.message });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user._id;

    const payment = await Payment.findOne({ razorpay_order_id });
    if (!payment) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    if (payment.userId.toString() !== userId.toString()) {
      logger.warn('Payment verification rejected due to ownership mismatch', {
        paymentId: payment._id,
        paymentUserId: payment.userId,
        requestUserId: userId,
      });
      return res.status(403).json({ message: 'Unauthorized: Payment does not belong to you' });
    }

    if (payment.status === 'SUCCESS') {
      return res.status(200).json({
        message: 'Payment already verified and processed',
        payment_id: payment._id,
        match_id: payment.matchId,
      });
    }

    if (payment.status === 'FAILED') {
      return res.status(400).json({
        message: 'Payment has already failed. Create a new order.',
        refund_status: payment.refundStatus,
      });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      logger.warn('Payment verification failed signature check', {
        paymentId: payment._id,
        razorpay_order_id,
      });
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    let razorpayPayment;
    try {
      razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (error) {
      logger.error('Failed to fetch payment status from Razorpay during verify', {
        paymentId: payment._id,
        razorpay_order_id,
        razorpay_payment_id,
        error: error.message,
      });
      return res.status(502).json({ message: 'Unable to confirm payment capture right now. Please retry shortly.' });
    }

    logger.info('Payment verification fetched Razorpay payment', {
      paymentId: payment._id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpayStatus: razorpayPayment.status,
    });

    const validation = validateCapturedPaymentRecord({
      paymentRecord: payment,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: razorpayPayment.amount,
      status: razorpayPayment.status,
    });

    if (!validation.valid) {
      logger.error('Payment verification rejected due to validation failure', {
        paymentId: payment._id,
        code: validation.code,
        message: validation.message,
      });

      if (validation.code === 'NOT_CAPTURED') {
        return res.status(202).json({
          message: 'Payment verified. Waiting for capture confirmation.',
          payment_id: payment._id,
          match_id: payment.matchId,
        });
      }

      const statusCode = validation.code === 'PAYMENT_ID_CONFLICT' ? 409 : 400;
      return res.status(statusCode).json({ message: validation.message });
    }

    const settlement = await settleCapturedPayment({
      paymentId: payment._id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      source: 'Verify',
    });

    if (settlement.kind === 'SUCCESS') {
      return res.status(200).json({
        message: 'Payment verified. You have joined the match.',
        payment_id: settlement.payment._id,
        match_id: settlement.payment.matchId,
        players_joined: settlement.match.playersCount,
        max_players: settlement.match.maxPlayers,
        match_status: settlement.match.status,
      });
    }

    if (settlement.kind === 'ALREADY_SUCCESS') {
      return res.status(200).json({
        message: 'Payment already verified and processed',
        payment_id: settlement.payment._id,
        match_id: settlement.payment.matchId,
      });
    }

    if (settlement.kind === 'ALREADY_FAILED') {
      return res.status(400).json({
        message: 'Payment has already failed. Refund handling is complete or in progress.',
        payment_id: settlement.payment._id,
        refund_status: settlement.payment.refundStatus,
      });
    }

    if (settlement.kind === 'PAYMENT_ID_CONFLICT') {
      return res.status(409).json({
        message: 'Payment id conflict detected for this order.',
        payment_id: settlement.payment._id,
      });
    }

    if (settlement.kind === 'IN_PROGRESS') {
      return res.status(202).json({
        message: 'Payment is already being processed. Retry shortly.',
        payment_id: settlement.payment._id,
      });
    }

    if (settlement.kind === 'FAILED_REFUNDED') {
      return res.status(409).json({
        message: `${settlement.diagnosis.message}. Payment failed and refund handling has started.`,
        payment_id: settlement.payment._id,
        refund_status: settlement.payment.refundStatus,
      });
    }

    return res.status(404).json({ message: 'Payment record not found' });
  } catch (error) {
    logger.error('verifyPayment error', { error: error.message });
    return res.status(500).json({ message: 'Verification failed', error: error.message });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  atomicJoin,
  diagnoseJoinFailure,
  processRefund,
  settleCapturedPayment,
  validateCapturedPaymentRecord,
};
