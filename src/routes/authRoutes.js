const express = require('express');
const router = express.Router();
const {
  register,
  login,
  refresh,
  logout,
  getMe,
  checkUsername,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { authLimiter } = require('../middlewares/rateLimiters');
const { authSchemas } = require('../validators/schemas');

router.post('/register', validate({ body: authSchemas.registerBody }), register);
router.post('/login', validate({ body: authSchemas.loginBody }), login);
router.post('/refresh', authLimiter, validate({ body: authSchemas.refreshBody }), refresh);
router.get('/me', authMiddleware, getMe);
router.get('/check-username/:username', checkUsername);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/logout', authMiddleware, logout);

module.exports = router;
