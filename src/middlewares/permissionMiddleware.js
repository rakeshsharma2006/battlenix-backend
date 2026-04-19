const { hasPermission } = require('../utils/permissions');

const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user, permission)) {
    return res.status(403).json({ message: `Forbidden: Missing permission ${permission}` });
  }

  return next();
};

module.exports = {
  requirePermission,
};
