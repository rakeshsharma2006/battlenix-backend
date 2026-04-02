const adminMiddleware = (req, res, next) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden: Admin or manager access required' });
  }

  next();
};

module.exports = adminMiddleware;
