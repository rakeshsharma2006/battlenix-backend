const crypto = require('crypto');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const User = require('../models/User');
const logger = require('../utils/logger');

const buildGoogleUsername = (displayName = 'player') => {
  const baseUsername = displayName
    .replace(/\s+/g, '_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);

  return baseUsername || 'player';
};

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

          let user = await User.findOne({
            $or: [
              { googleId: profile.id },
              { email },
            ],
          });

          if (!user) {
            const baseUsername = buildGoogleUsername(profile.displayName);

            user = await User.create({
              username: `${baseUsername}_${Date.now().toString().slice(-5)}`,
              email,
              password: generateTemporaryPassword(),
              googleId: profile.id,
              avatar,
              role: 'user',
            });
          } else {
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
