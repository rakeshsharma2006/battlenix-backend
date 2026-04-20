const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Must match the secret used in tokenService.js signAccessToken()
const JWT_SECRET =
  process.env.ACCESS_TOKEN_SECRET ||
  process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    '[authMiddleware] ACCESS_TOKEN_SECRET environment variable is not set. ' +
    'Set it in your .env file before starting the server.'
  );
}

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Unauthorized: No token provided',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Reject refresh tokens used as access tokens
    if (decoded.type && decoded.type !== 'access') {
      return res.status(401).json({
        message: 'Unauthorized: Invalid token type',
      });
    }

    const userId = decoded._id || decoded.userId;

    if (!userId) {
      return res.status(401).json({
        message: 'Unauthorized: Invalid token structure',
      });
    }

    // Fetch fresh user from DB on every request (catches bans, deletions)
    const user = await User.findById(userId).select('-password').lean();

    if (!user) {
      return res.status(401).json({
        message: 'Unauthorized: User not found',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Unauthorized: Invalid token',
    });
  }
};

module.exports = authMiddleware;
