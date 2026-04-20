const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const passport = require('./src/config/passport');
const { globalLimiter } = require('./src/middlewares/rateLimiters');
const logger = require('./src/utils/logger');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

// ─── CORS ──────────────────────────────────────────────────────────────────
// Production: only the explicit FRONTEND_ORIGIN env var is allowed.
// Development: common LAN and localhost ranges are allowed.
let allowedOrigins;
if (process.env.NODE_ENV === 'production') {
  const prodOrigin = process.env.FRONTEND_ORIGIN;
  if (!prodOrigin) {
    logger.warn(
      '[CORS] FRONTEND_ORIGIN is not set in production — all origins will be BLOCKED. ' +
      'Set FRONTEND_ORIGIN=https://yourdomain.com in your environment.'
    );
  }
  allowedOrigins = prodOrigin ? [prodOrigin] : [];
} else {
  allowedOrigins = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
    /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  ];
}

app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use('/payment/webhook', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/support')) {
    return next();
  }
  express.json({ limit: '100kb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path.startsWith('/support')) {
    return next();
  }
  express.urlencoded({ extended: true, limit: '100kb' })(req, res, next);
});
app.use(passport.initialize());
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
