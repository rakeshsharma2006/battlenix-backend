const rateLimit = require('express-rate-limit');

const buildLimiter = ({ windowMs, max, message, skip }) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { message },
});

const globalLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many requests. Please retry shortly.',
  skip: (req) => req.path === '/health' || req.path === '/payment/webhook',
});

const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: 'Too many authentication attempts. Please retry later.',
});

const paymentLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many payment requests. Please retry later.',
});

const adminLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: 'Too many admin requests. Please retry later.',
});

module.exports = {
  globalLimiter,
  authLimiter,
  paymentLimiter,
  adminLimiter,
};
