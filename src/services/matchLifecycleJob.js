const logger = require('../utils/logger');
const { runLifecycleSweep } = require('./matchLifecycleService');

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
