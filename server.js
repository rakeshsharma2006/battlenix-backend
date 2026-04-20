require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const { startPaymentCleanupJob } = require('./src/services/paymentCleanup');
const { startMatchLifecycleJob } = require('./src/services/matchLifecycleJob');
const { startLeaderboardResetJob } = require('./src/services/leaderboardResetJob');
const { initializeSocket } = require('./src/services/socketService');

const PORT = process.env.PORT || 5000;

// ─── Process-level error handling ──────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

connectDB()
  .then(() => {
    const httpServer = http.createServer(app);
    initializeSocket(httpServer);

    httpServer.listen(PORT, () => {
      logger.info('Server is running', { port: PORT });
      startPaymentCleanupJob();
      startMatchLifecycleJob();
      startLeaderboardResetJob();
    });
  })
  .catch((err) => {
    logger.error('Failed to connect to database', { error: err.message });
    process.exit(1);
  });
