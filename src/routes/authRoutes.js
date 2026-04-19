const express = require('express');
const router = express.Router();
const { register, login, refresh, getMe } = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { authLimiter } = require('../middlewares/rateLimiters');
const { authSchemas } = require('../validators/schemas');
const crypto = require('crypto');
const User = require('../models/User');
const ResetToken = require('../models/ResetToken');
const { sendPasswordResetEmail } = require('../services/emailService');
const logger = require('../utils/logger');

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// ─── Existing Auth Routes ───────────────────────────────────────────────────

router.post('/register', authLimiter, validate({ body: authSchemas.registerBody }), register);
router.post('/login', authLimiter, validate({ body: authSchemas.loginBody }), login);
router.post('/refresh', authLimiter, validate({ body: authSchemas.refreshBody }), refresh);
router.get('/me', authMiddleware, getMe);

// ─── Forgot Password ────────────────────────────────────────────────────────

router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('_id email').lean();

    // Always return 200 so as not to leak whether the email exists
    if (!user) {
      return res.status(200).json({ message: 'If this email is registered, a reset link has been sent' });
    }

    // Generate a secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Remove any existing reset tokens for this user
    await ResetToken.deleteMany({ userId: user._id });

    // Store hashed token
    await ResetToken.create({ userId: user._id, tokenHash, expiresAt });

    // Send email with raw token
    await sendPasswordResetEmail(user.email, rawToken);

    logger.info('Password reset email sent', { userId: user._id });

    return res.status(200).json({ message: 'If this email is registered, a reset link has been sent' });
  } catch (err) {
    logger.error('Forgot password error', { error: err.message });
    return res.status(500).json({ message: 'Failed to send reset email' });
  }
});

// ─── Reset Password ─────────────────────────────────────────────────────────

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const tokenHash = hashToken(token);

    const resetToken = await ResetToken.findOne({
      tokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!resetToken) {
      return res.status(400).json({ message: 'Reset token is invalid or has expired' });
    }

    const user = await User.findById(resetToken.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    await user.save();

    // Invalidate the token
    await ResetToken.deleteOne({ _id: resetToken._id });

    logger.info('Password reset successful', { userId: user._id });

    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    logger.error('Reset password error', { error: err.message });
    return res.status(500).json({ message: 'Failed to reset password' });
  }
});

module.exports = router;
