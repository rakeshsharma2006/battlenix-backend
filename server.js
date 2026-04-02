require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const { startPaymentCleanupJob } = require('./src/services/paymentCleanup');
const { startMatchLifecycleJob } = require('./src/services/matchLifecycleJob');
const { initializeSocket } = require('./src/services/socketService');

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    const httpServer = http.createServer(app);
    initializeSocket(httpServer);

    httpServer.listen(PORT, () => {
      logger.info('Server is running', { port: PORT });
      startPaymentCleanupJob();
      startMatchLifecycleJob();
    });
  })
  .catch((err) => {
    logger.error('Failed to connect to database', { error: err.message });
    process.exit(1);
  });
