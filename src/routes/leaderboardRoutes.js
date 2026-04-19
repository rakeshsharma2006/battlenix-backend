const express = require('express');
const router = express.Router();
const {
  getPublicLeaderboard,
  getGlobalLeaderboard,
  getWeeklyLeaderboard,
  getMonthlyLeaderboard,
  getLeaderboardMe,
} = require('../controllers/leaderboardController');
const validate = require('../middlewares/validationMiddleware');
const authMiddleware = require('../middlewares/authMiddleware');
const { leaderboardSchemas } = require('../validators/schemas');

router.get('/me', authMiddleware, getLeaderboardMe);
router.get('/', validate({ query: leaderboardSchemas.listQuery }), getPublicLeaderboard);
router.get('/global', validate({ query: leaderboardSchemas.listQuery }), getGlobalLeaderboard);
router.get('/weekly', validate({ query: leaderboardSchemas.listQuery }), getWeeklyLeaderboard);
router.get('/monthly', validate({ query: leaderboardSchemas.listQuery }), getMonthlyLeaderboard);

module.exports = router;
