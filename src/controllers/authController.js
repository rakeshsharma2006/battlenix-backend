const User = require('../models/User');
const logger = require('../utils/logger');
const { issueAuthTokens, rotateRefreshToken, signAccessToken } = require('../services/tokenService');

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

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
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

    // Fetch full profile so the response payload is complete
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

module.exports = { register, login, refresh, getMe };
