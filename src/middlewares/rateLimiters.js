const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const logRateLimitHit = (name) => (req, res, next, options) => {
  logger.warn('Rate limit hit', {
    limiter: name,
    ip: req.ip,
    path: req.path,
    method: req.method,
    userId: req.user?._id,
  });

  return res.status(options.statusCode).json(options.message);
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 300,                   // 300 req per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many requests. Please slow down.'
  },
  handler: logRateLimitHit('global'),
  skip: (req) => {
    // Skip rate limit for webhook
    return req.path === '/payment/webhook';
  },
});

// Auth routes — stricter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many login attempts.' },
  handler: logRateLimitHit('auth'),
});

// Payment routes — stricter
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: { message: 'Too many payment requests.' },
  handler: logRateLimitHit('payment'),
});

const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many admin requests. Please retry later.' },
  handler: logRateLimitHit('admin'),
});

module.exports = {
  globalLimiter,
  authLimiter,
  paymentLimiter,
  adminLimiter,
};
