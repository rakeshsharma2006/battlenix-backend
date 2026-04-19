const Match = require('../models/Match');
const User = require('../models/User');
const PayoutLog = require('../models/PayoutLog');
const logger = require('../utils/logger');
const { emitToUser } = require('../services/socketService');

// POST /admin/matches/:id/declare-winner
const declareWinner = async (req, res) => {
  try {
    const { winnerId, prizeAmount, notes } = req.body;
    const matchId = req.params.id;

    if (!winnerId) {
      return res.status(400).json({ message: 'winnerId is required' });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status !== 'COMPLETED') {
      return res.status(400).json({
        message: 'Winner can only be declared for COMPLETED matches',
      });
    }

    if (match.paymentStatus === 'PAID') {
      return res.status(400).json({
        message: 'Payment already marked as paid for this match',
      });
    }

    const winner = await User.findById(winnerId)
      .select('username email upiId gameUID gameName');
    if (!winner) {
      return res.status(404).json({ message: 'Winner user not found' });
    }

    if (!winner.upiId) {
      return res.status(400).json({
        message: 'Winner has not set their UPI ID in profile. Cannot process payout.',
      });
    }

    const prize = prizeAmount ?? match.prizeBreakdown?.playerPrize ?? 0;

    match.declaredWinnerId = winnerId;
    match.winnerUpiId = winner.upiId;
    match.prizeAmount = prize;
    match.paymentStatus = 'PENDING';
    if (!match.winner) match.winner = winnerId;
    await match.save();

    const payoutLog = await PayoutLog.findOneAndUpdate(
      { matchId: match._id, status: 'PENDING' },
      {
        $set: {
          matchId: match._id,
          winnerId: winner._id,
          winnerUsername: winner.username,
          winnerUpiId: winner.upiId,
          winnerGameUID: winner.gameUID,
          winnerGameName: winner.gameName,
          amount: prize,
          matchTitle: match.title,
          matchMap: match.map,
          matchMode: match.mode,
          status: 'PENDING',
          notes: notes || null,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    emitToUser(String(winnerId), 'winner_declared', {
      matchId: match._id,
      matchTitle: match.title,
      prizeAmount: prize,
      paymentStatus: 'PENDING',
      message: `Congratulations! You won Rs ${prize}. Payment is being processed.`,
    });

    logger.info('Winner declared', {
      matchId: match._id,
      winnerId,
      winnerUsername: winner.username,
      prizeAmount: prize,
      actorId: req.user._id,
    });

    return res.status(200).json({
      message: 'Winner declared successfully',
      payout: {
        _id: payoutLog._id,
        winner: {
          _id: winner._id,
          username: winner.username,
          email: winner.email,
          upiId: winner.upiId,
          gameUID: winner.gameUID,
          gameName: winner.gameName,
        },
        prizeAmount: prize,
        paymentStatus: 'PENDING',
        matchTitle: match.title,
      },
    });
  } catch (error) {
    logger.error('declareWinner error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to declare winner',
      error: error.message,
    });
  }
};

// POST /admin/matches/:id/mark-paid
const markPaid = async (req, res) => {
  try {
    const matchId = req.params.id;
    const { notes } = req.body;

    const match = await Match.findById(matchId)
      .populate('declaredWinnerId', 'username email upiId');
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.paymentStatus !== 'PENDING') {
      return res.status(400).json({
        message: match.paymentStatus === 'PAID'
          ? 'Payment already marked as paid'
          : 'Winner must be declared first',
      });
    }

    const admin = await User.findById(req.user._id)
      .select('username');

    match.paymentStatus = 'PAID';
    match.paidBy = req.user._id;
    match.paidAt = new Date();
    await match.save();

    await PayoutLog.findOneAndUpdate(
      { matchId: match._id, status: 'PENDING' },
      {
        $set: {
          status: 'PAID',
          paidBy: req.user._id,
          paidByUsername: admin?.username || 'Admin',
          paidAt: new Date(),
          notes: notes || null,
        },
      }
    );

    if (match.declaredWinnerId) {
      emitToUser(String(match.declaredWinnerId._id || match.declaredWinnerId), 'payment_done', {
        matchId: match._id,
        matchTitle: match.title,
        prizeAmount: match.prizeAmount,
        paymentStatus: 'PAID',
        message: `Payment of Rs ${match.prizeAmount} has been sent to your UPI!`,
      });
    }

    logger.info('Payment marked as paid', {
      matchId: match._id,
      prizeAmount: match.prizeAmount,
      actorId: req.user._id,
    });

    return res.status(200).json({
      message: 'Payment marked as paid successfully',
      match: {
        _id: match._id,
        paymentStatus: 'PAID',
        paidAt: match.paidAt,
        prizeAmount: match.prizeAmount,
      },
    });
  } catch (error) {
    logger.error('markPaid error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to mark payment',
      error: error.message,
    });
  }
};

// GET /admin/payouts
const listPayouts = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const filter = status ? { status } : {};

    const [payouts, total] = await Promise.all([
      PayoutLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('paidBy', 'username')
        .lean(),
      PayoutLog.countDocuments(filter),
    ]);

    logger.info('Admin payouts listed', {
      actorId: req.user._id,
      page,
      status,
    });

    return res.status(200).json({
      payouts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    logger.error('listPayouts error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to fetch payouts',
      error: error.message,
    });
  }
};

// GET /admin/payouts/:payoutId
const getPayoutDetail = async (req, res) => {
  try {
    const payout = await PayoutLog.findById(req.params.payoutId)
      .populate('matchId', 'title map mode entryFee status')
      .populate('paidBy', 'username email')
      .lean();

    if (!payout) {
      return res.status(404).json({ message: 'Payout not found' });
    }

    return res.status(200).json({ payout });
  } catch (error) {
    logger.error('getPayoutDetail error', { error: error.message });
    return res.status(500).json({
      message: 'Failed to fetch payout',
      error: error.message,
    });
  }
};

module.exports = {
  declareWinner,
  markPaid,
  listPayouts,
  getPayoutDetail,
};
