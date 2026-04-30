const logger = require('../utils/logger');
const {
  getLeaderboardPage,
  getPublicLeaderboardPage,
} = require('../services/leaderboardService');
const Leaderboard = require('../models/Leaderboard');
const redisClient = require('../config/redis');
const cache = require('../utils/cache');

const buildStableCacheKey = (prefix, query = {}) => {
  const normalized = Object.keys(query)
    .sort()
    .reduce((acc, key) => {
      acc[key] = query[key];
      return acc;
    }, {});

  return `${prefix}:${JSON.stringify(normalized)}`;
};

const listLeaderboard = (scope) => async (req, res) => {
  try {
    const data = await getLeaderboardPage(scope, req.query);
    return res.status(200).json(data);
  } catch (error) {
    logger.error('listLeaderboard error', {
      scope,
      error: error.message,
    });
    return res.status(500).json({ message: 'Failed to fetch leaderboard', error: error.message });
  }
};

const getPublicLeaderboard = async (req, res) => {
  try {
    const cacheKey = buildStableCacheKey('leaderboard:public', req.query);
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const data = await getPublicLeaderboardPage(req.query);
    cache.set(cacheKey, data, 300);
    return res.status(200).json(data);
  } catch (error) {
    logger.error('getPublicLeaderboard error', {
      error: error.message,
    });
    return res.status(500).json({ message: 'Failed to fetch leaderboard', error: error.message });
  }
};

const getLeaderboardMe = async (req, res) => {
  try {
    const userId = req.user._id;
    const cacheKey = `userRank:${userId}`;
    let rankData = null;

    if (redisClient.isReady) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) rankData = JSON.parse(cached);
      } catch (err) {
        logger.error('Redis rank cache get error', { error: err.message, userId });
      }
    }

    if (!rankData) {
      const userLeaderboard = await Leaderboard.findOne({ userId }).lean() || { totalPoints: 0, weeklyPoints: 0, monthlyPoints: 0 };
      const rank = await Leaderboard.countDocuments({ totalPoints: { $gt: userLeaderboard.totalPoints || 0 } }) + 1;
      
      rankData = {
        rank,
        totalPoints: userLeaderboard.totalPoints || 0,
        weeklyPoints: userLeaderboard.weeklyPoints || 0,
        monthlyPoints: userLeaderboard.monthlyPoints || 0,
      };

      if (redisClient.isReady) {
        try {
          await redisClient.setEx(cacheKey, 15, JSON.stringify(rankData));
        } catch (err) {
          logger.error('Redis rank cache set error', { error: err.message, userId });
        }
      }
    }
    
    return res.status(200).json(rankData);
  } catch (error) {
    logger.error('getLeaderboardMe error', { userId: req.user?._id, error: error.message });
    return res.status(500).json({ message: 'Failed to fetch personal rank', error: error.message });
  }
};

module.exports = {
  getPublicLeaderboard,
  getGlobalLeaderboard: listLeaderboard('global'),
  getWeeklyLeaderboard: listLeaderboard('weekly'),
  getMonthlyLeaderboard: listLeaderboard('monthly'),
  getLeaderboardMe,
};
