const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const { globalLimiter } = require('./src/middlewares/rateLimiters');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());

app.use('/payment/webhook', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(globalLimiter);

app.use('/', routes);

app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  const logger = require('./src/utils/logger');
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    message: 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' ? { error: err.message } : {}),
  });
});

module.exports = app;
