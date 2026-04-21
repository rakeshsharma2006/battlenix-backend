const express = require('express');
const router = express.Router();
const {
  createMatch,
  listMatches,
  getMatch,
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

// Public listing — but if auth token present, isJoined will be populated
router.get('/', listMatches);
router.get('/:id/room', authMiddleware, validate({ params: matchSchemas.matchIdParams }), getMatchRoom);
router.get('/:id/players', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams }), getMatchPlayers);
// BUG 2 FIX: getMatch now accepts optional auth so it can return isJoined
router.get('/:id', validate({ params: matchSchemas.matchIdParams }), getMatch);

router.post('/', authMiddleware, adminMiddleware, validate({ body: matchSchemas.createMatchBody }), createMatch);
// BUG 1 FIX: join-free endpoint — requires auth, no admin role
router.post('/:id/join-free', authMiddleware, validate({ params: matchSchemas.matchIdParams }), joinFreeMatch);
router.patch('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.updateMatchBody }), updateMatch);
router.patch('/:id/status', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.statusBody }), setMatchStatus);
router.patch('/:id/chat-toggle', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.chatToggleBody }), toggleChat);
router.delete('/:id', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams }), deleteMatch);
router.post('/:id/publish-room', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.publishRoomBody }), publishRoom);
router.post('/:id/result', authMiddleware, adminMiddleware, validate({ params: matchSchemas.matchIdParams, body: matchSchemas.submitResultBody }), submitResult);

module.exports = router;
