const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const logger = require('../utils/logger');
const { sendPasswordResetEmail } = require('../services/emailService');
const { issueAuthTokens, rotateRefreshToken, signAccessToken } = require('../services/tokenService');

const GOOGLE_WEB_CLIENT_ID =
  '460641904031-5hl7dsf0msmg4f1b9fvkjmsnrt3geu85.apps.googleusercontent.com';
const googleOAuthClient = new OAuth2Client();

const getGoogleClientId = () => {
  const configuredClientId = (process.env.GOOGLE_CLIENT_ID || GOOGLE_WEB_CLIENT_ID).trim();

  if (configuredClientId !== GOOGLE_WEB_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID must match the configured BattleNix Web Client ID');
  }

  return configuredClientId;
};

const buildUserPayload = (user) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  avatar: user.avatar ?? null,
  trustScore: user.trustScore ?? undefined,
  gameUID: user.gameUID ?? null,
  gameName: user.gameName ?? null,
  upiId: user.upiId ?? null,
  bgmiUID: user.bgmiUID ?? null,
  bgmiName: user.bgmiName ?? null,
  bgmiUpiId: user.bgmiUpiId ?? null,
  ffUID: user.ffUID ?? null,
  ffName: user.ffName ?? null,
  ffUpiId: user.ffUpiId ?? null,
  bgmiUidSetAt: user.bgmiUidSetAt ?? null,
  ffUidSetAt: user.ffUidSetAt ?? null,
});

const buildAuthResponse = async (user, message) => {
  const tokens = await issueAuthTokens(user);

  return {
    message,
    ...tokens,
    user: buildUserPayload(user),
  };
};

const hashForLog = (value = '') => crypto
  .createHash('sha256')
  .update(String(value).toLowerCase().trim())
  .digest('hex')
  .slice(0, 16);

const buildGoogleAuthResponse = async (user, message = 'Google sign-in successful') => {
  logger.info('Generating JWTs for Google login', {
    userId: user._id,
  });

  const tokens = await issueAuthTokens(user);

  logger.info('JWT generation completed for Google login', {
    userId: user._id,
  });

  return {
    success: true,
    message,
    token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      ...buildUserPayload(user),
      avatar: user.avatar || null,
    },
    requiresUsername: !user.username || String(user.username).trim().length === 0,
  };
};

const generateTemporaryPassword = () => crypto.randomBytes(32).toString('hex');

const findOrCreateGoogleUser = async ({
  email,
  googleId,
  name = null,
  avatar = null,
  source = 'google',
}) => {
  const normalizedEmail = email.toLowerCase().trim();
  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });
  }

  if (!user) {
    user = await User.create({
      email: normalizedEmail,
      password: generateTemporaryPassword(),
      googleId,
      avatar: avatar || null,
      role: 'user',
    });

    logger.info('New user created via Google Sign-In', {
      source,
      userId: user._id,
      emailHash: hashForLog(normalizedEmail),
      googleId,
      hasName: Boolean(name),
    });

    return user;
  }

  if (user.googleId && user.googleId !== googleId) {
    logger.warn('Google login rejected: email belongs to a different Google account', {
      userId: user._id,
      emailHash: hashForLog(normalizedEmail),
      providedGoogleId: googleId,
    });
    throw new Error('GOOGLE_ACCOUNT_MISMATCH');
  }

  let isDirty = false;

  if (!user.googleId) {
    user.googleId = googleId;
    isDirty = true;
  }

  if (avatar && user.avatar !== avatar) {
    user.avatar = avatar;
    isDirty = true;
  }

  if (isDirty) {
    await user.save();
  }

  logger.info('Existing user signed in via Google', {
    source,
    userId: user._id,
    emailHash: hashForLog(normalizedEmail),
    googleId,
    hasName: Boolean(name),
  });

  return user;
};

const mapGoogleVerificationError = (error) => {
  const message = error?.message || '';

  if (/expired/i.test(message)) {
    return 'Google ID token has expired';
  }

  if (/audience|recipient|aud/i.test(message)) {
    return 'Google ID token was issued for a different client';
  }

  return 'Invalid Google ID token';
};

const verifyGoogleIdToken = async (googleToken) => {
  const clientId = getGoogleClientId();

  logger.info('Verifying Google ID token', {
    audience: clientId,
  });

  const ticket = await googleOAuthClient.verifyIdToken({
    idToken: googleToken,
    audience: clientId,
  });

  const payload = ticket.getPayload();
  const {
    sub: googleId,
    email,
    email_verified: emailVerified,
    name,
    picture,
    aud,
    iss,
  } = payload || {};

  logger.info('Google ID token payload verified', {
    googleId,
    emailHash: hashForLog(email),
    emailVerified,
    audience: aud,
    issuer: iss,
    hasName: Boolean(name),
    hasPicture: Boolean(picture),
  });

  if (
    aud !== clientId ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(iss) ||
    !googleId ||
    !email ||
    emailVerified !== true
  ) {
    throw new Error('Invalid Google ID token payload');
  }

  return {
    googleId,
    email,
    name: name || null,
    picture: picture || null,
  };
};

const register = async (req, res) => {
  try {
    const { username, email, password, referralCode, deviceFingerprint, installReferrerRaw, deviceFingerprintConsent } = req.body;

    const clientIp = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.connection?.remoteAddress || req.ip || null;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ message: 'User with this email or username already exists' });
    }

    // ── Referral attribution (errors must NEVER block signup) ──────────
    let resolvedCode = null;
    let referralDoc = null;

    try {
      // Priority 1: explicit referral code
      if (referralCode) {
        resolvedCode = referralCode.toUpperCase().trim();
      }
      // Priority 2: extract from Play Store installReferrer (format: ref_CODE)
      else if (installReferrerRaw) {
        const match = installReferrerRaw.match(/ref_([A-Z0-9_]+)/i);
        if (match) {
          resolvedCode = match[1].toUpperCase().trim();
        }
      }

      if (resolvedCode) {
        const ReferralCode = require('../models/ReferralCode');
        const found = await ReferralCode.findOne({ code: resolvedCode, isActive: true });
        if (found && (!found.expiresAt || new Date(found.expiresAt) >= new Date())) {
          referralDoc = found;
        } else {
          logger.warn('Invalid/expired referral code during registration', { code: resolvedCode });
          resolvedCode = null;
        }
      }
    } catch (refErr) {
      logger.error('Referral code lookup failed during registration (non-fatal)', { error: refErr.message });
      resolvedCode = null;
      referralDoc = null;
    }

    // Create user with referral fields
    const userPayload = { username, email, password, signupIp: clientIp };
    if (referralDoc) {
      userPayload.referralCode = referralDoc.code;
      userPayload.referralCodeId = referralDoc._id;
      userPayload.referredAt = new Date();
    }
    if (deviceFingerprint) {
      userPayload.deviceFingerprint = deviceFingerprint;
      userPayload.deviceFingerprintConsent = deviceFingerprintConsent === true;
    }
    if (installReferrerRaw) {
      userPayload.installReferrerRaw = installReferrerRaw;
    }

    const user = await User.create(userPayload);

    // ── Post-creation referral tasks (fire-and-forget) ────────────────
    if (referralDoc) {
      const ReferralCode = require('../models/ReferralCode');
      ReferralCode.findByIdAndUpdate(referralDoc._id, {
        $inc: { totalSignups: 1 },
      }).catch((err) => {
        logger.error('Failed to increment totalSignups', { code: referralDoc.code, error: err.message });
      });

      logger.info('Signup attributed to referral', {
        userId: user._id,
        code: referralDoc.code,
        creatorName: referralDoc.creatorName,
      });
    }

    // ── Fraud detection (fire-and-forget) ─────────────────────────────
    try {
      const fraudFlags = [];

      // Check duplicate device fingerprint
      if (deviceFingerprint && deviceFingerprintConsent) {
        const hashedFp = crypto.createHash('sha256').update(deviceFingerprint).digest('hex');
        const duplicateDeviceCount = await User.countDocuments({
          hashedDeviceFingerprint: hashedFp,
          _id: { $ne: user._id },
        });
        if (duplicateDeviceCount >= 2) {
          fraudFlags.push('DUPLICATE_DEVICE');
        }
      }

      // MULTIPLE_SIGNUPS_SAME_IP check
      if (clientIp) {
        const recentSignupsFromIp = await User.countDocuments({
          signupIp: clientIp,
          createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
          _id: { $ne: user._id },
        });
        if (recentSignupsFromIp >= 5) {
          fraudFlags.push('MULTIPLE_SIGNUPS_SAME_IP');
        }
      }

      // DISPOSABLE_EMAIL check
      const disposableDomains = [
        'mailinator.com', 'tempmail.com', 'guerrillamail.com',
        'throwam.com', 'sharklasers.com', 'yopmail.com',
        'trashmail.com', '10minutemail.com', 'fakeinbox.com',
      ];
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (disposableDomains.includes(emailDomain)) {
        fraudFlags.push('DISPOSABLE_EMAIL_PATTERN');
      }

      // FAST_REPEAT_SIGNUP check (many signups via same referral code quickly)
      if (referralDoc) {
        const fastRepeat = await User.countDocuments({
          referralCodeId: referralDoc._id,
          createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) },
          _id: { $ne: user._id },
        });
        if (fastRepeat >= 3) {
          fraudFlags.push('FAST_REPEAT_SIGNUP');
        }
      }

      if (fraudFlags.length > 0) {
        await User.findByIdAndUpdate(user._id, {
          $addToSet: { fraudFlags: { $each: fraudFlags } },
        });
        logger.warn('fraud_flagged', {
          userId: user._id,
          code: referralDoc?.code || null,
          fraudFlags,
        });
      }
    } catch (fraudErr) {
      logger.error('Fraud detection failed during registration (non-fatal)', { error: fraudErr.message });
    }

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
      logger.warn('Failed login attempt', {
        reason: 'user_not_found',
        emailHash: hashForLog(email),
        ip: req.ip,
      });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.isLocked) {
      const waitMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      logger.warn('Failed login attempt on locked account', {
        userId: user._id,
        loginAttempts: user.loginAttempts,
        ip: req.ip,
      });
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
        logger.warn('Failed login threshold reached; account locked', {
          userId: user._id,
          loginAttempts: user.loginAttempts,
          ip: req.ip,
        });
        return res.status(401).json({
          message: 'Too many failed attempts. Account locked for 15 minutes.',
        });
      }
      await user.save();
      logger.warn('Failed login attempt', {
        reason: 'bad_password',
        userId: user._id,
        loginAttempts: user.loginAttempts,
        ip: req.ip,
      });
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
      .select('email role username avatar trustScore gameUID gameName upiId bgmiUID bgmiName bgmiUpiId ffUID ffName ffUpiId bgmiUidSetAt ffUidSetAt')
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

const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user?._id;

    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      await RefreshToken.deleteOne({
        tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      });
    }

    if (userId) {
      await RefreshToken.deleteMany({
        userId,
      });

      logger.info('User logged out', {
        userId,
      });
    }

    return res.status(200).json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', {
      error: error.message,
    });

    return res.status(200).json({
      message: 'Logged out',
    });
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

const checkUsername = async (req, res) => {
  try {
    const username = req.params.username?.trim();

    if (!username || !/^[a-zA-Z0-9]{3,30}$/.test(username)) {
      return res.status(400).json({
        available: false,
        message: 'Username must be 3-30 letters or numbers',
      });
    }

    const existingUser = await User.findOne({
      username: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })
      .select('_id')
      .lean();

    return res.status(200).json({ available: !existingUser });
  } catch (error) {
    logger.error('Check username error', { error: error.message });
    return res.status(500).json({ message: 'Failed to check username' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    const genericMessage = 'If this email is registered, a reset link has been sent';

    if (!user) {
      return res.status(200).json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    user.passwordResetExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    await sendPasswordResetEmail(user.email, rawToken);

    logger.info('Password reset email sent', { userId: user._id });
    return res.status(200).json({ message: genericMessage });
  } catch (error) {
    logger.error('Forgot password error', { error: error.message });
    return res.status(500).json({ message: 'Failed to send reset email' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Reset token is invalid or has expired' });
    }

    user.password = newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpiry = null;
    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    logger.info('Password reset successful', { userId: user._id });
    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Reset password error', { error: error.message });
    return res.status(500).json({ message: 'Failed to reset password' });
  }
};

const completeGoogleTokenLogin = async (req, res, source) => {
  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      logger.warn('Google login failed: missing googleToken', { source });
      return res.status(400).json({
        success: false,
        message: 'googleToken is required',
      });
    }

    let googlePayload;
    try {
      googlePayload = await verifyGoogleIdToken(googleToken);
    } catch (verifyErr) {
      if (/GOOGLE_CLIENT_ID/.test(verifyErr.message)) {
        logger.error('Google Sign-In misconfigured', {
          source,
          error: verifyErr.message,
        });
        return res.status(500).json({
          success: false,
          message: 'Server auth configuration error',
        });
      }

      const message = mapGoogleVerificationError(verifyErr);
      logger.warn('Google token verification failed', {
        source,
        reason: message,
        error: verifyErr.message,
      });
      return res.status(401).json({ success: false, message });
    }

    const user = await findOrCreateGoogleUser({
      email: googlePayload.email,
      googleId: googlePayload.googleId,
      name: googlePayload.name,
      avatar: googlePayload.picture,
      source,
    });

    const response = await buildGoogleAuthResponse(user);

    logger.info('Google login success', {
      source,
      userId: user._id,
      googleId: googlePayload.googleId,
      requiresUsername: response.requiresUsername,
    });

    return res.status(200).json(response);
  } catch (error) {
    if (error.message === 'GOOGLE_ACCOUNT_MISMATCH') {
      return res.status(409).json({
        success: false,
        message: 'This email is linked to a different Google account',
      });
    }

    logger.error('Google Sign-In error', { source, error: error.message });
    return res.status(500).json({ success: false, message: 'Google login failed' });
  }
};

const googleSignIn = async (req, res) => completeGoogleTokenLogin(
  req,
  res,
  'auth_google'
);

const googleVerify = async (req, res) => {
  try {
    return completeGoogleTokenLogin(req, res, 'auth_google_verify');
  } catch (error) {
    logger.error('Google verify error', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: 'Google login failed' });
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  getMe,
  checkUsername,
  forgotPassword,
  resetPassword,
  googleSignIn,
  googleVerify,
};
