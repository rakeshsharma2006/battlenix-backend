const User = require('../models/User');
const { verifyAccessToken } = require('../services/tokenService');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'No token provided',
      });
    }

    const token = header.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const userId = decoded.userId || decoded.id || decoded._id || decoded.sub;

    if (!userId) {
      return res.status(401).json({
        message: 'Invalid token',
      });
    }

    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.status(401).json({
        message: 'User not found',
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        message: 'Account banned',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.warn('JWT verification failed', {
      error: error.message,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        message: 'Token expired',
      });
    }

    return res.status(401).json({
      message: 'Invalid token',
    });
  }
};

module.exports = authMiddleware;
