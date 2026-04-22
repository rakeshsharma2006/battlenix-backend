const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const logger = require('../utils/logger');
const { issueAuthTokens, rotateRefreshToken, signAccessToken } = require('../services/tokenService');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const buildUserPayload = (user) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  trustScore: user.trustScore ?? undefined,
  gameUID: user.gameUID ?? null,
  gameName: user.gameName ?? null,
  upiId: user.upiId ?? null,
});

const buildAuthResponse = async (user, message) => {
  const tokens = await issueAuthTokens(user);

  return {
    message,
    ...tokens,
    user: buildUserPayload(user),
  };
};

const buildGoogleUsername = (displayName = 'player') => {
  const baseUsername = displayName
    .replace(/\s+/g, '_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);

  return baseUsername || 'player';
};

const generateTemporaryPassword = () => crypto.randomBytes(32).toString('hex');

const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ message: 'User with this email or username already exists' });
    }

    const user = await User.create({ username, email, password });

    return res.status(201).json(
      await buildAuthResponse(user, 'User registered successfully')
    );
  } catch (error) {
    logger.error('Register error', { error: error.message });
    return res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.isLocked) {
      const waitMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(401).json({
        message: `Account is temporarily locked. Try again in ${waitMinutes} minutes.`,
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= 4) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();
        return res.status(401).json({
          message: 'Too many failed attempts. Account locked for 15 minutes.',
        });
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.loginAttempts > 0 || user.lockUntil != null) {
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();
    }

    return res.status(200).json(
      await buildAuthResponse(user, 'Login successful')
    );
  } catch (error) {
    logger.error('Login error', { error: error.message });
    return res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: 'Token expired or invalid' });
    }

    const rotated = await rotateRefreshToken(refreshToken);

    const user = await User.findById(rotated.userId)
      .select('email role username trustScore gameUID gameName upiId')
      .lean();

    if (!user) {
      return res.status(401).json({ message: 'Token expired or invalid' });
    }

    const accessToken = signAccessToken(user);

    return res.status(200).json({
      message: 'Token refreshed successfully',
      token: accessToken,
      accessToken,
      refreshToken: rotated.refreshToken,
      user: buildUserPayload(user),
    });
  } catch (error) {
    logger.warn('Refresh token rejected', { error: error.message });
    return res.status(401).json({ message: 'Token expired or invalid' });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ user });
  } catch (error) {
    logger.error('GetMe error', { error: error.message });
    return res.status(500).json({ message: 'Failed to get user', error: error.message });
  }
};

const googleSignIn = async (req, res) => {
  try {
    const idToken = req.body.idToken || req.body.credential || req.body.token;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken is required' });
    }

    if (!GOOGLE_CLIENT_ID) {
      logger.error('Google Sign-In misconfigured: GOOGLE_CLIENT_ID env var is missing');
      return res.status(500).json({ success: false, message: 'Server auth configuration error' });
    }

    let ticket;
    try {
      ticket = await googleOAuthClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (verifyErr) {
      logger.warn('Google idToken verification failed', { error: verifyErr.message });
      return res.status(401).json({ success: false, message: 'Google login failed' });
    }

    const payload = ticket.getPayload();
    const { sub: googleId, email, email_verified: emailVerified, name, picture } = payload;

    if (!email || emailVerified !== true) {
      return res.status(401).json({ success: false, message: 'Google login failed' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

    if (!user) {
      const baseUsername = buildGoogleUsername(name);

      user = await User.create({
        username: `${baseUsername}_${Date.now().toString().slice(-5)}`,
        email: normalizedEmail,
        password: generateTemporaryPassword(),
        googleId,
        avatar: picture || null,
        role: 'user',
      });

      logger.info('New user created via Google Sign-In', { userId: user._id, email: normalizedEmail });
    } else {
      let dirty = false;

      if (!user.googleId) {
        user.googleId = googleId;
        dirty = true;
      }

      if (picture && user.avatar !== picture) {
        user.avatar = picture;
        dirty = true;
      }

      if (dirty) {
        await user.save();
      }

      logger.info('Existing user signed in via Google', { userId: user._id, email: normalizedEmail });
    }

    const tokens = await issueAuthTokens(user);

    return res.status(200).json({
      success: true,
      message: 'Google sign-in successful',
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        ...buildUserPayload(user),
        avatar: user.avatar || null,
      },
    });
  } catch (error) {
    logger.error('Google Sign-In error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Google login failed' });
  }
};

module.exports = { register, login, refresh, getMe, googleSignIn };
