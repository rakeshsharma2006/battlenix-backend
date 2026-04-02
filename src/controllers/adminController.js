const Payment = require('../models/Payment');
const Match = require('../models/Match');
const logger = require('../utils/logger');
const { serializeMatch } = require('../services/matchLifecycleService');

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

const listPayments = async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const filter = status ? { status } : {};

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

    logger.info('Admin payments listed', { actorId: req.user._id, page, limit, status: status || null });
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
    const { page, limit, status } = req.query;
    const filter = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [matches, total] = await Promise.all([
      Match.find(filter)
        .sort({ startTime: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('winner', 'username')
        .lean(),
      Match.countDocuments(filter),
    ]);

    logger.info('Admin matches listed', { actorId: req.user._id, page, limit, status: status || null });
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

module.exports = {
  listPayments,
  listRefunds,
  listMatches,
};
