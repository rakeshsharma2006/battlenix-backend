const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
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

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type && decoded.type !== 'access') {
      return next();
    }

    const userId = decoded._id || decoded.userId || decoded.id;
    if (!userId) {
      return next();
    }

    const user = await User.findById(userId).select('-password').lean();
    if (user) {
      req.user = user;
    }
  } catch (_error) {
    // Ignore auth errors for optional auth routes.
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

