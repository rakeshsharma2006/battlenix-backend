const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const validate = require('../middlewares/validationMiddleware');
const { issueAuthTokens } = require('../services/tokenService');
const logger = require('../utils/logger');
const { googleSignIn, googleVerify } = require('../controllers/authController');
const { authLimiter } = require('../middlewares/rateLimiters');
const { authSchemas } = require('../validators/schemas');

const ensureGoogleOAuthConfigured = (req, res, next) => {
  if (!passport.isGoogleOAuthConfigured) {
    return res.status(503).json({ message: 'Google browser login is not configured' });
  }

  next();
};

// POST /auth/google
// Body: { idToken: "<google_id_token>" }
// Returns the app JWT pair after verifying the Google ID token server-side.
router.post('/google', authLimiter, validate({ body: authSchemas.googleSignInBody }), googleSignIn);

router.get(
  '/google',
  ensureGoogleOAuthConfigured,
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

router.get(
  '/google/callback',
  ensureGoogleOAuthConfigured,
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/auth/google/failed',
  }),
  async (req, res) => {
    try {
      const user = req.user;
      const tokens = await issueAuthTokens(user);
      const redirectUrl = new URL(
        process.env.MOBILE_GOOGLE_CALLBACK_URL || 'battlenix://auth/google/callback'
      );

      redirectUrl.searchParams.set('accessToken', tokens.accessToken);
      redirectUrl.searchParams.set('refreshToken', tokens.refreshToken);
      redirectUrl.searchParams.set('userId', String(user._id));
      redirectUrl.searchParams.set('username', user.username);
      redirectUrl.searchParams.set('email', user.email);

      if (user.avatar) {
        redirectUrl.searchParams.set('avatar', user.avatar);
      }

      return res.redirect(redirectUrl.toString());
    } catch (err) {
      logger.error('Google callback error', { error: err.message });
      return res.redirect('/auth/google/failed');
    }
  }
);

router.get('/google/failed', (req, res) => {
  return res.status(401).json({ message: 'Google login failed' });
});

// Compatibility alias for older mobile clients. It now enforces the same
// verified Google ID token contract as POST /auth/google, while also
// accepting the older `{ email, displayName, googleId }` payload.
router.post('/google/verify', authLimiter, validate({ body: authSchemas.googleVerifyBody }), googleVerify);

module.exports = router;
