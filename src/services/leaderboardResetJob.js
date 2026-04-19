const logger = require('../utils/logger');
const {
  handleWeeklyLeaderboardRollover,
  handleMonthlyLeaderboardRollover,
} = require('./leaderboardService');

const INTERVAL_MS = 60 * 60 * 1000;

let isLeaderboardResetRunning = false;

const runLeaderboardResetSweep = async () => {
  if (isLeaderboardResetRunning) {
    logger.warn('Leaderboard reset job skipped because a previous run is still in progress');
    return;
  }

  isLeaderboardResetRunning = true;
  try {
    await handleWeeklyLeaderboardRollover();
    await handleMonthlyLeaderboardRollover();
  } catch (error) {
    logger.error('Leaderboard reset job failed', { error: error.message });
  } finally {
    isLeaderboardResetRunning = false;
  }
};

const startLeaderboardResetJob = () => {
  logger.info('Leaderboard reset job started', { intervalMs: INTERVAL_MS });
  runLeaderboardResetSweep();
  setInterval(runLeaderboardResetSweep, INTERVAL_MS);
};

module.exports = { startLeaderboardResetJob };
