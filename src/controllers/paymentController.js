const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../models/Payment');
const Match = require('../models/Match');
const User = require('../models/User');
const logger = require('../utils/logger');

let razorpayClient = null;

const getRazorpayClient = () => {
  if (razorpayClient) {
    return razorpayClient;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay is not configured');
    error.code = 'RAZORPAY_NOT_CONFIGURED';
    throw error;
  }

  razorpayClient = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  return razorpayClient;
};

const PROCESSING_LOCK_TTL_MS = 2 * 60 * 1000;
const ORDER_RESERVATION_PREFIX = 'pending_';
const PENDING_ORDER_TTL_MINUTES = 15;
const ORDER_RESERVATION_TTL_MS = PENDING_ORDER_TTL_MINUTES * 60 * 1000;
const MAX_REFUND_RETRY_ATTEMPTS = 3;
const REFUND_RETRY_DELAY_MS = 1000;
const VALID_ENTRY_FEES = [20, 30, 50, 100];
const ACTIVE_MATCH_STATUSES = ['UPCOMING', 'READY', 'LIVE'];
const TEAM_SIZE_BY_MODE = {
  Solo: 1,
  Duo: 2,
  Squad: 4,
};

const getStaleLockCutoff = () => new Date(Date.now() - PROCESSING_LOCK_TTL_MS);
const getStaleReservationCutoff = () => new Date(Date.now() - ORDER_RESERVATION_TTL_MS);

const isProcessingLockExpired = (processingAt) => (
  Boolean(processingAt) && new Date(processingAt).getTime() < getStaleLockCutoff().getTime()
);

const isTemporaryOrderId = (orderId) => typeof orderId === 'string' && orderId.startsWith(ORDER_RESERVATION_PREFIX);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const claimStaleReservationFailure = async (paymentId, razorpayOrderId) => Payment.findOneAndUpdate(
  {
    _id: paymentId,
    status: 'PENDING',
    razorpay_order_id: razorpayOrderId,
    createdAt: { $lt: getStaleReservationCutoff() },
  },
  {
    $set: {
      status: 'FAILED',
      processingAt: null,
    },
  },
  { new: true }
);

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

const hasUserJoinedMatch = (matchId, userId, options = {}) => {
  const matchQuery = Match.exists({
    _id: matchId,
    players: userId,
  });

  if (options.session) {
    matchQuery.session(options.session);
  }

  return matchQuery;
};

const getTeamSize = (mode) => TEAM_SIZE_BY_MODE[mode] || 1;

const findActiveMatchForUser = ({ userId, excludeMatchId = null, session = null }) => {
  const query = {
    players: userId,
    status: { $in: ACTIVE_MATCH_STATUSES },
  };

  if (excludeMatchId) {
    query._id = { $ne: excludeMatchId };
  }

  const matchQuery = Match.findOne(query).select('_id status');
  if (session) {
    matchQuery.session(session);
  }

  return matchQuery;
};

const acquireUserMatchLock = async ({ userId, session }) => {
  // Touch the user document inside the transaction so concurrent join attempts
  // for the same user conflict instead of both slipping past the active-match check.
  const user = await User.findOneAndUpdate(
    { _id: userId },
    { $currentDate: { updatedAt: true } },
    { new: false, session, select: '_id' }
  );

  if (!user) {
    throw new Error('User not found');
  }
};

const atomicJoin = async (matchId, userId, maxPlayers, options = {}) => {
  const teamSize = getTeamSize(options.mode);
  const nextPlayersCount = { $add: ['$playersCount', 1] };
  const matchQuery = Match.findOneAndUpdate(
    {
      _id: matchId,
      status: 'UPCOMING',
      playersCount: { $lt: maxPlayers },
      players: { $ne: userId },
    },
    [
      {
        $set: {
          players: {
            $concatArrays: [
              { $ifNull: ['$players', []] },
              [userId],
            ],
          },
          playerAssignments: {
            $concatArrays: [
              { $ifNull: ['$playerAssignments', []] },
              [{
                userId,
                teamId: {
                  $add: [
                    { $floor: { $divide: ['$playersCount', teamSize] } },
                    1,
                  ],
                },
                slot: {
                  $add: [
                    { $mod: ['$playersCount', teamSize] },
                    1,
                  ],
                },
              }],
            ],
          },
          playersCount: nextPlayersCount,
          status: {
            $cond: [
              { $eq: [nextPlayersCount, maxPlayers] },
              'READY',
              'UPCOMING',
            ],
          },
        },
      },
    ],
    { new: true }
  );

  if (options.session) {
    matchQuery.session(options.session);
  }

  return matchQuery;
};

const markPaymentSuccessful = async ({
  paymentId,
  razorpayPaymentId,
  razorpaySignature = null,
  session = null,
}) => {
  const update = {
    $set: {
      status: 'SUCCESS',
      processingAt: null,
      razorpay_payment_id: razorpayPaymentId,
    },
  };

  if (razorpaySignature !== null) {
    update.$set.razorpay_signature = razorpaySignature;
  }

  const paymentQuery = Payment.findOneAndUpdate(
    { _id: paymentId, status: 'PENDING' },
    update,
    { new: true }
  );

  if (session) {
    paymentQuery.session(session);
  }

  const updatedPayment = await paymentQuery;
  if (updatedPayment) {
    return updatedPayment;
  }

  const fallbackQuery = Payment.findById(paymentId);
  if (session) {
    fallbackQuery.session(session);
  }

  return fallbackQuery;
};

const markPaymentFailed = async ({
  paymentId,
  razorpayPaymentId,
  razorpaySignature = null,
  session = null,
}) => {
  const update = {
    $set: {
      status: 'FAILED',
      processingAt: null,
      razorpay_payment_id: razorpayPaymentId,
    },
  };

  if (razorpaySignature !== null) {
    update.$set.razorpay_signature = razorpaySignature;
  }

  const paymentQuery = Payment.findByIdAndUpdate(paymentId, update, { new: true });
  if (session) {
    paymentQuery.session(session);
  }

  return paymentQuery;
};

const validateCapturedPaymentRecord = ({
  paymentRecord,
  razorpayOrderId,
  razorpayPaymentId,
  amount,
  currency,
  status,
}) => {
  const expectedCurrency = paymentRecord.currency || 'INR';

  if (paymentRecord.razorpay_order_id !== razorpayOrderId) {
    return { valid: false, code: 'ORDER_MISMATCH', message: 'Payment order mismatch' };
  }

  if (paymentRecord.amount * 100 !== amount) {
    return { valid: false, code: 'AMOUNT_MISMATCH', message: 'Payment amount mismatch' };
  }

  if (currency !== 'INR' || expectedCurrency !== currency) {
    return { valid: false, code: 'CURRENCY_MISMATCH', message: 'Payment currency mismatch' };
  }

  if (status !== 'captured') {
    return { valid: false, code: 'NOT_CAPTURED', message: 'Payment is not captured yet' };
  }

  if (
    paymentRecord.razorpay_payment_id &&
    paymentRecord.razorpay_payment_id !== razorpayPaymentId &&
    paymentRecord.status !== 'FAILED' &&
    !isProcessingLockExpired(paymentRecord.processingAt)
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
        {
          processingAt: { $exists: false },
          $or: [
            { razorpay_payment_id: { $exists: false } },
            { razorpay_payment_id: null },
            { razorpay_payment_id: razorpayPaymentId },
          ],
        },
        {
          processingAt: null,
          $or: [
            { razorpay_payment_id: { $exists: false } },
            { razorpay_payment_id: null },
            { razorpay_payment_id: razorpayPaymentId },
          ],
        },
        { processingAt: { $lt: staleLockCutoff } },
      ],
    },
    {
      $set: {
        razorpay_payment_id: razorpayPaymentId,
        ...updateFields,
        processingAt: now,
      },
    },
    { new: true }
  );
};

const processRefund = async (paymentId, reason, options = {}) => {
  const providedPaymentId = options.razorpayPaymentId || null;
  const currentPayment = await Payment.findById(paymentId)
    .select('refundStatus refundId refundPaymentId razorpay_payment_id refundRetryCount refundLastAttemptAt');

  if (!currentPayment) {
    logger.warn('Refund skipped because payment record was not found', { paymentId, reason });
    return null;
  }

  if (currentPayment.refundStatus === 'PENDING' || currentPayment.refundStatus === 'PROCESSED') {
    logger.info('Refund skipped because it is already pending or processed', {
      paymentId,
      refundPaymentId: currentPayment.refundPaymentId,
      refundStatus: currentPayment.refundStatus,
      refundId: currentPayment.refundId,
      reason,
    });
    return currentPayment;
  }

  if ((currentPayment.refundRetryCount || 0) >= MAX_REFUND_RETRY_ATTEMPTS) {
    logger.error('Refund skipped because retry limit has been reached', {
      paymentId,
      refundPaymentId: currentPayment.refundPaymentId || currentPayment.razorpay_payment_id,
      refundRetryCount: currentPayment.refundRetryCount,
      reason,
    });
    return currentPayment;
  }

  const lockedPayment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      ...(providedPaymentId
        ? {}
        : { razorpay_payment_id: { $exists: true, $ne: null } }),
      refundRetryCount: { $lt: MAX_REFUND_RETRY_ATTEMPTS },
      $or: [{ refundStatus: null }, { refundStatus: 'FAILED' }],
    },
    [
      {
        $set: {
          refundPaymentId: providedPaymentId || '$razorpay_payment_id',
          refundStatus: 'PENDING',
          refundLastAttemptAt: '$$NOW',
          refundReason: reason,
        },
      },
    ],
    { new: true }
  );

  if (!lockedPayment) {
    const latestPayment = await Payment.findById(paymentId);

    if (!latestPayment) {
      logger.warn('Refund skipped because payment record was not found', { paymentId, reason });
      return null;
    }

    logger.info('Refund skipped because another process claimed it first', {
      paymentId,
      refundPaymentId: latestPayment.refundPaymentId,
      refundStatus: latestPayment?.refundStatus ?? null,
      reason,
    });
    return latestPayment;
  }

  const targetPaymentId = lockedPayment.refundPaymentId || providedPaymentId;
  const initialRetryCount = lockedPayment.refundRetryCount || 0;

  if (!targetPaymentId) {
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

    logger.warn('Refund skipped because Razorpay payment id is missing', {
      paymentId,
      reason,
    });
    return updatedPayment;
  }

  let lastError = null;
  const remainingAttempts = Math.max(1, MAX_REFUND_RETRY_ATTEMPTS - initialRetryCount);

  for (let attemptIndex = 0; attemptIndex < remainingAttempts; attemptIndex += 1) {
    const attemptNumber = initialRetryCount + attemptIndex + 1;

    await Payment.findByIdAndUpdate(
      paymentId,
      {
        $set: {
          refundLastAttemptAt: new Date(),
        },
        $inc: {
          refundRetryCount: 1,
        },
      }
    );

    try {
      const razorpay = getRazorpayClient();
      const refund = await razorpay.payments.refund(targetPaymentId, {
        amount: lockedPayment.amount * 100,
        receipt: `refund_${lockedPayment._id}`,
        notes: {
          paymentId: String(lockedPayment._id),
          razorpayPaymentId: targetPaymentId,
          reason,
          attempt: String(attemptNumber),
        },
      });

      const updatedPayment = await Payment.findByIdAndUpdate(
        paymentId,
        {
          $set: {
            refundId: refund.id,
            refundPaymentId: targetPaymentId,
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
        refundPaymentId: targetPaymentId,
        refundId: refund.id,
        refundAmount: updatedPayment.refundAmount,
        refundReason: reason,
        attemptNumber,
      });
      return updatedPayment;
    } catch (error) {
      lastError = error;

      logger.error('Refund trigger attempt failed', {
        paymentId,
        refundPaymentId: targetPaymentId,
        refundReason: reason,
        attemptNumber,
        error: error.message,
      });

      if (attemptIndex < remainingAttempts - 1) {
        await wait(REFUND_RETRY_DELAY_MS * (attemptIndex + 1));
      }
    }
  }

  const updatedPayment = await Payment.findByIdAndUpdate(
    paymentId,
    {
      $set: {
        refundPaymentId: targetPaymentId,
        refundStatus: 'FAILED',
        refundReason: reason,
      },
    },
    { new: true }
  );

  logger.error('Refund trigger failed after retries', {
    paymentId,
    refundPaymentId: targetPaymentId,
    refundReason: reason,
    refundRetryCount: updatedPayment?.refundRetryCount ?? null,
    error: lastError?.message ?? 'Unknown refund failure',
  });
  return updatedPayment;
};

const processConflictRefund = async ({ payment, incomingPaymentId, source }) => {
  const refundedPayment = await processRefund(
    payment._id,
    'Payment id conflict detected',
    { razorpayPaymentId: incomingPaymentId }
  );

  logger.error(`${source}: Conflicting captured payment refunded`, {
    paymentId: payment._id,
    storedPaymentId: payment.razorpay_payment_id,
    incomingPaymentId,
    refundStatus: refundedPayment?.refundStatus ?? null,
  });

  return refundedPayment || payment;
};

const diagnoseJoinFailure = async (matchId, userId, options = {}) => {
  const matchQuery = Match.findById(matchId).select('status playersCount maxPlayers');
  if (options.session) {
    matchQuery.session(options.session);
  }

  const match = await matchQuery;
  if (!match) return { status: 404, message: 'Match not found' };

  const conflictingMatch = await findActiveMatchForUser({
    userId,
    excludeMatchId: matchId,
    session: options.session,
  });

  if (conflictingMatch) {
    return { status: 'ACTIVE_MATCH', message: 'User is already in an active match' };
  }

  const alreadyJoined = await hasUserJoinedMatch(matchId, userId, options);

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

const settleStandalonePayment = async ({
  paymentId,
  razorpayPaymentId,
  razorpaySignature = null,
  source,
}) => {
  const successfulPayment = await markPaymentSuccessful({
    paymentId,
    razorpayPaymentId,
    razorpaySignature,
  });

  if (!successfulPayment) {
    return { kind: 'NOT_FOUND' };
  }

  logger.info(`${source}: Standalone payment settled successfully`, {
    paymentId: successfulPayment._id,
    orderId: successfulPayment.razorpay_order_id,
    userId: successfulPayment.userId,
  });

  return { kind: 'SUCCESS', payment: successfulPayment, match: null };
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
      latestPayment.status === 'PENDING' &&
      !isProcessingLockExpired(latestPayment.processingAt)
    ) {
      const refundedPayment = await processConflictRefund({
        payment: latestPayment,
        incomingPaymentId: razorpayPaymentId,
        source,
      });
      return { kind: 'PAYMENT_ID_CONFLICT', payment: refundedPayment };
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

  if (!lockedPayment.matchId) {
    return settleStandalonePayment({
      paymentId: lockedPayment._id,
      razorpayPaymentId,
      razorpaySignature,
      source,
    });
  }

  const session = await User.startSession();
  let settlement = null;

  try {
    let attempts = 0;

    while (attempts < 3) {
      attempts += 1;

      try {
        await session.withTransaction(async () => {
          await acquireUserMatchLock({ userId: lockedPayment.userId, session });

          const paymentInTransaction = await Payment.findOne({
            _id: lockedPayment._id,
            status: 'PENDING',
          }).session(session);

          if (!paymentInTransaction) {
            settlement = {
              kind: 'IN_PROGRESS',
              payment: await Payment.findById(lockedPayment._id).session(session),
            };
            return;
          }

          const match = await Match.findById(paymentInTransaction.matchId)
            .select('maxPlayers mode')
            .session(session);

          if (!match) {
            const failedPayment = await markPaymentFailed({
              paymentId: paymentInTransaction._id,
              razorpayPaymentId,
              razorpaySignature,
              session,
            });

            settlement = {
              kind: 'FAILED',
              payment: failedPayment,
              diagnosis: { status: 404, message: 'Match not found' },
            };
            return;
          }

          const conflictingMatch = await findActiveMatchForUser({
            userId: paymentInTransaction.userId,
            excludeMatchId: paymentInTransaction.matchId,
            session,
          });

          if (conflictingMatch) {
            const failedPayment = await markPaymentFailed({
              paymentId: paymentInTransaction._id,
              razorpayPaymentId,
              razorpaySignature,
              session,
            });

            settlement = {
              kind: 'FAILED',
              payment: failedPayment,
              diagnosis: {
                status: 'ACTIVE_MATCH',
                message: 'User is already in an active match',
              },
            };
            return;
          }

          const updatedMatch = await atomicJoin(
            paymentInTransaction.matchId,
            paymentInTransaction.userId,
            match.maxPlayers,
            { session, mode: match.mode }
          );

          if (!updatedMatch) {
            const diagnosis = await diagnoseJoinFailure(
              paymentInTransaction.matchId,
              paymentInTransaction.userId,
              { session }
            );

            const failedPayment = await markPaymentFailed({
              paymentId: paymentInTransaction._id,
              razorpayPaymentId,
              razorpaySignature,
              session,
            });

            settlement = {
              kind: 'FAILED',
              payment: failedPayment,
              diagnosis,
            };
            return;
          }

          const successfulPayment = await markPaymentSuccessful({
            paymentId: paymentInTransaction._id,
            razorpayPaymentId,
            razorpaySignature,
            session,
          });

          settlement = {
            kind: 'SUCCESS',
            payment: successfulPayment,
            match: updatedMatch,
          };
        });

        break;
      } catch (error) {
        if (
          attempts < 3 &&
          error.hasErrorLabel &&
          error.hasErrorLabel('TransientTransactionError')
        ) {
          logger.warn(`${source}: Retrying payment settlement after transient transaction error`, {
            paymentId: lockedPayment._id,
            attempts,
          });
          continue;
        }

        throw error;
      }
    }
  } finally {
    await session.endSession();
  }

  if (!settlement) {
    return { kind: 'NOT_FOUND' };
  }

  if (settlement.kind === 'FAILED') {
    const diagnosis = settlement.diagnosis || { status: 'UNKNOWN', message: 'Unable to join match' };
    const refundReason =
      diagnosis.status === 'FULL'
        ? 'Match full'
        : diagnosis.status === 'DUPLICATE'
          ? 'Duplicate join prevented'
          : diagnosis.status === 'ACTIVE_MATCH'
            ? 'User already in active match'
            : diagnosis.status === 404
              ? 'Match not found'
              : diagnosis.message;

    const refundedPayment = await processRefund(settlement.payment._id, refundReason);

    logger.warn(`${source}: Join failed after payment capture`, {
      paymentId: settlement.payment._id,
      orderId: settlement.payment.razorpay_order_id,
      matchId: settlement.payment.matchId,
      userId: settlement.payment.userId,
      reason: diagnosis.message,
    });

    return {
      kind: 'FAILED_REFUNDED',
      payment: refundedPayment || settlement.payment,
      diagnosis,
    };
  }

  if (settlement.kind === 'SUCCESS') {
    logger.info(`${source}: Payment settled and user joined match`, {
      paymentId: settlement.payment._id,
      orderId: settlement.payment.razorpay_order_id,
      matchId: settlement.payment.matchId,
      userId: settlement.payment.userId,
      playersJoined: settlement.match.playersCount,
      maxPlayers: settlement.match.maxPlayers,
      matchStatus: settlement.match.status,
    });

    // ── Referral commission (fire-and-forget, never blocks payment) ──
    if (settlement.payment.amount > 0) {
      try {
        const { processReferralCommission } = require('./referralController');
        processReferralCommission({
          userId: settlement.payment.userId,
          entryFee: settlement.payment.amount,
          paymentId: settlement.payment._id,
          matchId: settlement.payment.matchId || null,
        }).catch((err) => {
          logger.error('Referral commission processing failed (non-fatal)', {
            userId: settlement.payment.userId,
            error: err.message,
          });
        });
      } catch (refErr) {
        logger.error('Referral commission import/call failed (non-fatal)', {
          error: refErr.message,
        });
      }
    }
  }

  return settlement;
};

const createOrder = async (req, res) => {
  try {
    const { matchId, entryFee } = req.body;
    const userId = req.user._id;
    let match = null;
    let amount = null;
    const paymentMatchId = matchId || null;

    if (!matchId && entryFee === undefined) {
      return res.status(400).json({ message: 'Either matchId or entryFee is required' });
    }

    if (matchId) {
      match = await Match.findById(matchId)
        .select('title status playersCount maxPlayers entryFee entryType mode');

      if (!match) {
        return res.status(404).json({ message: 'Match not found' });
      }

      const isFreeMatch = match.entryFee === 0 || match.entryType === 'FREE';

      const activeMatch = await Match.findOne({
        players: userId,
        _id: { $ne: matchId },
        status: { $in: ['UPCOMING', 'READY', 'LIVE'] },
      }).select('_id');
      if (activeMatch) {
        return res.status(400).json({
          message: 'You are already in an active match. Complete or wait for it to finish.',
        });
      }

      const successPayment = await Payment.findOne({
        userId: req.user._id,
        matchId,
        status: 'SUCCESS',
      }).select('_id matchId entryType');
      if (successPayment) {
        return res.status(200).json({
          message: 'already_joined',
          already_joined: true,
          free_match: isFreeMatch,
          payment_id: successPayment._id,
          match_id: successPayment.matchId,
        });
      }

      const alreadyJoined = await hasUserJoinedMatch(matchId, userId);
      if (alreadyJoined) {
        return res.status(200).json({
          message: 'already_joined',
          already_joined: true,
          free_match: isFreeMatch,
          match_id: matchId,
        });
      }

      if (match.status !== 'UPCOMING') {
        return res.status(400).json({ message: getJoinRestrictionMessage(match.status) });
      }

      if (match.playersCount >= match.maxPlayers) {
        return res.status(400).json({ message: 'Match is full' });
      }

      if (isFreeMatch) {
        const updatedMatch = await atomicJoin(matchId, userId, match.maxPlayers, { mode: match.mode });

        if (!updatedMatch) {
          const diagnosis = await diagnoseJoinFailure(matchId, userId);

          if (diagnosis.status === 'DUPLICATE') {
            return res.status(200).json({
              message: 'already_joined',
              already_joined: true,
              free_match: true,
              match_id: matchId,
            });
          }

          return res.status(diagnosis.status === 404 ? 404 : 400).json({
            message: diagnosis.message,
          });
        }

        let freePayment = await Payment.findOne({
          userId,
          matchId,
          status: 'SUCCESS',
        }).select('_id');

        if (!freePayment) {
          try {
            freePayment = await Payment.create({
              userId,
              matchId,
              razorpay_order_id: `free_${matchId}_${userId}_${crypto.randomUUID()}`,
              amount: 0,
              currency: 'INR',
              status: 'SUCCESS',
              entryType: 'FREE',
            });
          } catch (error) {
            logger.warn('Free match joined but payment record could not be created immediately', {
              userId,
              matchId,
              error: error.message,
            });
          }
        }

        logger.info('User joined free match via createOrder', {
          userId,
          matchId,
          matchTitle: updatedMatch.title,
          playersJoined: updatedMatch.playersCount,
          matchStatus: updatedMatch.status,
        });

        return res.status(200).json({
          message: 'Joined free match!',
          already_joined: false,
          free_match: true,
          payment_id: freePayment?._id || null,
          players_joined: updatedMatch.playersCount,
          match_status: updatedMatch.status,
        });
      }

      amount = match.entryFee;
    } else {
      amount = Number(entryFee);
      if (!VALID_ENTRY_FEES.includes(amount)) {
        return res.status(400).json({ message: 'Entry fee must be 20, 30, 50, or 100' });
      }
    }

    const existingPending = await Payment.findOne({
      userId,
      matchId: paymentMatchId,
      status: 'PENDING',
    }).select('razorpay_order_id amount createdAt processingAt');

    if (existingPending) {
      if (isTemporaryOrderId(existingPending.razorpay_order_id)) {
        const releasedReservation = await claimStaleReservationFailure(
          existingPending._id,
          existingPending.razorpay_order_id
        );

        if (!releasedReservation) {
          logger.info('Pending order reservation already exists', {
            userId,
            matchId: paymentMatchId,
            paymentId: existingPending._id,
          });

          return res.status(202).json({
            message: 'Order creation already in progress. Retry shortly.',
            payment_id: existingPending._id,
          });
        }

        logger.warn('Released stale pending order reservation before retrying order creation', {
          userId,
          matchId: paymentMatchId,
          paymentId: releasedReservation._id,
          staleOrderId: releasedReservation.razorpay_order_id,
        });
      } else {
        const ageMinutes = (
          Date.now() - new Date(existingPending.createdAt).getTime()
        ) / 1000 / 60;
        const isStale =
          isProcessingLockExpired(existingPending.processingAt) ||
          ageMinutes > PENDING_ORDER_TTL_MINUTES;

        if (isStale) {
          const released = await Payment.findOneAndUpdate(
            {
              _id: existingPending._id,
              status: 'PENDING',
              razorpay_order_id: existingPending.razorpay_order_id,
            },
            { $set: { status: 'FAILED', processingAt: null } },
            { new: true }
          );

          if (released) {
            logger.warn('Released stale real-order PENDING payment before retrying', {
              userId,
              matchId: paymentMatchId,
              paymentId: released._id,
              staleOrderId: released.razorpay_order_id,
              ageMinutes,
            });
          } else {
            return res.status(202).json({
              message: 'Order creation already in progress. Retry shortly.',
              payment_id: existingPending._id,
            });
          }
        } else {
          logger.info('Returning existing non-stale pending order', {
            userId,
            matchId: paymentMatchId,
            paymentId: existingPending._id,
          });

          return res.status(200).json({
            message: 'pending_order_exists',
            order_id: existingPending.razorpay_order_id,
            amount: existingPending.amount * 100,
            currency: 'INR',
            payment_id: existingPending._id,
          });
        }
      }
    }

    const reservationTarget = paymentMatchId || ('prepay_' + amount);
    const reservationOrderId = ORDER_RESERVATION_PREFIX + reservationTarget + '_' + userId + '_' + crypto.randomUUID();
    let paymentReservation;
    try {
      paymentReservation = await Payment.create({
        userId,
        matchId: paymentMatchId,
        razorpay_order_id: reservationOrderId,
        amount,
        currency: 'INR',
        status: 'PENDING',
      });
    } catch (error) {
      if (error?.code === 11000) {
        const duplicatePending = await Payment.findOne({
          userId,
          matchId: paymentMatchId,
          status: 'PENDING',
        }).select('razorpay_order_id amount createdAt');

        logger.warn('Duplicate pending payment prevented by unique index', {
          userId,
          matchId: paymentMatchId,
          attemptedOrderId: reservationOrderId,
          existingOrderId: duplicatePending?.razorpay_order_id ?? null,
        });

        if (duplicatePending) {
          if (isTemporaryOrderId(duplicatePending.razorpay_order_id)) {
            const releasedReservation = await claimStaleReservationFailure(
              duplicatePending._id,
              duplicatePending.razorpay_order_id
            );

            if (!releasedReservation) {
              return res.status(202).json({
                message: 'Order creation already in progress. Retry shortly.',
                payment_id: duplicatePending._id,
              });
            }

            logger.warn('Released stale duplicate pending order reservation', {
              userId,
              matchId: paymentMatchId,
              paymentId: releasedReservation._id,
              staleOrderId: releasedReservation.razorpay_order_id,
            });

            return res.status(202).json({
              message: 'Stale pending order was released. Retry create-order.',
              payment_id: releasedReservation._id,
            });
          }

          return res.status(200).json({
            message: 'pending_order_exists',
            order_id: duplicatePending.razorpay_order_id,
            amount: duplicatePending.amount * 100,
            currency: 'INR',
            payment_id: duplicatePending._id,
          });
        }

        return res.status(409).json({ message: 'A payment is already pending.' });
      }

      throw error;
    }

    let order;
    try {
      const razorpay = getRazorpayClient();
      order = await razorpay.orders.create({
        amount: amount * 100,
        currency: 'INR',
        receipt: 'rcpt_' + paymentReservation._id,
      });
    } catch (error) {
      await Payment.findByIdAndUpdate(paymentReservation._id, {
        $set: {
          status: 'FAILED',
          processingAt: null,
        },
      });

      throw error;
    }

    const payment = await Payment.findOneAndUpdate(
      {
        _id: paymentReservation._id,
        status: 'PENDING',
        razorpay_order_id: reservationOrderId,
      },
      {
        $set: {
          razorpay_order_id: order.id,
        },
      },
      { new: true }
    );

    if (!payment) {
      logger.error('Payment reservation could not be finalized with Razorpay order', {
        paymentId: paymentReservation._id,
        userId,
        matchId: paymentMatchId,
        orderId: order.id,
      });
      return res.status(409).json({ message: 'Order creation already in progress. Retry shortly.' });
    }

    logger.info('Payment order created', {
      paymentId: payment._id,
      userId,
      matchId: paymentMatchId,
      orderId: order.id,
      amount,
    });

    return res.status(201).json({
      message: 'Order created successfully',
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      payment_id: payment._id,
    });
  } catch (error) {
    logger.error('createOrder error', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      full: JSON.stringify(error),
    });
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
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (payment.status === 'SUCCESS') {
      return res.status(200).json({
        message: payment.matchId ? 'already_joined' : 'Payment already verified successfully',
        payment_id: payment._id,
        match_id: payment.matchId,
        already_joined: Boolean(payment.matchId),
      });
    }

    if (payment.status === 'FAILED') {
      return res.status(400).json({
        message: 'Payment already failed. Create new order.',
        refund_status: payment.refundStatus,
      });
    }

    const skipVerificationForTestPayment = process.env.NODE_ENV !== 'production';

    if (skipVerificationForTestPayment) {
      logger.warn('Skipping Razorpay verification for test/development payment', {
        paymentId: payment._id,
        razorpay_order_id,
        razorpay_payment_id,
        environment: process.env.NODE_ENV,
      });
    } else {
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ message: 'Invalid payment signature' });
      }

      let razorpayPayment;
      try {
        const razorpay = getRazorpayClient();
        razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);
      } catch (error) {
        logger.error('Razorpay fetch failed', {
          error: error.message,
          paymentId: payment._id,
          razorpay_payment_id,
        });
        return res.status(502).json({ message: 'Cannot verify payment now. Retry shortly.' });
      }

      if (razorpayPayment.status !== 'captured') {
        return res.status(400).json({ message: 'Payment not captured' });
      }

      const validation = validateCapturedPaymentRecord({
        paymentRecord: payment,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        amount: razorpayPayment.amount,
        currency: razorpayPayment.currency,
        status: razorpayPayment.status,
      });

      if (!validation.valid) {
        logger.error('Payment verification rejected due to validation failure', {
          paymentId: payment._id,
          code: validation.code,
          message: validation.message,
        });

        if (
          validation.code === 'PAYMENT_ID_CONFLICT' ||
          validation.code === 'AMOUNT_MISMATCH' ||
          validation.code === 'CURRENCY_MISMATCH'
        ) {
          const refundedPayment = await processRefund(payment._id, validation.message, {
            razorpayPaymentId: razorpay_payment_id,
          });

          const statusCode = validation.code === 'PAYMENT_ID_CONFLICT' ? 409 : 400;
          return res.status(statusCode).json({
            message: validation.message,
            payment_id: payment._id,
            refund_status: refundedPayment?.refundStatus ?? null,
          });
        }

        return res.status(400).json({
          message: validation.message,
        });
      }
    }

    if (!payment.matchId) {
      const settlement = await settleStandalonePayment({
        paymentId: payment._id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature ?? null,
        source: 'Verify',
      });

      if (settlement.kind !== 'SUCCESS') {
        return res.status(404).json({ message: 'Payment record not found' });
      }

      return res.status(200).json({
        message: 'Payment verified successfully',
        payment_id: settlement.payment._id,
        match_id: null,
      });
    }

    const settlement = await settleCapturedPayment({
      paymentId: payment._id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature ?? null,
      source: 'Verify',
    });

    if (settlement.kind === 'SUCCESS') {
      return res.status(200).json({
        message: 'Payment verified. Joined!',
        payment_id: settlement.payment._id,
        match_id: settlement.payment.matchId,
        players_joined: settlement.match.playersCount,
        max_players: settlement.match.maxPlayers,
        match_status: settlement.match.status,
        already_joined: false,
      });
    }

    if (settlement.kind === 'ALREADY_SUCCESS') {
      return res.status(200).json({
        message: 'already_joined',
        payment_id: settlement.payment._id,
        match_id: settlement.payment.matchId,
        already_joined: true,
      });
    }

    if (settlement.kind === 'FAILED_REFUNDED') {
      return res.status(409).json({
        message: settlement.diagnosis.message + '. Refund initiated.',
        payment_id: settlement.payment._id,
        refund_status: settlement.payment.refundStatus,
      });
    }

    if (settlement.kind === 'ALREADY_FAILED') {
      return res.status(400).json({
        message: 'Payment already failed. Create new order.',
        payment_id: settlement.payment._id,
        refund_status: settlement.payment.refundStatus,
      });
    }

    if (settlement.kind === 'PAYMENT_ID_CONFLICT') {
      return res.status(409).json({
        message: 'Payment id conflict detected for this order.',
        payment_id: settlement.payment._id,
        refund_status: settlement.payment.refundStatus,
      });
    }

    if (settlement.kind === 'IN_PROGRESS') {
      return res.status(202).json({
        message: 'Payment is already being processed. Retry shortly.',
        payment_id: settlement.payment._id,
      });
    }

    return res.status(500).json({ message: 'Payment processing failed' });
  } catch (error) {
    logger.error('verifyPayment error', {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      message: 'Verification failed',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
};

// Cancel Order ----------------------------------------------------------------
const cancelOrder = async (req, res) => {
  try {
    const { matchId } = req.body;
    const userId = req.user._id;

    const released = await Payment.findOneAndUpdate(
      {
        userId,
        matchId: matchId || null,
        status: 'PENDING',
        $or: [
          { processingAt: { $exists: false } },
          { processingAt: null },
          { processingAt: { $lt: getStaleLockCutoff() } },
        ],
      },
      { $set: { status: 'FAILED', processingAt: null } },
      { new: true }
    );

    if (released) {
      logger.info('User cancelled pending payment order', {
        userId,
        matchId: matchId || null,
        paymentId: released._id,
        orderId: released.razorpay_order_id,
      });
    } else {
      logger.info('cancelOrder: no stale PENDING record found (already processing or none exists)', {
        userId,
        matchId: matchId || null,
      });
    }

    return res.status(200).json({ message: 'OK' });
  } catch (error) {
    logger.error('cancelOrder error', { error: error.message });
    return res.status(200).json({ message: 'OK' });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  cancelOrder,
  atomicJoin,
  hasUserJoinedMatch,
  diagnoseJoinFailure,
  processRefund,
  processConflictRefund,
  settleStandalonePayment,
  settleCapturedPayment,
  validateCapturedPaymentRecord,
  getRazorpayClient,
  ORDER_RESERVATION_PREFIX,
};
