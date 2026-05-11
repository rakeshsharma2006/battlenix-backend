const crypto = require('crypto');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const User = require('../models/User');
const logger = require('../utils/logger');

const generateTemporaryPassword = () => crypto.randomBytes(32).toString('hex');
const isGoogleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

if (isGoogleOAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/auth/google/callback',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase().trim();

          if (!email) {
            return done(null, false, { message: 'Google account email is unavailable' });
          }

          const avatar = profile.photos?.[0]?.value || null;

          let user = await User.findOne({ googleId: profile.id });

          if (!user) {
            user = await User.findOne({ email });
          }

          if (!user) {
            user = await User.create({
              email,
              password: generateTemporaryPassword(),
              googleId: profile.id,
              avatar,
              role: 'user',
            });
          } else {
            if (user.googleId && user.googleId !== profile.id) {
              return done(null, false, {
                message: 'This email is linked to a different Google account',
              });
            }

            let dirty = false;

            if (!user.googleId) {
              user.googleId = profile.id;
              dirty = true;
            }

            if (avatar && user.avatar !== avatar) {
              user.avatar = avatar;
              dirty = true;
            }

            if (dirty) {
              await user.save();
            }
          }

          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
} else {
  logger.warn('Google browser OAuth flow disabled: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set.');
}

passport.isGoogleOAuthConfigured = isGoogleOAuthConfigured;

module.exports = passport;
