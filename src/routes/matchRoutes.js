const express = require('express');
const User = require('../models/User');
const { verifyAccessToken } = require('../services/tokenService');
const logger = require('../utils/logger');
const router = express.Router();
const {
  createMatch,
  listMatches,
  getMatch,
  getJoinStatus,
  getMatchRoom,
  getMatchPlayers,
  updateMatch,
  setMatchStatus,
  deleteMatch,
  publishRoom,
  submitResult,
  toggleChat,
  joinFreeMatch,
} = require('../controllers/matchController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { matchSchemas } = require('../validators/schemas');

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const userId = decoded._id || decoded.userId || decoded.id || decoded.sub;
    if (!userId) {
      return next();
    }

    const user = await User.findById(userId).select('-password').lean();
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Ignore auth errors for optional auth routes.
    logger.warn('Optional match auth token rejected', {
      error: error.message,
      path: req.path,
      ip: req.ip,
    });
  }

  next();
};

router.get('/', optionalAuth, listMatches);
router.get('/:id/join-status', authMiddleware, validate({ params: matchSchemas.matchIdParams }), getJoinStatus);
router.get('/:id/room', authMiddleware, validate({ params: matchSchemas.matchIdParams }), getMatchRoom);
router.get('/:id/players', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams }), getMatchPlayers);
router.get('/:id', optionalAuth, validate({ params: matchSchemas.matchIdParams }), getMatch);

router.post('/', authMiddleware, adminMiddleware, validate({ body: matchSchemas.createMatchBody }), createMatch);
router.post(
  '/:id/join-free',
  authMiddleware,
  validate({ params: matchSchemas.matchIdParams }),
  joinFreeMatch
);
router.patch('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.updateMatchBody }), updateMatch);
router.patch('/:id/status', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.statusBody }), setMatchStatus);
router.patch('/:id/chat-toggle', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.chatToggleBody }), toggleChat);
router.delete('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams }), deleteMatch);
router.post('/:id/publish-room', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.publishRoomBody }), publishRoom);
router.post('/:id/result', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.submitResultBody }), submitResult);

module.exports = router;
