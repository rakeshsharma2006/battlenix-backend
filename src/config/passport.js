const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Try to find by googleId first for speed, then fall back to email
        let user = await User.findOne({
          $or: [
            { googleId: profile.id },
            { email: profile.emails[0].value },
          ],
        });

        if (!user) {
          // Create new user with a random secure password
          const randomPass = await bcrypt.hash(
            Math.random().toString(36) + Date.now(),
            10
          );

          const baseUsername = profile.displayName
            .replace(/\s+/g, '_')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, 20);

          user = await User.create({
            username: `${baseUsername}_${Date.now().toString().slice(-4)}`,
            email: profile.emails[0].value,
            password: randomPass,
            googleId: profile.id,
            role: 'user',
          });
        } else if (!user.googleId) {
          // Existing email-based user — link their Google account
          user.googleId = profile.id;
          await user.save();
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
