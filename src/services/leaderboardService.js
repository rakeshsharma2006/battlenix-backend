const mongoose = require('mongoose');
const Leaderboard = require('../models/Leaderboard');
const MatchResult = require('../models/MatchResult');
const User = require('../models/User');
const JobLock = require('../models/JobLock');
const logger = require('../utils/logger');
const cache = require('../utils/cache');
const { emitEvent } = require('./socketService');
const redisClient = require('../config/redis');

const WEEKLY_RESET_PREFIX = 'leaderboard_weekly_reset';
const MONTHLY_RESET_PREFIX = 'leaderboard_monthly_reset';

const getPointsForResult = ({ kills, isWinner }) => (isWinner ? 10 : 0) + (Number(kills) * 2) + 1;

const getWeekKey = (date = new Date()) => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}_${String(weekNumber).padStart(2, '0')}`;
};

const getMonthKey = (date = new Date()) => `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const claimPeriodLock = async (lockId) => {
  try {
    await JobLock.create({
      _id: lockId,
      ownerId: 'leaderboard-period-rollover',
      lockedUntil: new Date('2999-12-31T23:59:59.999Z'),
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
};

const buildLeaderboardBulkOperation = ({ userId, username, kills, isWinner, lastMatchAt, weekKey, monthKey }) => {
  const normalizedKills = Number(kills) || 0;
  const winnerFlag = Boolean(isWinner);
  const points = getPointsForResult({ kills: normalizedKills, isWinner: winnerFlag });

  return {
    updateOne: {
      filter: { userId: new mongoose.Types.ObjectId(userId) },
      update: [
        {
          $set: {
            username,
            lastMatchAt,
            totalPoints: {
              $add: [{ $ifNull: ['$totalPoints', 0] }, points],
            },
            totalWins: {
              $add: [{ $ifNull: ['$totalWins', 0] }, winnerFlag ? 1 : 0],
            },
            totalKills: {
              $add: [{ $ifNull: ['$totalKills', 0] }, normalizedKills],
            },
            totalMatches: {
              $add: [{ $ifNull: ['$totalMatches', 0] }, 1],
            },
            weeklyPoints: {
              $add: [
                {
                  $cond: [
                    { $eq: ['$weekKey', weekKey] },
                    { $ifNull: ['$weeklyPoints', 0] },
                    0,
                  ],
                },
                points,
              ],
            },
            weekKey,
            monthlyPoints: {
              $add: [
                {
                  $cond: [
                    { $eq: ['$monthKey', monthKey] },
                    { $ifNull: ['$monthlyPoints', 0] },
                    0,
                  ],
                },
                points,
              ],
            },
            monthKey,
          },
        },
      ],
      upsert: true,
    },
  };
};

const updateLeaderboard = async (userId, kills, isWinner) => {
  const user = await User.findById(userId).select('username').lean();
  if (!user) {
    throw new Error(`User not found for leaderboard update: ${userId}`);
  }

  const now = new Date();
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);

  try {
    await Leaderboard.bulkWrite([
      buildLeaderboardBulkOperation({
        userId,
        username: user.username,
        kills,
        isWinner,
        lastMatchAt: now,
        weekKey,
        monthKey,
      }),
    ], { ordered: false });
    logger.info('Leaderboard updated successfully for single user', { userId, kills, isWinner });
  } catch (error) {
    logger.warn('Leaderboard single update partial/full failure', { userId, error: error.message });
  }

  return Leaderboard.findOne({ userId }).lean();
};

const applyMatchResultsToLeaderboard = async ({
  session,
  matchId,
  results,
  winner,
  matchCompletedAt = new Date(),
}) => {
  if (!Array.isArray(results) || results.length === 0) {
    return [];
  }

  const userIds = [...new Set(results.map((entry) => String(entry.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('username')
    .session(session)
    .lean();
  const usernameMap = new Map(users.map((user) => [String(user._id), user.username]));

  const matchResultDocs = results.map((entry) => {
    const isWinner = String(entry.userId) === String(winner);
    const kills = Number(entry.kills) || 0;
    return {
      matchId,
      userId: new mongoose.Types.ObjectId(entry.userId),
      kills,
      position: Number(entry.position),
      isWinner,
      pointsEarned: getPointsForResult({ kills, isWinner }),
    };
  });

  try {
    await MatchResult.insertMany(matchResultDocs, {
      session,
      ordered: false,
    });
  } catch (error) {
    logger.warn('MatchResult insertMany partial/full failure', { matchId, error: error.message });
  }

  const weekKey = getWeekKey(matchCompletedAt);
  const monthKey = getMonthKey(matchCompletedAt);
  const leaderboardOps = matchResultDocs.map((entry) => {
    const username = usernameMap.get(String(entry.userId));
    if (!username) {
      throw new Error(`User not found for leaderboard update: ${entry.userId}`);
    }

    return buildLeaderboardBulkOperation({
      userId: entry.userId,
      username,
      kills: entry.kills,
      isWinner: entry.isWinner,
      lastMatchAt: matchCompletedAt,
      weekKey,
      monthKey,
    });
  });

  try {
    await Leaderboard.bulkWrite(leaderboardOps, {
      session,
      ordered: false,
    });
    logger.info('Match results applied to leaderboard', { matchId, usersCount: userIds.length });
    cache.deleteByPrefix('leaderboard:');

    if (redisClient.isReady) {
      try {
        const keys = await redisClient.keys('leaderboard:*');
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
        await redisClient.del(['lb:global:top100', 'lb:weekly:top100', 'lb:monthly:top100']);
      } catch (err) {
        logger.error('Leaderboard cache invalidation error', { error: err.message });
      }
    }
  } catch (error) {
    logger.warn('Leaderboard bulkWrite partial/full failure', { matchId, error: error.message });
  }

  return Leaderboard.find({ userId: { $in: userIds } })
    .select('userId username totalPoints totalWins totalKills totalMatches weeklyPoints monthlyPoints weekKey monthKey lastMatchAt')
    .session(session)
    .lean();
};

const emitLeaderboardUpdate = (payload) => {
  emitEvent('leaderboard_update', payload);
};

const getLeaderboardSort = (scope) => {
  if (scope === 'weekly') {
    return { weeklyPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 };
  }

  if (scope === 'monthly') {
    return { monthlyPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 };
  }

  return { totalPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 };
};

const getLeaderboardProjection = (scope) => {
  if (scope === 'weekly') {
    return 'userId username weeklyPoints totalWins totalKills totalMatches lastMatchAt';
  }

  if (scope === 'monthly') {
    return 'userId username monthlyPoints totalWins totalKills totalMatches lastMatchAt';
  }

  return 'userId username totalPoints totalWins totalKills totalMatches lastMatchAt';
};

const getLeaderboardFilter = (scope) => {
  if (scope === 'weekly') {
    return { weekKey: getWeekKey(new Date()) };
  }

  if (scope === 'monthly') {
    return { monthKey: getMonthKey(new Date()) };
  }

  return {};
};

const getLeaderboardPage = async (scope, query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;
  const skip = (page - 1) * limit;
  const sort = getLeaderboardSort(scope);
  const projection = getLeaderboardProjection(scope);
  const filter = getLeaderboardFilter(scope);

  const isTop100 = (skip + limit) <= 100;
  const cacheKey = `leaderboard:${scope}:page:${page}:limit:${limit}`;

  if (isTop100 && redisClient.isReady) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.error('Redis cache get error', { err: err.message, cacheKey });
    }
  }

  const [items, total] = await Promise.all([
    Leaderboard.find(filter)
      .select(projection)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Leaderboard.countDocuments(filter),
  ]);

  const result = {
    leaderboard: items.map((entry, index) => ({
      ...entry,
      rank: skip + index + 1,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };

  if (isTop100 && redisClient.isReady) {
    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
    } catch (err) {
      logger.error('Redis cache set error', { err: err.message, cacheKey });
    }
  }

  return result;
};

const getPublicLeaderboardPage = async (query) => {
  const data = await getLeaderboardPage('global', query);
  const userIds = data.leaderboard
    .map((entry) => String(entry.userId || ''))
    .filter(Boolean);

  if (userIds.length === 0) {
    return {
      leaderboard: [],
      pagination: data.pagination,
    };
  }

  const objectIds = userIds.map((userId) => new mongoose.Types.ObjectId(userId));
  const prizeExpression = {
    $cond: [
      { $gt: ['$match.prizeAmount', 0] },
      '$match.prizeAmount',
      {
        $cond: [
          { $gt: ['$match.prizeBreakdown.prizePerMember', 0] },
          '$match.prizeBreakdown.prizePerMember',
          '$match.prizeBreakdown.playerPrize',
        ],
      },
    ],
  };

  const [users, earningsRows] = await Promise.all([
    User.find({ _id: { $in: objectIds } })
      .select('_id trustScore')
      .lean(),
    MatchResult.aggregate([
      {
        $match: {
          userId: { $in: objectIds },
          isWinner: true,
        },
      },
      {
        $lookup: {
          from: 'matches',
          localField: 'matchId',
          foreignField: '_id',
          as: 'match',
        },
      },
      { $unwind: '$match' },
      {
        $group: {
          _id: '$userId',
          earnings: {
            $sum: prizeExpression,
          },
        },
      },
    ]),
  ]);

  const trustScoreByUserId = new Map(
    users.map((user) => [
      String(user._id),
      Number(user.trustScore) || 0,
    ])
  );
  const earningsByUserId = new Map(
    earningsRows.map((entry) => [
      String(entry._id),
      Number(entry.earnings) || 0,
    ])
  );

  return {
    leaderboard: data.leaderboard.map((entry, index) => {
      const userId = String(entry.userId || '');
      return {
        userId,
        username: entry.username?.toString() || 'Unknown',
        wins: Number(entry.totalWins) || 0,
        totalMatches: Number(entry.totalMatches) || 0,
        earnings: earningsByUserId.get(userId) || 0,
        trustScore: trustScoreByUserId.get(userId) || 0,
        rank: Number(entry.rank) || index + 1,
      };
    }),
    pagination: data.pagination,
  };
};

const handleWeeklyLeaderboardRollover = async () => {
  const weekKey = getWeekKey(new Date());
  const claimed = await claimPeriodLock(`${WEEKLY_RESET_PREFIX}_${weekKey}`);
  if (!claimed) {
    return false;
  }

  logger.info('Weekly leaderboard period advanced', { weekKey });
  emitLeaderboardUpdate({ scope: 'weekly_reset', weekKey });
  return true;
};

const handleMonthlyLeaderboardRollover = async () => {
  const monthKey = getMonthKey(new Date());
  const claimed = await claimPeriodLock(`${MONTHLY_RESET_PREFIX}_${monthKey}`);
  if (!claimed) {
    return false;
  }

  logger.info('Monthly leaderboard period advanced', { monthKey });
  emitLeaderboardUpdate({ scope: 'monthly_reset', monthKey });
  return true;
};

module.exports = {
  getPointsForResult,
  getWeekKey,
  getMonthKey,
  updateLeaderboard,
  applyMatchResultsToLeaderboard,
  emitLeaderboardUpdate,
  getLeaderboardPage,
  getPublicLeaderboardPage,
  handleWeeklyLeaderboardRollover,
  handleMonthlyLeaderboardRollover,
};
