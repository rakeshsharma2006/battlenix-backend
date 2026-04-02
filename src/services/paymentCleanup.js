const Payment = require('../models/Payment');
const logger = require('../utils/logger');

const TIMEOUT_MINUTES = 15;
const LOCK_TIMEOUT_MINUTES = 2;
const INTERVAL_MS = 60 * 1000;

let isCleanupRunning = false;

const cleanupStalePendingPayments = async () => {
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);
  const result = await Payment.updateMany(
    {
      status: 'PENDING',
      createdAt: { $lt: cutoff },
    },
    {
      $set: {
        status: 'FAILED',
        processingAt: null,
      },
    }
  );

  if (result.modifiedCount > 0) {
    logger.info('Payment cleanup: Expired pending payments', {
      count: result.modifiedCount,
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
      $set: { processingAt: null },
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

  isCleanupRunning = true;
  try {
    await cleanupStalePendingPayments();
    await cleanupStaleProcessingLocks();
  } catch (error) {
    logger.error('Payment cleanup error', { error: error.message });
  } finally {
    isCleanupRunning = false;
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
