const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    '[authMiddleware] ACCESS_TOKEN_SECRET environment variable is not set. ' +
    'Set it in your .env file before starting the server.'
  );
}

const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'No token provided',
      });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type && decoded.type !== 'access') {
      return res.status(401).json({
        message: 'Invalid token',
      });
    }

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
