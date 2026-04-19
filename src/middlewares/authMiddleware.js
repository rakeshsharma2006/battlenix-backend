const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 
  'battlenix_jwt_secret_change_in_prod';

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      message: 'Unauthorized: No token provided' 
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Handle both _id and userId in token
    const userId = decoded._id || decoded.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        message: 'Unauthorized: Invalid token structure' 
      });
    }

    // Fetch fresh user from DB
    const user = await User.findById(userId)
      .select('-password')
      .lean();
    
    if (!user) {
      return res.status(401).json({ 
        message: 'Unauthorized: User not found' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ 
      message: 'Unauthorized: Invalid token' 
    });
  }
};

module.exports = authMiddleware;
