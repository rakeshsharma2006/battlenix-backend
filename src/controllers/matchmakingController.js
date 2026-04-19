const mongoose = require('mongoose');
const Match = require('../models/Match');
const Payment = require('../models/Payment');
const matchmakingService = require('../services/matchmakingService');
const { resolveGameAndMap } = require('../config/prizeConfig');
const { emitEvent } = require('../services/socketService');
const { emitMatchEvent } = require('../services/matchLifecycleService');
const logger = require('../utils/logger');

const KNOWN_ERRORS = [
  'You are already in an active match',
  'Could not generate unique slot code. Try again.',
  'Invalid or expired slot code',
  'This slot is full',
  'You are already in this slot',
  'Invalid map',
  'Invalid entryFee',
  'Invalid mode',
  'Valid payment required',
];

const handleError = (err, res) => {
  const status = KNOWN_ERRORS.includes(err.message) ? 400 : 500;
  return res.status(status).json({ message: err.message });
};

const runAssignmentTransaction = async (executor) => {
  const session = await mongoose.startSession();

  try {
    let attempts = 0;

    while (attempts < 3) {
      attempts += 1;

      try {
        let result;

        await session.withTransaction(async () => {
          result = await executor(session);
        });

        return result;
      } catch (error) {
        if (
          attempts < 3 &&
          error.hasErrorLabel &&
          error.hasErrorLabel('TransientTransactionError')
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Assignment transaction failed');
  } finally {
    await session.endSession();
  }
};

const serializeAssignedMatch = (match) => ({
  _id: match._id,
  title: match.title,
  game: match.game,
  map: match.map,
  mode: match.mode,
  entryFee: match.entryFee,
  playersCount: match.playersCount,
  maxPlayers: match.maxPlayers,
  status: match.status,
  slotType: match.slotType,
});

const findVerifiedPayment = ({ paymentId, userId, amount, session = null }) => {
  const query = {
    _id: paymentId,
    userId,
    status: 'SUCCESS',
    matchId: null,
  };

  if (amount !== undefined) {
    query.amount = amount;
  }

  const paymentQuery = Payment.findOne(query);
  if (session) {
    paymentQuery.session(session);
  }

  return paymentQuery;
};

const emitSlotUpdated = (match) => {
  emitEvent('slot_updated', {
    matchId: match._id.toString(),
    game: match.game,
    map: match.map,
    mode: match.mode,
    entryFee: match.entryFee,
    playersCount: match.playersCount,
    maxPlayers: match.maxPlayers,
    isFull: match.playersCount >= match.maxPlayers,
    status: match.status,
    fillPercent: Math.round((match.playersCount / match.maxPlayers) * 100),
  });

  if (match.status === 'READY') {
    emitMatchEvent('match_ready', match);
  }
};

const getAvailableSlots = async (req, res) => {
  try {
    const { map, mode } = req.query;
    const { game } = resolveGameAndMap(req.query.game, map);

    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const slots = await Match.find({
      game,
      map,
      mode,
      isAutoCreated: true,
      status: { $in: ['UPCOMING', 'READY'] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    })
      .select('title game map mode entryFee maxPlayers playersCount status startTime prizeBreakdown slotType')
      .sort({ entryFee: 1, startTime: 1 })
      .lean();

    const grouped = {};

    for (const slot of slots) {
      const fee = slot.entryFee;
      if (!grouped[fee]) grouped[fee] = [];

      grouped[fee].push({
        _id: slot._id,
        title: slot.title,
        game: slot.game,
        map: slot.map,
        mode: slot.mode,
        entryFee: slot.entryFee,
        maxPlayers: slot.maxPlayers,
        playersCount: slot.playersCount,
        status: slot.status,
        startTime: slot.startTime,
        isExpired: slot.startTime < now,
        isFull: slot.playersCount >= slot.maxPlayers,
        prizeBreakdown: slot.prizeBreakdown,
        fillPercent: Math.round((slot.playersCount / slot.maxPlayers) * 100),
      });
    }

    return res.status(200).json({
      game,
      map,
      mode,
      slots: grouped,
      fetchedAt: now,
    });
  } catch (error) {
    logger.error('getAvailableSlots error', { error: error.message, userId: req.user?._id });
    return res.status(500).json({ message: error.message });
  }
};

const joinRandom = async (req, res) => {
  try {
    const { game, map, mode, entryFee, paymentId } = req.body;
    const userId = req.user._id;

    const payment = await findVerifiedPayment({ paymentId, userId, amount: entryFee });
    if (!payment) {
      return res.status(400).json({ message: 'Valid payment required' });
    }

    const match = await runAssignmentTransaction(async (session) => {
      const paymentInTransaction = await findVerifiedPayment({
        paymentId,
        userId,
        amount: entryFee,
        session,
      });

      if (!paymentInTransaction) {
        throw new Error('Valid payment required');
      }

      const assignedMatch = await matchmakingService.joinRandomSlot({
        userId,
        game,
        map,
        mode,
        entryFee,
        session,
      });

      paymentInTransaction.matchId = assignedMatch._id;
      await paymentInTransaction.save({ session });

      return assignedMatch;
    });

    emitSlotUpdated(match);

    return res.status(200).json({
      message: 'Joined random slot',
      match: serializeAssignedMatch(match),
    });
  } catch (error) {
    logger.error('joinRandom error', { error: error.message, userId: req.user?._id });
    return handleError(error, res);
  }
};

const createFriendsRoom = async (req, res) => {
  try {
    const { game, map, mode, entryFee, paymentId } = req.body;
    const userId = req.user._id;

    const payment = await findVerifiedPayment({ paymentId, userId, amount: entryFee });
    if (!payment) {
      return res.status(400).json({ message: 'Valid payment required' });
    }

    const match = await runAssignmentTransaction(async (session) => {
      const paymentInTransaction = await findVerifiedPayment({
        paymentId,
        userId,
        amount: entryFee,
        session,
      });

      if (!paymentInTransaction) {
        throw new Error('Valid payment required');
      }

      const assignedMatch = await matchmakingService.createFriendsSlot({
        userId,
        game,
        map,
        mode,
        entryFee,
        session,
      });

      paymentInTransaction.matchId = assignedMatch._id;
      await paymentInTransaction.save({ session });

      return assignedMatch;
    });

    emitSlotUpdated(match);

    return res.status(201).json({
      message: 'Friends room created',
      slotCode: match.slotCode,
      match: serializeAssignedMatch(match),
    });
  } catch (error) {
    logger.error('createFriendsRoom error', { error: error.message, userId: req.user?._id });
    return handleError(error, res);
  }
};

const joinFriendsRoom = async (req, res) => {
  try {
    const { slotCode, paymentId } = req.body;
    const normalizedSlotCode = slotCode?.toUpperCase();
    const userId = req.user._id;

    const slot = await Match.findOne({
      slotCode: normalizedSlotCode,
      status: 'UPCOMING',
      slotType: 'FRIENDS',
    }).lean();

    if (!slot) {
      return res.status(400).json({ message: 'Invalid or expired slot code' });
    }

    const payment = await findVerifiedPayment({
      paymentId,
      userId,
      amount: slot.entryFee,
    });

    if (!payment) {
      return res.status(400).json({ message: 'Valid payment required' });
    }

    const match = await runAssignmentTransaction(async (session) => {
      const paymentInTransaction = await findVerifiedPayment({
        paymentId,
        userId,
        amount: slot.entryFee,
        session,
      });

      if (!paymentInTransaction) {
        throw new Error('Valid payment required');
      }

      const assignedMatch = await matchmakingService.joinFriendsSlot({
        userId,
        slotCode: normalizedSlotCode,
        session,
      });

      paymentInTransaction.matchId = assignedMatch._id;
      await paymentInTransaction.save({ session });

      return assignedMatch;
    });

    emitSlotUpdated(match);

    return res.status(200).json({
      message: 'Joined friends room',
      match: serializeAssignedMatch(match),
    });
  } catch (error) {
    logger.error('joinFriendsRoom error', { error: error.message, userId: req.user?._id });
    return handleError(error, res);
  }
};

const getMyCurrentMatch = async (req, res) => {
  try {
    const match = await Match.findOne({
      players: req.user._id,
      status: { $in: ['UPCOMING', 'READY', 'LIVE'] },
    }).select(
      'title game map mode entryFee playersCount maxPlayers status slotType slotCode prizeBreakdown startTime roomId roomPassword'
    );

    if (!match) {
      return res.status(200).json({ match: null });
    }

    const matchData = match.toObject();

    if (match.status === 'UPCOMING') {
      matchData.roomId = null;
      matchData.roomPassword = null;
    }

    return res.status(200).json({ match: matchData });
  } catch (error) {
    logger.error('getMyCurrentMatch error', { error: error.message, userId: req.user?._id });
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  joinRandom,
  createFriendsRoom,
  joinFriendsRoom,
  getAvailableSlots,
  getMyCurrentMatch,
};
