const express = require('express');

const router = express.Router();
const {
  joinRandom,
  createFriendsRoom,
  joinFriendsRoom,
  getAvailableSlots,
  getMyCurrentMatch,
} = require('../controllers/matchmakingController');
const authMiddleware = require('../middlewares/authMiddleware');
const checkBan = require('../middlewares/checkBan');
const checkFlagged = require('../middlewares/checkFlagged');
const validate = require('../middlewares/validationMiddleware');
const { matchmakingSchemas } = require('../validators/schemas');

router.use(authMiddleware, checkBan, checkFlagged);

router.get('/slots', validate({ query: matchmakingSchemas.slotsQuery }), getAvailableSlots);
router.post('/join-random', validate({ body: matchmakingSchemas.joinRandom }), joinRandom);
router.post('/create-friends-room', validate({ body: matchmakingSchemas.joinRandom }), createFriendsRoom);
router.post('/join-friends-room', validate({ body: matchmakingSchemas.joinFriendsRoom }), joinFriendsRoom);
router.get('/my-match', getMyCurrentMatch);

module.exports = router;
