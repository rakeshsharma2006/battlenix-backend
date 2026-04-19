const crypto = require('crypto');
const Payment = require('../models/Payment');
const JobLock = require('../models/JobLock');
const logger = require('../utils/logger');
const { processRefund } = require('../controllers/paymentController');

const TIMEOUT_MINUTES = 15;
const LOCK_TIMEOUT_MINUTES = 2;
const INTERVAL_MS = 60 * 1000;
const CLEANUP_JOB_LOCK_ID = 'payment_cleanup_job';
const CLEANUP_JOB_LOCK_TTL_MS = 5 * 60 * 1000;

let isCleanupRunning = false;

const acquireCleanupJobLock = async () => {
  const now = new Date();
  const ownerId = crypto.randomUUID();
  const lockedUntil = new Date(now.getTime() + CLEANUP_JOB_LOCK_TTL_MS);

  const existingLock = await JobLock.findOneAndUpdate(
    {
      _id: CLEANUP_JOB_LOCK_ID,
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: null },
        { lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        ownerId,
        lockedUntil,
      },
    },
    { new: true }
  );

  if (existingLock) {
    return ownerId;
  }

  try {
    await JobLock.create({
      _id: CLEANUP_JOB_LOCK_ID,
      ownerId,
      lockedUntil,
    });
    return ownerId;
  } catch (error) {
    if (error?.code === 11000) {
      return null;
    }

    throw error;
  }
};

const releaseCleanupJobLock = async (ownerId) => {
  if (!ownerId) return;

  await JobLock.findOneAndUpdate(
    {
      _id: CLEANUP_JOB_LOCK_ID,
      ownerId,
    },
    {
      $set: {
        lockedUntil: new Date(),
      },
    }
  );
};

const cleanupStalePendingPayments = async () => {
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);
  const staleCapturedPayments = await Payment.find(
    {
      status: 'PENDING',
      createdAt: { $lt: cutoff },
      razorpay_payment_id: { $exists: true, $ne: null },
    }
  ).select('_id razorpay_payment_id refundStatus');

  let refundedCapturedCount = 0;

  for (const payment of staleCapturedPayments) {
    const failedPayment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: 'PENDING',
      },
      {
        $set: {
          status: 'FAILED',
          processingAt: null,
        },
      },
      { new: true }
    );

    if (!failedPayment) {
      continue;
    }

    if (
      failedPayment.razorpay_payment_id &&
      failedPayment.refundStatus !== 'PENDING' &&
      failedPayment.refundStatus !== 'PROCESSED'
    ) {
      await processRefund(failedPayment._id, 'Payment timeout cleanup', {
        razorpayPaymentId: failedPayment.razorpay_payment_id,
      });
      refundedCapturedCount += 1;
    }
  }

  const result = await Payment.updateMany(
    {
      status: 'PENDING',
      createdAt: { $lt: cutoff },
      $or: [
        { razorpay_payment_id: { $exists: false } },
        { razorpay_payment_id: null },
      ],
    },
    {
      $set: {
        status: 'FAILED',
        processingAt: null,
      },
    }
  );

  const totalExpired = refundedCapturedCount + result.modifiedCount;
  if (totalExpired > 0) {
    logger.info('Payment cleanup: Expired pending payments', {
      count: totalExpired,
      refundedCapturedCount,
      cutoff: cutoff.toISOString(),
    });
  }
};

const cleanupStaleProcessingLocks = async () => {
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000);
  const result = await Payment.updateMany(
    {
      status: 'PENDING',
      processingAt: { $ne: null, $lt: cutoff },
    },
    {
      $set: {
        processingAt: null,
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.info('Payment cleanup: Released stale settlement locks', {
      count: result.modifiedCount,
      cutoff: cutoff.toISOString(),
    });
  }
};

const runPaymentCleanup = async () => {
  if (isCleanupRunning) {
    logger.warn('Payment cleanup skipped because a previous run is still in progress');
    return;
  }

  const lockOwnerId = await acquireCleanupJobLock();
  if (!lockOwnerId) {
    logger.warn('Payment cleanup skipped because another worker holds the cleanup lock');
    return;
  }

  isCleanupRunning = true;
  try {
    await cleanupStalePendingPayments();
    await cleanupStaleProcessingLocks();
  } catch (error) {
    logger.error('Payment cleanup error', { error: error.message });
  } finally {
    isCleanupRunning = false;
    await releaseCleanupJobLock(lockOwnerId);
  }
};

const startPaymentCleanupJob = () => {
  logger.info('Payment cleanup job started', {
    intervalMs: INTERVAL_MS,
    timeoutMinutes: TIMEOUT_MINUTES,
    lockTimeoutMinutes: LOCK_TIMEOUT_MINUTES,
  });

  runPaymentCleanup();
  setInterval(runPaymentCleanup, INTERVAL_MS);
};

module.exports = {
  startPaymentCleanupJob,
  cleanupStalePendingPayments,
  cleanupStaleProcessingLocks,
};
