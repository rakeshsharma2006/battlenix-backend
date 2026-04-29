const mongoose = require('mongoose');
const User = require('../models/User');
const MatchResult = require('../models/MatchResult');
const Leaderboard = require('../models/Leaderboard');
const logger = require('../utils/logger');

const DEFAULT_STATS = {
  totalPoints: 0,
  totalWins: 0,
  totalKills: 0,
  totalMatches: 0,
  weeklyPoints: 0,
  monthlyPoints: 0,
  lastMatchAt: null,
};

const getStatsPayload = (leaderboardEntry) => ({
  totalPoints: leaderboardEntry?.totalPoints || 0,
  totalWins: leaderboardEntry?.totalWins || 0,
  totalKills: leaderboardEntry?.totalKills || 0,
  totalMatches: leaderboardEntry?.totalMatches || 0,
  weeklyPoints: leaderboardEntry?.weeklyPoints || 0,
  monthlyPoints: leaderboardEntry?.monthlyPoints || 0,
  lastMatchAt: leaderboardEntry?.lastMatchAt || null,
});

const getMyProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const [user, leaderboardEntry] = await Promise.all([
      User.findById(userId)
        .select('username email gameUID gameName upiId ' +
                'bgmiUID bgmiName bgmiUpiId ' +
                'ffUID ffName ffUpiId ' +
                'avatar trustScore createdAt role isFlagged isBanned')
        .lean(),
      Leaderboard.findOne({ userId })
        .select('totalPoints totalWins totalKills totalMatches weeklyPoints monthlyPoints lastMatchAt')
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      profile: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        trustScore: user.trustScore,
        avatar: user.avatar,
        isFlagged: user.isFlagged,
        isBanned: user.isBanned,
        createdAt: user.createdAt,

        // Per-game profiles
        bgmiUID: user.bgmiUID || null,
        bgmiName: user.bgmiName || null,
        bgmiUpiId: user.bgmiUpiId || null,

        ffUID: user.ffUID || null,
        ffName: user.ffName || null,
        ffUpiId: user.ffUpiId || null,

        // Legacy fallback
        gameUID: user.gameUID || user.bgmiUID || null,
        gameName: user.gameName || user.bgmiName || null,
        upiId: user.upiId || user.bgmiUpiId || null,

        stats: leaderboardEntry
          ? getStatsPayload(leaderboardEntry)
          : DEFAULT_STATS,
      },
    });
  } catch (error) {
    logger.error('getMyProfile error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to fetch profile',
      error: error.message,
    });
  }
};

const getMyMatchHistory = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [matchResults, total] = await Promise.all([
      MatchResult.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('matchId', 'title game status startTime entryFee maxPlayers')
        .lean(),
      MatchResult.countDocuments({ userId: req.user._id }),
    ]);

    return res.status(200).json({
      matches: matchResults.map((result) => ({
        matchId: result.matchId?._id || result.matchId || null,
        title: result.matchId?.title || null,
        game: result.matchId?.game || null,
        status: result.matchId?.status || null,
        startTime: result.matchId?.startTime || null,
        entryFee: result.matchId?.entryFee || 0,
        maxPlayers: result.matchId?.maxPlayers || 0,
        position: result.position,
        kills: result.kills,
        isWinner: result.isWinner,
        pointsEarned: result.pointsEarned,
        playedAt: result.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    logger.error('getMyMatchHistory error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch match history', error: error.message });
  }
};

const getPlayerProfile = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.params.userId);
    const [user, leaderboardEntry] = await Promise.all([
      User.findById(userId)
        .select('username role createdAt')
        .lean(),
      Leaderboard.findOne({ userId })
        .select('totalPoints totalWins totalKills totalMatches weeklyPoints monthlyPoints lastMatchAt')
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      profile: {
        _id: user._id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        stats: leaderboardEntry ? getStatsPayload(leaderboardEntry) : DEFAULT_STATS,
      },
    });
  } catch (error) {
    logger.error('getPlayerProfile error', { error: error.message, userId: req.params.userId });
    return res.status(500).json({ message: 'Failed to fetch player profile', error: error.message });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const allowedFields = [
      'username',
      'bgmiUID', 'bgmiName', 'bgmiUpiId',
      'ffUID', 'ffName', 'ffUpiId',
      // Legacy
      'gameUID', 'gameName', 'upiId',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]?.trim() || null;
      }
    }

    // If legacy gameUID sent with game field,
    // map to correct per-game field
    if (req.body.game === 'BGMI' && req.body.gameUID) {
      updates.bgmiUID = req.body.gameUID?.trim() || null;
      updates.bgmiName = req.body.gameName?.trim() || null;
      updates.bgmiUpiId = req.body.upiId?.trim() || null;
    }

    if (req.body.game === 'FREE_FIRE' && req.body.gameUID) {
      updates.ffUID = req.body.gameUID?.trim() || null;
      updates.ffName = req.body.gameName?.trim() || null;
      updates.ffUpiId = req.body.upiId?.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: 'No valid fields to update',
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    )
    .select('username email gameUID gameName upiId ' +
            'bgmiUID bgmiName bgmiUpiId ' +
            'ffUID ffName ffUpiId ' +
            'avatar trustScore createdAt role ' +
            'isFlagged isBanned')
    .lean();

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    try {
      const userUpi = updatedUser.upiId || updatedUser.bgmiUpiId || updatedUser.ffUpiId;
      if (userUpi) {
        const duplicateUpi = await User.countDocuments({
          $or: [{ upiId: userUpi }, { bgmiUpiId: userUpi }, { ffUpiId: userUpi }],
          _id: { $ne: updatedUser._id },
        });
        if (duplicateUpi > 0) {
          await User.findByIdAndUpdate(updatedUser._id, {
            $addToSet: { fraudFlags: 'DUPLICATE_UPI' },
          });
        }
      }
    } catch (fraudErr) {
      logger.error('Fraud detection failed during profile update (non-fatal)', { error: fraudErr.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    logger.error('updateMyProfile error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to update profile',
      error: error.message,
    });
  }
};

module.exports = {
  getMyProfile,
  getMyMatchHistory,
  getPlayerProfile,
  updateMyProfile,
};
