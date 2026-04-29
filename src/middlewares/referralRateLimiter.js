const rateLimit = require('express-rate-limit');

const validateCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { message: 'Too many requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const redirectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { message: 'Too many redirect requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { validateCodeLimiter, redirectLimiter };
