const checkBan = (req, res, next) => {
  if (req.user?.isBanned === true) {
    return res.status(403).json({ message: 'Account permanently banned. Contact support.' });
  }

  return next();
};

module.exports = checkBan;
