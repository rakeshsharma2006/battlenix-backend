const { getRuntimeInfo } = require('../utils/runtimeInfo');

exports.getWelcomeMessage = (req, res) => {
  res.status(200).json({ message: 'Battlenix API Running' });
};

exports.getHealth = (req, res) => {
  res.status(200).json({
    status: 'ok',
    runtime: getRuntimeInfo(),
  });
};
