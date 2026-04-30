require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
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

let server;

connectDB()
  .then(() => {
    server = http.createServer(app);
    initializeSocket(server);

    server.listen(PORT, () => {
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

// ─── Graceful Shutdown ─────────────────────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');

      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');
      }

      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  // Force shutdown after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
