const express = require('express');
const mongoose = require('mongoose');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('mongo-sanitize');
const hpp = require('hpp');
const routes = require('./src/routes');
const passport = require('./src/config/passport');
const { globalLimiter, authLimiter, paymentLimiter } = require('./src/middlewares/rateLimiters');
const logger = require('./src/utils/logger');

const app = express();
const REQUEST_TIMEOUT_MS = 30000;
const JSON_BODY_LIMIT = '10kb';
const WEBHOOK_BODY_LIMIT = '1mb';
const haltOnTimedout = (req, res, next) => {
  if (req.timedout) {
    return;
  }
  next();
};

app.set('trust proxy', 1);

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || ''
).split(',').map(o => o.trim()).filter(Boolean);
if (process.env.FRONTEND_ORIGIN && !allowedOrigins.includes(process.env.FRONTEND_ORIGIN)) {
  allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...allowedOrigins],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.use(compression({
  filter: (req, res) => {
    // Don't compress SSE or webhook
    if (req.path === '/payment/webhook') return false;
    return compression.filter(req, res);
  },
  level: 6,
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS request rejected', { origin });
      callback(new Error('CORS blocked: ' + origin));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

app.use((req, res, next) => {
  const contentLength = Number(req.headers['content-length'] || 0);
  const limit = req.path === '/payment/webhook' ? 1024 * 1024 : 10 * 1024;

  if (contentLength > limit) {
    logger.warn('Unusual payload size rejected by configured body limit', {
      path: req.path,
      method: req.method,
      contentLength,
      limit,
      ip: req.ip,
    });
  }

  next();
});

app.use((req, res, next) => {
  req.timedout = false;
  req.timeoutController = new AbortController();
  req.timeoutSignal = req.timeoutController.signal;

  const handleTimeout = () => {
    if (req.timedout) {
      return;
    }

    req.timedout = true;
    req.timeoutController.abort(new Error('Request timeout'));

    logger.warn('Request deadline exceeded', {
      path: req.path,
      method: req.method,
    });

    if (!res.headersSent) {
      res.status(408).json({ message: 'Request timeout' });
    }
  };

  req.setTimeout(REQUEST_TIMEOUT_MS);
  req.on('timeout', handleTimeout);

  const timeoutId = setTimeout(handleTimeout, REQUEST_TIMEOUT_MS);

  const clearDeadline = () => {
    clearTimeout(timeoutId);
    req.off('timeout', handleTimeout);
  };
  res.on('finish', clearDeadline);
  res.on('close', clearDeadline);

  next();
});
app.use(haltOnTimedout);

// Webhook needs raw body — keep separate:
app.use('/payment/webhook', express.raw({ type: 'application/json', limit: WEBHOOK_BODY_LIMIT }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString('utf8');
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (error) {
      logger.warn('Invalid webhook JSON payload', {
        error: error.message,
        path: req.path,
      });
      return res.status(400).json({ message: 'Invalid webhook payload' });
    }
  }
  next();
});
app.use(haltOnTimedout);

// JSON body limit (prevents large payload attacks)
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(haltOnTimedout);
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(haltOnTimedout);

// Remove $ and . from user input (NoSQL injection)
app.use((req, res, next) => {
  req.body = mongoSanitize(req.body);
  req.query = mongoSanitize(req.query);
  next();
});

// Prevent HTTP parameter pollution
app.use(hpp({
  whitelist: ['status', 'game', 'mode'],
}));
app.use(haltOnTimedout);

app.use(passport.initialize());
app.use(haltOnTimedout);

app.use(globalLimiter);
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/payment/create-order', paymentLimiter);
app.use('/payment/verify', paymentLimiter);
app.use(haltOnTimedout);

// Health Check Endpoint
app.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  res.status(mongoState === 1 ? 200 : 503).json({
    status: mongoState === 1 ? 'ok' : 'degraded',
    mongo: states[mongoState],
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

app.use('/', haltOnTimedout, routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';

  if (err.message?.startsWith('CORS blocked:')) {
    logger.warn('CORS rejection handled', {
      message: err.message,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(403).json({ message: 'CORS blocked' });
  }

  if (err.type === 'entity.too.large') {
    logger.warn('Request payload too large', {
      path: req.path,
      method: req.method,
      limit: err.limit,
      length: err.length,
      ip: req.ip,
    });
    return res.status(413).json({ message: 'Payload too large' });
  }

  logger.error('Unhandled server error', {
    message: err.message,
    stack: isDev ? err.stack : undefined,
    path: req.path,
    method: req.method,
    userId: req.user?._id,
  });

  // Handle specific known errors
  if (err.code === 'RAZORPAY_NOT_CONFIGURED') {
    return res.status(503).json({
      message: 'Payment service temporarily unavailable'
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid ID format' });
  }

  // Never expose stack in production
  res.status(err.status || 500).json({
    message: isDev ? err.message : 'Internal server error',
  });
});

module.exports = app;
