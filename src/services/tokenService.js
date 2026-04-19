const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const RefreshToken = require('../models/RefreshToken');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'battlenix_jwt_secret_change_in_prod';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || `${ACCESS_TOKEN_SECRET}_refresh`;
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const buildAccessTokenPayload = (user) => ({
  _id: user._id,
  email: user.email,
  role: user.role,
  type: 'access',
});

const signAccessToken = (user) => jwt.sign(
  buildAccessTokenPayload(user),
  ACCESS_TOKEN_SECRET,
  { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
);

const signRefreshToken = ({ userId, tokenId }) => jwt.sign(
  {
    sub: String(userId),
    tokenId,
    type: 'refresh',
  },
  REFRESH_TOKEN_SECRET,
  { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
);

const persistRefreshToken = async ({ userId, refreshToken, tokenId }) => RefreshToken.create({
  userId,
  tokenId,
  tokenHash: hashToken(refreshToken),
  expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
});

const issueAuthTokens = async (user) => {
  const tokenId = crypto.randomUUID();
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken({ userId: user._id, tokenId });

  await persistRefreshToken({ userId: user._id, refreshToken, tokenId });

  return {
    accessToken,
    refreshToken,
    token: accessToken,
  };
};

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
  if (decoded.type && decoded.type !== 'access') {
    throw new Error('Invalid access token type');
  }
  return decoded;
};

const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET);
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid refresh token type');
  }
  return decoded;
};

const rotateRefreshToken = async (refreshToken) => {
  const decoded = verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);
  const session = await mongoose.startSession();
  let nextRefreshToken = null;

  try {
    await session.withTransaction(async () => {
      const nextTokenId = crypto.randomUUID();
      const claimedToken = await RefreshToken.findOneAndUpdate(
        {
          userId: decoded.sub,
          tokenId: decoded.tokenId,
          tokenHash,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            revokedAt: new Date(),
            replacedByTokenId: nextTokenId,
          },
        },
        {
          new: true,
          session,
        }
      );

      if (!claimedToken) {
        throw new Error('Refresh token is invalid or expired');
      }

      nextRefreshToken = signRefreshToken({ userId: decoded.sub, tokenId: nextTokenId });
      const nextTokenHash = hashToken(nextRefreshToken);

      await RefreshToken.create([{
        userId: claimedToken.userId,
        tokenId: nextTokenId,
        tokenHash: nextTokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  return {
    userId: decoded.sub,
    refreshToken: nextRefreshToken,
  };
};

module.exports = {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
  signAccessToken,
  issueAuthTokens,
  verifyAccessToken,
  verifyRefreshToken,
  rotateRefreshToken,
};
