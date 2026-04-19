const express = require('express');
const router = express.Router();
const {
  getMyProfile,
  getMyMatchHistory,
  getPlayerProfile,
  updateMyProfile,
} = require('../controllers/playerController');
const authMiddleware = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { playerSchemas } = require('../validators/schemas');

router.get('/me', authMiddleware, getMyProfile);
router.patch('/me/profile', authMiddleware, validate({ body: playerSchemas.updateProfileBody }), updateMyProfile);
router.get('/me/matches', authMiddleware, validate({ query: playerSchemas.matchHistoryQuery }), getMyMatchHistory);
router.get('/:userId', validate({ params: playerSchemas.playerIdParams }), getPlayerProfile);

module.exports = router;
