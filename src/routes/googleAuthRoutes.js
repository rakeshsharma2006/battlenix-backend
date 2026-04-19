const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const passport = require('../config/passport');
const User = require('../models/User');
const { issueAuthTokens } = require('../services/tokenService');
const logger = require('../utils/logger');

// ─── Helpers ────────────────────────────────────────────────────────────────

const buildUserPayload = (user) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  trustScore: user.trustScore,
  gameUID: user.gameUID || null,
  gameName: user.gameName || null,
  upiId: user.upiId || null,
});

// ─── Step 1: Redirect to Google ─────────────────────────────────────────────

router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// ─── Step 2: Google callback (deep-link redirect for mobile) ─────────────────

router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/auth/google/failed',
  }),
  async (req, res) => {
    try {
      const user = req.user;
      const tokens = await issueAuthTokens(user);

      // Flutter app intercepts this custom-scheme URL
      const redirectUrl =
        `battlenix://auth/google/callback` +
        `?accessToken=${tokens.accessToken}` +
        `&refreshToken=${tokens.refreshToken}` +
        `&userId=${user._id}` +
        `&username=${encodeURIComponent(user.username)}` +
        `&email=${encodeURIComponent(user.email)}`;

      return res.redirect(redirectUrl);
    } catch (err) {
      logger.error('Google callback error', { error: err.message });
      return res.redirect('/auth/google/failed');
    }
  }
);

// ─── Failure route ───────────────────────────────────────────────────────────

router.get('/google/failed', (req, res) => {
  return res.status(401).json({ message: 'Google login failed' });
});

// ─── REST endpoint for Flutter (avoids OAuth browser redirect) ──────────────
// Flutter sends the Google ID-token data after signing in with google_sign_in
// package. This verifies/creates the user and returns JWT tokens directly.

router.post('/google/verify', async (req, res) => {
  try {
    const { email, displayName, googleId } = req.body;

    if (!email || !googleId) {
      return res.status(400).json({ message: 'email and googleId are required' });
    }

    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });

    if (!user) {
      const randomPass = await bcrypt.hash(
        Math.random().toString(36) + Date.now(),
        10
      );

      const baseUsername = (displayName || 'player')
        .replace(/\s+/g, '_')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20);

      user = await User.create({
        username: `${baseUsername}_${Date.now().toString().slice(-4)}`,
        email,
        password: randomPass,
        googleId,
        role: 'user',
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    const tokens = await issueAuthTokens(user);

    return res.status(200).json({
      message: 'Google sign-in successful',
      ...tokens,
      user: buildUserPayload(user),
    });
  } catch (err) {
    logger.error('Google verify error', { error: err.message });
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
