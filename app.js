const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const passport = require('./src/config/passport');
const { globalLimiter } = require('./src/middlewares/rateLimiters');
const logger = require('./src/utils/logger');

const app = express();
const REQUEST_TIMEOUT_MS = 30000;
const haltOnTimedout = (req, res, next) => {
  if (req.timedout) {
    return;
  }

  next();
};

app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());

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
app.use((req, res, next) => {
  req.timedout = false;
  req.timeoutController = new AbortController();
  req.timeoutSignal = req.timeoutController.signal;
  req.setTimeout(REQUEST_TIMEOUT_MS);

  const timeoutId = setTimeout(() => {
    req.timedout = true;
    req.timeoutController.abort(new Error('Request timeout'));

    logger.warn('Request deadline exceeded', {
      path: req.path,
      method: req.method,
    });

    if (!res.headersSent) {
      res.status(408).json({ message: 'Request timeout' });
    }
  }, REQUEST_TIMEOUT_MS);

  const clearDeadline = () => clearTimeout(timeoutId);
  res.on('finish', clearDeadline);
  res.on('close', clearDeadline);

  next();
});
app.use(haltOnTimedout);

app.use('/payment/webhook', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(haltOnTimedout);

app.use((req, res, next) => {
  if (req.path.startsWith('/support')) {
    return next();
  }
  // OPTIMIZATION 2: Tightened from 100kb — 10kb is ample for all API payloads.
  // Webhook stays on raw body (handled above).
  express.json({ limit: '10kb' })(req, res, next);
});
app.use(haltOnTimedout);
app.use((req, res, next) => {
  if (req.path.startsWith('/support')) {
    return next();
  }
  express.urlencoded({ extended: true, limit: '10kb' })(req, res, next);
});
app.use(haltOnTimedout);
app.use(passport.initialize());
app.use(haltOnTimedout);
app.use(globalLimiter);
app.use(haltOnTimedout);

app.use('/', haltOnTimedout, routes);

app.use((req, res, next) => {
  if (req.timedout) {
    return;
  }

  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  if (req.timedout) {
    return;
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // OPTIMIZATION 2: Surface Razorpay misconfiguration as 503
  if (err.code === 'RAZORPAY_NOT_CONFIGURED') {
    return res.status(503).json({
      message: 'Payment service is temporarily unavailable. Please try again later.',
    });
  }

  res.status(500).json({
    message: 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' ? { error: err.message } : {}),
  });
});

module.exports = app;
