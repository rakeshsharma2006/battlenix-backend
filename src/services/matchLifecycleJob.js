const Match = require('../models/Match');
const logger = require('../utils/logger');
const { runLifecycleSweep } = require('./matchLifecycleService');
const { cancelMatchAndRefund } = require('./matchCancellationService');

const INTERVAL_MS = 30 * 1000;

let isSweepRunning = false;

const executeLifecycleSweep = async () => {
  if (isSweepRunning) {
    logger.warn('Match lifecycle sweep skipped because a previous run is still in progress');
    return;
  }

  isSweepRunning = true;
  try {
    await runLifecycleSweep();

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const expiredFriendRooms = await Match.find({
      status: 'UPCOMING',
      slotType: 'FRIENDS',
      createdAt: { $lte: thirtyMinAgo },
      $expr: { $lt: ['$playersCount', '$maxPlayers'] },
    });

    for (const match of expiredFriendRooms) {
      try {
        await cancelMatchAndRefund(match._id, {
          reason: 'Friends room expired - not enough players joined in 30 minutes',
          refundReason: 'Friends room expired',
        });

        logger.info('Friends room expired and cancelled', {
          matchId: match._id,
          playersCount: match.playersCount,
        });
      } catch (error) {
        logger.error('Failed to expire friends room', {
          matchId: match._id,
          error: error.message,
        });
      }
    }
  } catch (error) {
    logger.error('Match lifecycle sweep failed', { error: error.message });
  } finally {
    isSweepRunning = false;
  }
};

const startMatchLifecycleJob = () => {
  logger.info('Match lifecycle job started', { intervalMs: INTERVAL_MS });
  executeLifecycleSweep();
  setInterval(executeLifecycleSweep, INTERVAL_MS);
};

module.exports = { startMatchLifecycleJob };
