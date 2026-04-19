const checkFlagged = (req, res, next) => {
  if (req.user?.isFlagged === true) {
    return res.status(403).json({ message: 'Account flagged for suspicious activity. Contact support.' });
  }

  return next();
};

module.exports = checkFlagged;
