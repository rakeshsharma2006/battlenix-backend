const Payment = require('../models/Payment');
const Match = require('../models/Match');
const User = require('../models/User');
const PayoutLog = require('../models/PayoutLog');
const logger = require('../utils/logger');
const { serializeMatch } = require('../services/matchLifecycleService');
const { getResolvedMatchConfig } = require('../config/prizeConfig');
const { canBanUsers } = require('../utils/permissions');
const { cancelMatchAndRefund } = require('../services/matchCancellationService');
const { getAdminDiagnostics } = require('../utils/runtimeInfo');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSearchRegex = (search) => {
  if (!search) return null;
  return new RegExp(escapeRegex(search.trim()), 'i');
};

const buildPagination = async ({ model, filter, page, limit, query }) => {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    query.skip(skip).limit(limit).lean(),
    model.countDocuments(filter),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };
};

const getSearchableUserIds = async (search) => {
  const regex = buildSearchRegex(search);
  if (!regex) return [];

  const users = await User.find({
    $or: [
      { username: regex },
      { email: regex },
    ],
  }).select('_id').lean();

  return users.map((user) => user._id);
};

const listPayments = async (req, res) => {
  try {
    const { page, limit, status, search } = req.query;
    const filter = status ? { status } : {};
    const searchableUserIds = await getSearchableUserIds(search);
    const regex = buildSearchRegex(search);

    if (regex) {
      filter.$or = [
        { razorpay_order_id: regex },
        { razorpay_payment_id: regex },
        ...(searchableUserIds.length > 0 ? [{ userId: { $in: searchableUserIds } }] : []),
      ];
    }

    const data = await buildPagination({
      model: Payment,
      filter,
      page,
      limit,
      query: Payment.find(filter)
        .sort({ createdAt: -1 })
        .populate('userId', 'username email role')
        .populate('matchId', 'title game status startTime entryFee'),
    });

    logger.info('Admin payments listed', {
      actorId: req.user._id,
      page,
      limit,
      status: status || null,
      search: search || null,
    });
    return res.status(200).json({ payments: data.items, pagination: data.pagination });
  } catch (error) {
    logger.error('listPayments error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch payments', error: error.message });
  }
};

const listRefunds = async (req, res) => {
  try {
    const { page, limit, refundStatus } = req.query;
    const filter = {
      refundStatus: refundStatus || { $in: ['PENDING', 'PROCESSED', 'FAILED'] },
    };

    const data = await buildPagination({
      model: Payment,
      filter,
      page,
      limit,
      query: Payment.find(filter)
        .sort({ refundCreatedAt: -1, updatedAt: -1 })
        .populate('userId', 'username email role')
        .populate('matchId', 'title game status startTime entryFee'),
    });

    logger.info('Admin refunds listed', {
      actorId: req.user._id,
      page,
      limit,
      refundStatus: refundStatus || null,
    });

    return res.status(200).json({ refunds: data.items, pagination: data.pagination });
  } catch (error) {
    logger.error('listRefunds error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch refunds', error: error.message });
  }
};

const listMatches = async (req, res) => {
  try {
    const { page, limit, status, game, search } = req.query;
    const filter = {};
    const skip = (page - 1) * limit;
    const regex = buildSearchRegex(search);

    if (status) filter.status = status;
    if (game) filter.game = game;
    if (regex) {
      filter.$or = [
        { title: regex },
        { map: regex },
        { mode: regex },
        { game: regex },
      ];
    }

    const [matches, total] = await Promise.all([
      Match.find(filter)
        .sort({ startTime: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('winner', 'username')
        .lean(),
      Match.countDocuments(filter),
    ]);

    logger.info('Admin matches listed', {
      actorId: req.user._id,
      page,
      limit,
      status: status || null,
      game: game || null,
      search: search || null,
    });
    return res.status(200).json({
      matches: matches.map((match) => serializeMatch(match, { includeSensitive: true })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    logger.error('listMatches error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch admin matches', error: error.message });
  }
};

const listUsers = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const regex = buildSearchRegex(search);
    const filter = regex
      ? {
          $or: [
            { username: regex },
            { email: regex },
          ],
        }
      : {};

    const data = await buildPagination({
      model: User,
      filter,
      page,
      limit,
      query: User.find(filter)
        .select('username email role trustScore isFlagged isBanned gameUID gameName upiId createdAt updatedAt')
        .sort({ createdAt: -1 }),
    });

    return res.status(200).json({ users: data.items, pagination: data.pagination });
  } catch (error) {
    logger.error('listUsers error', { error: error.message, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to fetch users', error: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      bannedUsers,
      flaggedUsers,
      totalMatches,
      activeMatches,
      completedMatches,
      totalRevenue,
      pendingPayouts,
      paidPayouts,
      recentFlags,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBanned: true }),
      User.countDocuments({ isFlagged: true }),
      Match.countDocuments({}),
      Match.countDocuments({ status: { $in: ['UPCOMING', 'READY', 'LIVE'] } }),
      Match.countDocuments({ status: 'COMPLETED' }),
      Payment.aggregate([
        { $match: { status: 'SUCCESS' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      PayoutLog.countDocuments({ status: 'PENDING' }),
      PayoutLog.countDocuments({ status: 'PAID' }),
      User.find({ isFlagged: true })
        .select('username trustScore isFlagged isBanned updatedAt')
        .sort({ trustScore: 1, updatedAt: -1 })
        .limit(5)
        .lean(),
    ]);

    logger.info('Admin dashboard stats fetched', { actorId: req.user._id });
    return res.status(200).json({
      dashboard: {
        users: {
          total: totalUsers,
          banned: bannedUsers,
          flagged: flaggedUsers,
        },
        matches: {
          total: totalMatches,
          active: activeMatches,
          completed: completedMatches,
        },
        revenue: {
          totalCollected: totalRevenue[0]?.total ?? 0,
        },
        payouts: {
          pending: pendingPayouts,
          paid: paidPayouts,
        },
        recentFlags,
        diagnostics: getAdminDiagnostics(),
      },
    });
  } catch (error) {
    logger.error('getDashboardStats error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch dashboard stats', error: error.message });
  }
};

const listFlags = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const filter = { 'flags.0': { $exists: true } };

    const data = await buildPagination({
      model: User,
      filter,
      page,
      limit,
      query: User.find(filter)
        .select('username email role trustScore isFlagged flags createdAt updatedAt')
        .sort({ isFlagged: -1, trustScore: 1, updatedAt: -1 }),
    });

    logger.info('Admin fraud flags listed', { actorId: req.user._id, page, limit });
    return res.status(200).json({ flags: data.items, pagination: data.pagination });
  } catch (error) {
    logger.error('listFlags error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch fraud flags', error: error.message });
  }
};

const getFlagDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('_id username email trustScore isFlagged isBanned flags createdAt updatedAt')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ user });
  } catch (error) {
    logger.error('getFlagDetails error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch flag details', error: error.message });
  }
};

const reviewFlag = async (req, res) => {
  try {
    const { action, adminNote } = req.body;

    if (action === 'ban' && !canBanUsers(req.user)) {
      return res.status(403).json({ message: 'Forbidden: Managers cannot ban users' });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.flags.push({
      type: 'admin_review',
      reason: adminNote,
      severity: action === 'clear' ? 'low' : 'high',
      trustPenalty: 0,
      matchId: null,
      metadata: {
        action: action === 'clear' ? 'cleared' : 'banned',
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
      },
      createdAt: new Date(),
    });

    if (action === 'clear') {
      user.isFlagged = false;
      user.trustScore = 60;
    }

    if (action === 'ban') {
      user.isBanned = true;
      user.isFlagged = true;
    }

    await user.save();

    logger.info('Admin reviewed flagged user', {
      actorId: req.user._id,
      targetUserId: user._id,
      action,
    });

    return res.status(200).json({
      message: action === 'clear' ? 'User cleared' : 'User banned',
      user: {
        _id: user._id,
        username: user.username,
        trustScore: user.trustScore,
        isFlagged: user.isFlagged,
        isBanned: user.isBanned,
      },
    });
  } catch (error) {
    logger.error('reviewFlag error', { error: error.message });
    return res.status(500).json({ message: 'Failed to review flagged user', error: error.message });
  }
};

const createTimeSlot = async (req, res) => {
  try {
    const { game, map, mode, entryFee, startTime } = req.body;
    const normalizedStartTime = new Date(startTime);
    if (Number.isNaN(normalizedStartTime.getTime())) {
      return res.status(400).json({ message: 'Invalid startTime' });
    }

    const matchConfig = getResolvedMatchConfig({ game, map, mode, entryFee });

    const existing = await Match.findOne({
      game: matchConfig.game,
      map: matchConfig.map,
      mode: matchConfig.mode,
      entryFee: matchConfig.entryFee,
      startTime: normalizedStartTime,
      status: { $in: ['UPCOMING', 'READY'] },
      isAutoCreated: true,
    });

    if (existing) {
      return res.status(400).json({
        message: 'A slot already exists for this time, game, map, mode, and entry fee.',
        existingSlotId: existing._id,
      });
    }

    const match = await Match.create({
      title: `${matchConfig.map} ${matchConfig.mode} Rs ${matchConfig.entryFee}`,
      game: matchConfig.game,
      map: matchConfig.map,
      mode: matchConfig.mode,
      entryFee: matchConfig.entryFee,
      maxPlayers: matchConfig.maxPlayers,
      prizeBreakdown: matchConfig.prizeBreakdown,
      slotType: 'RANDOM',
      isAutoCreated: true,
      status: 'UPCOMING',
      startTime: normalizedStartTime,
      createdBy: req.user._id,
      players: [],
      playersCount: 0,
    });

    logger.info('Admin created time slot', {
      adminId: req.user._id,
      matchId: match._id,
      game: matchConfig.game,
      map: matchConfig.map,
      mode: matchConfig.mode,
      entryFee: matchConfig.entryFee,
      startTime,
    });

    return res.status(201).json({
      message: 'Time slot created',
      match: {
        _id: match._id,
        title: match.title,
        game: match.game,
        map: match.map,
        mode: match.mode,
        entryFee: match.entryFee,
        maxPlayers: match.maxPlayers,
        startTime: match.startTime,
        prizeBreakdown: match.prizeBreakdown,
      },
    });
  } catch (error) {
    logger.error('createTimeSlot error', { error: error.message, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to create time slot', error: error.message });
  }
};

const listTodaySlots = async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const filter = {
      isAutoCreated: true,
      startTime: { $gte: startOfDay, $lte: endOfDay },
    };

    if (req.query.game) filter.game = req.query.game;
    if (req.query.map) filter.map = req.query.map;
    if (req.query.mode) filter.mode = req.query.mode;

    const slots = await Match.find(filter)
      .select('title game map mode entryFee maxPlayers playersCount status startTime prizeBreakdown createdBy')
      .populate('createdBy', 'username')
      .sort({ startTime: 1, entryFee: 1 })
      .lean();

    const enriched = slots.map((slot) => ({
      ...slot,
      isExpired: slot.startTime < now,
      isFull: slot.playersCount >= slot.maxPlayers,
      fillPercent: Math.round((slot.playersCount / slot.maxPlayers) * 100),
    }));

    return res.status(200).json({ slots: enriched, total: enriched.length });
  } catch (error) {
    logger.error('listTodaySlots error', { error: error.message, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to fetch slots', error: error.message });
  }
};

const deleteTimeSlot = async (req, res) => {
  try {
    const match = await Match.findById(req.params.slotId);
    if (!match) return res.status(404).json({ message: 'Slot not found' });
    if (!match.isAutoCreated) {
      return res.status(400).json({ message: 'Only auto-created slots can be deleted this way' });
    }
    if (match.playersCount > 0) {
      return res.status(400).json({ message: 'Cannot delete a slot with players. Cancel it instead.' });
    }

    await match.deleteOne();

    logger.info('Admin deleted time slot', { adminId: req.user._id, slotId: req.params.slotId });
    return res.status(200).json({ message: 'Slot deleted successfully' });
  } catch (error) {
    logger.error('deleteTimeSlot error', { error: error.message, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to delete slot', error: error.message });
  }
};

const bulkCancelMatches = async (req, res) => {
  try {
    const results = [];

    for (const matchId of req.body.matchIds) {
      try {
        const cancelled = await cancelMatchAndRefund(matchId, {
          actorId: req.user._id,
          reason: 'Matches cancelled in bulk by admin',
          refundReason: 'Match cancelled',
        });

        if (!cancelled) {
          results.push({ matchId, success: false, message: 'Match not found' });
          continue;
        }

        results.push({
          matchId,
          success: true,
          status: cancelled.match.status,
        });
      } catch (error) {
        results.push({
          matchId,
          success: false,
          message: error.statusCode ? error.message : 'Failed to cancel match',
        });
      }
    }

    return res.status(200).json({ results });
  } catch (error) {
    logger.error('bulkCancelMatches error', { error: error.message, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to bulk cancel matches', error: error.message });
  }
};

module.exports = {
  listPayments,
  listRefunds,
  listMatches,
  listUsers,
  getDashboardStats,
  listFlags,
  getFlagDetails,
  reviewFlag,
  createTimeSlot,
  listTodaySlots,
  deleteTimeSlot,
  bulkCancelMatches,
};
