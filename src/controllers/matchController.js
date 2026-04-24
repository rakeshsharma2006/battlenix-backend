const mongoose = require('mongoose');
const Match = require('../models/Match');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');
const { emitToUser } = require('../services/socketService');
const { cancelMatchAndRefund } = require('../services/matchCancellationService');
const {
  serializeMatch,
  emitMatchEvent,
  emitMatchUpdated,
  publishRoomAndGoLive,
  completeMatchResults,
  getCapacityDrivenStatus,
} = require('../services/matchLifecycleService');
const {
  calculatePrize,
  getResolvedMatchConfig,
  resolveGameAndMap,
  VALID_FEES,
} = require('../config/prizeConfig');

const MATCH_POPULATE = [
  { path: 'players', select: 'username email gameUID gameName upiId trustScore avatar' },
  { path: 'winner', select: 'username email gameUID gameName upiId trustScore avatar' },
  { path: 'results.userId', select: 'username email gameUID gameName upiId trustScore avatar' },
  { path: 'createdBy', select: 'username' },
];

const TEAM_SIZE_BY_MODE = {
  Solo: 1,
  Duo: 2,
  Squad: 4,
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeResultEntry = (entry) => ({
  userId: String(entry.userId),
  position: Number(entry.position),
  kills: Number(entry.kills ?? 0),
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildMatchFilter = (query = {}) => {
  const filter = {};

  if (query.status) {
    filter.status = query.status;
  }

  if (query.game) {
    filter.game = query.game;
  }

  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { title: regex },
      { map: regex },
      { mode: regex },
      { game: regex },
    ];
  }

  return filter;
};

const buildMatchPlayers = (match) => {
  const teamSize = TEAM_SIZE_BY_MODE[match.mode] || 1;
  const players = Array.isArray(match.players) ? match.players : [];
  const playerByUserId = new Map(
    players.map((player) => [String(player._id || player), player])
  );

  const assignments = Array.isArray(match.playerAssignments) && match.playerAssignments.length > 0
    ? match.playerAssignments
    : players.map((player, index) => ({
      userId: player,
      teamId: Math.floor(index / teamSize) + 1,
      slot: (index % teamSize) + 1,
    }));

  return assignments.map((assignment) => {
    const resolvedUserId = String(assignment.userId?._id || assignment.userId);
    const playerObj = assignment.userId?._id ? assignment.userId : (playerByUserId.get(resolvedUserId) || {});

    return {
      _id: resolvedUserId,
      userId: resolvedUserId,
      username: playerObj.username || null,
      gameUID: playerObj.gameUID || null,
      gameName: playerObj.gameName || null,
      upiId: playerObj.upiId || null,
      trustScore: playerObj.trustScore !== undefined ? playerObj.trustScore : 100,
      avatar: playerObj.avatar || null,
      email: playerObj.email || null,
      teamId: Number(assignment.teamId) || 1,
      slot: Number(assignment.slot) || 1,
    };
  });
};

const getDefaultUserJoinStatus = () => ({
  joined: false,
  paymentStatus: null,
  paymentId: null,
  paidAt: null,
});

const hasJoinedPlayersArray = (players, userId) => {
  if (!userId || !Array.isArray(players)) {
    return false;
  }

  return players.some((player) => String(player?._id || player) === String(userId));
};

const buildUserJoinStatus = ({ players, userId, payment = null }) => ({
  joined: hasJoinedPlayersArray(players, userId) || payment?.status === 'SUCCESS',
  paymentStatus: payment?.status || null,
  paymentId: payment?._id || null,
  paidAt: payment?.createdAt || null,
});

const getPreferredPayment = (payments = []) => (
  payments.find((payment) => payment.status === 'SUCCESS') || payments[0] || null
);

const validateResultsPayload = (match, winner, results) => {
  if (!winner || !isValidObjectId(winner)) {
    const err = new Error('winner is required and must be a valid user id');
    err.name = 'ValidationError';
    throw err;
  }

  if (!Array.isArray(results) || results.length === 0) {
    const err = new Error('results must be a non-empty array');
    err.name = 'ValidationError';
    throw err;
  }

  const joinedUserIds = new Set(match.players.map((playerId) => playerId.toString()));
  const seenUserIds = new Set();
  const seenPositions = new Set();

  for (const rawEntry of results) {
    const entry = normalizeResultEntry(rawEntry);

    if (!isValidObjectId(entry.userId)) {
      const err = new Error('Each result entry must contain a valid userId');
      err.name = 'ValidationError';
      throw err;
    }

    if (!Number.isInteger(entry.position) || entry.position < 1 || entry.position > match.maxPlayers) {
      const err = new Error(`Each result entry must contain a valid positive integer position (max ${match.maxPlayers})`);
      err.name = 'ValidationError';
      throw err;
    }

    const maxKills = Math.max(0, match.maxPlayers - 1);
    if (!Number.isInteger(entry.kills) || entry.kills < 0 || entry.kills > maxKills) {
      const err = new Error(`Each result entry must contain a valid kills value (max ${maxKills})`);
      err.name = 'ValidationError';
      throw err;
    }

    if (!joinedUserIds.has(entry.userId)) {
      const err = new Error('Results can only be submitted for players who joined the match');
      err.name = 'ValidationError';
      throw err;
    }

    if (seenUserIds.has(entry.userId)) {
      const err = new Error('Duplicate userId found in results');
      err.name = 'ValidationError';
      throw err;
    }

    if (seenPositions.has(entry.position)) {
      const err = new Error('Duplicate position found in results');
      err.name = 'ValidationError';
      throw err;
    }

    seenUserIds.add(entry.userId);
    seenPositions.add(entry.position);
  }

  if (!joinedUserIds.has(String(winner))) {
    const err = new Error('Winner must be one of the players in the match');
    err.name = 'ValidationError';
    throw err;
  }

  if (!seenUserIds.has(String(winner))) {
    const err = new Error('Winner must also be present in the results array');
    err.name = 'ValidationError';
    throw err;
  }
};

const emitMatchChange = (match, previousStatus, options = {}) => {
  if (match.status === 'READY' && previousStatus !== 'READY') {
    emitMatchEvent('match_ready', match, options);
    return;
  }

  if (match.status === 'LIVE' && previousStatus !== 'LIVE') {
    emitMatchEvent('match_live', match, options);
    return;
  }

  emitMatchUpdated(match, options);
};

const createMatch = async (req, res) => {
  try {
    const { startTime, title, entryType = 'PAID', customPrize, maxPlayers, entryFee = 0, game, map, mode, chatEnabled = true } = req.body;
    
    const resolved = resolveGameAndMap(game, map);

    const normalizedStartTime = new Date(startTime);
    if (Number.isNaN(normalizedStartTime.getTime())) {
      return res.status(400).json({ message: 'startTime must be a valid date' });
    }

    let finalPrizeBreakdown;
    if (entryType === 'FREE') {
      const totalPrize = customPrize || 0;
      finalPrizeBreakdown = {
        playerPrize: totalPrize,
        managerCut: 0,
        adminCut: 0,
        teamSize: TEAM_SIZE_BY_MODE[mode],
        prizePerMember: Math.floor(totalPrize / TEAM_SIZE_BY_MODE[mode])
      };
    } else {
      const totalCollection = entryFee * maxPlayers;
      if (customPrize !== undefined && customPrize !== null) {
        finalPrizeBreakdown = {
          playerPrize: customPrize,
          managerCut: Math.floor((totalCollection - customPrize) * 0.4),
          adminCut: Math.floor((totalCollection - customPrize) * 0.6),
          teamSize: TEAM_SIZE_BY_MODE[mode],
          prizePerMember: Math.floor(customPrize / TEAM_SIZE_BY_MODE[mode])
        };
      } else {
        finalPrizeBreakdown = calculatePrize(entryFee, maxPlayers, mode);
      }
    }

    const autoTitle = title || `${resolved.map} ${mode} ${entryType === 'FREE' ? 'FREE' : 'Rs ' + entryFee}`;

    const match = await Match.create({
      title: autoTitle,
      game: resolved.game,
      map: resolved.map,
      mode: mode,
      entryType,
      entryFee,
      customPrize,
      chatEnabled,
      maxPlayers,
      startTime: normalizedStartTime,
      prizeBreakdown: finalPrizeBreakdown,
      createdBy: req.user._id,
      playersCount: 0,
      status: 'UPCOMING',
    });

    logger.info('Match created', {
      matchId: match._id,
      title: autoTitle,
      game: resolved.game,
      map: resolved.map,
      mode: mode,
      entryFee,
      maxPlayers,
      startTime: normalizedStartTime.toISOString(),
      actorId: req.user._id,
    });

    emitMatchUpdated(match, { includeSensitive: true });
    return res.status(201).json({ message: 'Match created', match: serializeMatch(match, { includeSensitive: true }) });
  } catch (error) {
    logger.error('createMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to create match', error: error.message });
  }
};

const listMatches = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const matches = await Match.find(buildMatchFilter(req.query))
      .populate(MATCH_POPULATE)
      .sort({ startTime: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const userId = req.user?._id || null;
    const paymentByMatchId = new Map();

    if (userId && matches.length > 0) {
      const userPayments = await Payment.find({
        userId,
        matchId: { $in: matches.map((match) => match._id) },
        status: { $in: ['SUCCESS', 'PENDING'] },
      })
        .select('matchId status createdAt')
        .sort({ createdAt: -1 })
        .lean();

      for (const payment of userPayments) {
        const matchId = String(payment.matchId);
        const existingPayment = paymentByMatchId.get(matchId);
        paymentByMatchId.set(matchId, getPreferredPayment([existingPayment, payment].filter(Boolean)));
      }
    }

    const matchesWithStatus = matches.map((match) => {
      const userJoinStatus = userId
        ? buildUserJoinStatus({
            players: match.players,
            userId,
            payment: paymentByMatchId.get(String(match._id)) || null,
          })
        : getDefaultUserJoinStatus();

      return {
        ...serializeMatch(match),
        isJoined: userJoinStatus.joined,
        userJoinStatus,
      };
    });

    return res.status(200).json({
      matches: matchesWithStatus,
      page,
      limit,
    });
  } catch (error) {
    logger.error('listMatches error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch matches', error: error.message });
  }
};

const getMatch = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id).populate(MATCH_POPULATE).lean();
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    let userJoinStatus = getDefaultUserJoinStatus();
    if (req.user?._id) {
      const payments = await Payment.find({
        userId: req.user._id,
        matchId: match._id,
        status: { $in: ['SUCCESS', 'PENDING'] },
      })
        .select('status amount createdAt')
        .sort({ createdAt: -1 })
        .lean();

      userJoinStatus = buildUserJoinStatus({
        players: match.players,
        userId: req.user._id,
        payment: getPreferredPayment(payments),
      });
    }

    return res.status(200).json({
      match: {
        ...serializeMatch(match),
        isJoined: userJoinStatus.joined,
        userJoinStatus,
      },
    });
  } catch (error) {
    logger.error('getMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch match', error: error.message });
  }
};

const getJoinStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const match = await Match.findById(id).select('players status');
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    const isInPlayers = match.players.some((player) => (
      player.toString() === userId.toString()
    ));

    const payment = await Payment.findOne({
      userId,
      matchId: id,
      status: 'SUCCESS',
    })
      .select('status createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const joined = isInPlayers || payment !== null;

    logger.info('Join status checked', {
      userId,
      matchId: id,
      joined,
    });

    return res.status(200).json({
      joined,
      paymentStatus: payment?.status || null,
      paymentId: payment?._id || null,
      paidAt: payment?.createdAt || null,
      matchStatus: match.status,
    });
  } catch (error) {
    logger.error('getJoinStatus error', { error: error.message });
    return res.status(500).json({ message: 'Failed to check status' });
  }
};

const getMatchRoom = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .select('title status roomId roomPassword players');

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    const isParticipant = match.players.some((playerId) => (
      playerId.toString() === req.user._id.toString()
    ));

    if (!isAdmin && !isParticipant) {
      return res.status(403).json({ message: 'Forbidden: Room details are only available to joined players or admins' });
    }

    if (!match.roomId || !match.roomPassword) {
      return res.status(400).json({ message: 'Room details are not available yet' });
    }

    return res.status(200).json({
      matchId: match._id,
      title: match.title,
      status: match.status,
      roomId: match.roomId,
      roomPassword: match.roomPassword,
    });
  } catch (error) {
    logger.error('getMatchRoom error', { error: error.message, matchId: req.params.id, actorId: req.user?._id });
    return res.status(500).json({ message: 'Failed to fetch room details', error: error.message });
  }
};

const getMatchPlayers = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id)
      .populate({ path: 'players', select: 'username email gameUID gameName upiId trustScore avatar' })
      .populate({ path: 'playerAssignments.userId', select: 'username email gameUID gameName upiId trustScore avatar' })
      .select('mode players playerAssignments');

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    return res.status(200).json({
      players: buildMatchPlayers(match),
    });
  } catch (error) {
    logger.error('getMatchPlayers error', { error: error.message, matchId: req.params.id });
    return res.status(500).json({ message: 'Failed to fetch match players', error: error.message });
  }
};

const updateMatch = async (req, res) => {
  try {
    const allowedFields = ['title', 'game', 'entryFee', 'maxPlayers', 'startTime', 'status'];
    const requestedFields = Object.keys(req.body);
    const disallowedFields = requestedFields.filter((field) => !allowedFields.includes(field));

    if (disallowedFields.length > 0) {
      return res.status(400).json({
        message: `These fields cannot be updated here: ${disallowedFields.join(', ')}`,
      });
    }

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status === 'COMPLETED') {
      return res.status(400).json({ message: 'Completed matches cannot be updated' });
    }

    if (req.body.status && req.body.status !== 'CANCELLED') {
      return res.status(400).json({ message: 'Only status=CANCELLED is allowed via update route' });
    }

    const previousStatus = match.status;
    let shouldRecalculatePrize = false;

    if (req.body.startTime) {
      const normalizedStartTime = new Date(req.body.startTime);
      if (Number.isNaN(normalizedStartTime.getTime())) {
        return res.status(400).json({ message: 'startTime must be a valid date' });
      }
      match.startTime = normalizedStartTime;
    }

    if (req.body.entryFee !== undefined) {
      const normalizedEntryFee = Number(req.body.entryFee);
      if (!VALID_FEES.includes(normalizedEntryFee)) {
        return res.status(400).json({ message: `entryFee must be one of: ${VALID_FEES.join(', ')}` });
      }
      match.entryFee = normalizedEntryFee;
      shouldRecalculatePrize = true;
    }

    if (req.body.maxPlayers !== undefined) {
      const normalizedMaxPlayers = Number(req.body.maxPlayers);
      if (!Number.isInteger(normalizedMaxPlayers) || normalizedMaxPlayers < 1) {
        return res.status(400).json({ message: 'maxPlayers must be a positive integer' });
      }
      if (normalizedMaxPlayers < match.playersCount) {
        return res.status(400).json({ message: 'maxPlayers cannot be lower than playersCount' });
      }
      match.maxPlayers = normalizedMaxPlayers;
      shouldRecalculatePrize = true;
    }

    if (req.body.game !== undefined) {
      try {
        const resolved = resolveGameAndMap(req.body.game, match.map);
        match.game = resolved.game;
      } catch (error) {
        return res.status(400).json({ message: error.message });
      }
    }

    if (req.body.title !== undefined) match.title = req.body.title;

    if (shouldRecalculatePrize) {
      match.prizeBreakdown = calculatePrize(match.entryFee, match.maxPlayers, match.mode);
      if (!['LIVE', 'COMPLETED', 'CANCELLED'].includes(match.status)) {
        match.status = getCapacityDrivenStatus(match);
      }
    }

    if (req.body.status === 'CANCELLED') {
      await match.save();

      const cancelled = await cancelMatchAndRefund(match._id, {
        actorId: req.user._id,
        reason: 'Match cancelled by admin update',
        refundReason: 'Match cancelled',
        includeSensitive: true,
      });

      logger.info('Match cancelled via update route', {
        matchId: match._id,
        actorId: req.user._id,
      });

      return res.status(200).json({
        message: 'Match updated',
        match: serializeMatch(cancelled.match, { includeSensitive: true }),
      });
    }

    await match.save();

    logger.info('Match updated', {
      matchId: match._id,
      actorId: req.user._id,
      status: match.status,
    });

    emitMatchChange(match, previousStatus, { includeSensitive: true });
    return res.status(200).json({ message: 'Match updated', match: serializeMatch(match, { includeSensitive: true }) });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    logger.error('updateMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to update match', error: error.message });
  }
};

const setMatchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const match = await Match.findById(req.params.id);

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status === 'COMPLETED') {
      return res.status(400).json({ message: 'Completed matches cannot change status' });
    }

    if (status === 'READY' && match.status !== 'UPCOMING') {
      return res.status(400).json({ message: 'Match must be UPCOMING to mark as READY' });
    }
    
    if (status === 'UPCOMING' && match.playersCount === match.maxPlayers) {
      return res.status(400).json({ message: 'Full matches must remain READY until they go LIVE or are cancelled' });
    }

    if (status === 'LIVE' && (!match.roomId || !match.roomPassword)) {
      return res.status(400).json({ message: 'LIVE requires roomId and roomPassword to be set first' });
    }

    if (status === 'CANCELLED') {
      const cancelled = await cancelMatchAndRefund(match._id, {
        actorId: req.user._id,
        reason: 'Match cancelled by admin status change',
        refundReason: 'Match cancelled',
        includeSensitive: true,
      });

      return res.status(200).json({
        message: 'Match status updated',
        match: serializeMatch(cancelled.match, { includeSensitive: true }),
      });
    }

    const previousStatus = match.status;
    match.status = status;
    if (status === 'LIVE') {
      match.isRoomPublished = true;
      match.liveAt = new Date();
    }

    await match.save();

    emitMatchChange(match, previousStatus, { includeSensitive: true });

    return res.status(200).json({
      message: 'Match status updated',
      match: serializeMatch(match, { includeSensitive: true }),
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    logger.error('setMatchStatus error', { error: error.message, matchId: req.params.id });
    return res.status(500).json({ message: 'Failed to update match status', error: error.message });
  }
};

const deleteMatch = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }
    
    if (match.status !== 'COMPLETED' && match.status !== 'CANCELLED') {
      return res.status(400).json({ message: 'Can only delete COMPLETED or CANCELLED matches' });
    }

    const Chat = require('../models/Chat');
    const Payment = require('../models/Payment');

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Chat.deleteMany({ matchId: req.params.id }, { session });
        await Payment.updateMany(
          { matchId: req.params.id },
          { $set: { archived: true } },
          { session }
        );
        const deleted = await Match.findByIdAndDelete(req.params.id, { session });
        if (!deleted) {
          throw Object.assign(new Error('Match not found'), { statusCode: 404 });
        }
      });
    } finally {
      await session.endSession();
    }

    logger.info('Match deleted', {
      matchId: req.params.id,
      deletedBy: req.user._id,
    });

    return res.status(200).json({
      message: 'Match deleted successfully',
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    logger.error('deleteMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to delete match', error: error.message });
  }
};

const publishRoom = async (req, res) => {
  try {
    const { roomId, roomPassword } = req.body;

    if (!roomId || !roomPassword) {
      return res.status(400).json({ message: 'roomId and roomPassword are required' });
    }

    const match = await publishRoomAndGoLive({
      matchId: req.params.id,
      roomId,
      roomPassword,
      actorId: req.user._id,
    });

    if (!match) {
      return res.status(400).json({ message: 'Room can only be published when the match status is READY' });
    }

    match.players.forEach((playerId) => {
      emitToUser(String(playerId), 'room_published', {
        matchId: match._id,
        title: match.title,
        roomId: match.roomId,
        roomPassword: match.roomPassword,
        message: 'Room is ready! Join now.',
      });
    });

    logger.info('Room published and players notified', {
      matchId: match._id,
      playerCount: match.players.length,
    });

    return res.status(200).json({
      message: 'Room published and match moved to LIVE',
      match: serializeMatch(match, { includeSensitive: true }),
    });
  } catch (error) {
    logger.error('publishRoom error', { error: error.message });
    return res.status(500).json({ message: 'Failed to publish room', error: error.message });
  }
};

const submitResult = async (req, res) => {
  try {
    const { winner, results, winnerTeam } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status !== 'LIVE') {
      return res.status(400).json({ message: 'Results can only be submitted when the match is LIVE' });
    }

    if (winnerTeam && winnerTeam.length > 0) {
      const expectedSize = { Solo: 1, Duo: 2, Squad: 4 };
      const required = expectedSize[match.mode];
      if (required && winnerTeam.length !== required) {
        return res.status(400).json({
          message: `winnerTeam must have exactly ${required} player(s) for ${match.mode} mode`,
        });
      }

      const playerIds = match.players.map((playerId) => playerId.toString());
      const allValid = winnerTeam.every((id) => playerIds.includes(id.toString()));
      if (!allValid) {
        return res.status(400).json({
          message: 'All winnerTeam members must be participants of this match',
        });
      }
    }

    try {
      validateResultsPayload(match, winner, results);
    } catch (err) {
      if (err.name === 'ValidationError') {
        logger.warn('Match results validation failed', { matchId: req.params.id, validationError: err.message });
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    const normalizedResults = results.map((entry) => ({
      userId: entry.userId,
      position: Number(entry.position),
      kills: Number(entry.kills ?? 0),
    }));

    if (winnerTeam && Array.isArray(winnerTeam) && winnerTeam.length > 0) {
      match.winnerTeam = winnerTeam;
      await match.save();
    }

    const completedMatch = await completeMatchResults({
      matchId: req.params.id,
      winner,
      results: normalizedResults,
      actorId: req.user._id,
    });

    if (!completedMatch) {
      return res.status(400).json({ message: 'Results can only be submitted when the match is LIVE' });
    }

    const populatedMatch = await Match.findById(completedMatch._id).populate(MATCH_POPULATE);
    return res.status(200).json({
      message: 'Match results submitted successfully',
      match: serializeMatch(populatedMatch, { includeSensitive: true }),
    });
  } catch (error) {
    logger.error('submitResult error', { error: error.message });
    return res.status(500).json({ message: 'Failed to submit results', error: error.message });
  }
};

const toggleChat = async (req, res) => {
  try {
    const { enabled } = req.body;
    const match = await Match.findById(req.params.id);
    
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }
    
    match.chatEnabled = enabled;
    await match.save();
    
    const { emitEvent } = require('../services/socketService');
    emitEvent(`match_${match._id}`, {
      action: 'chat_toggled',
      matchId: match._id,
      chatEnabled: enabled,
      message: enabled ? 'Chat has been enabled' : 'Chat has been disabled by admin'
    });
    
    return res.status(200).json({
      message: enabled ? 'Chat enabled' : 'Chat disabled',
      chatEnabled: match.chatEnabled,
    });
  } catch (error) {
    logger.error('toggleChat error', { error: error.message });
    return res.status(500).json({ message: 'Failed to toggle chat' });
  }
};

const joinFreeMatch = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const match = await Match.findById(id);

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.entryFee > 0) {
      return res.status(400).json({
        message: 'This match requires payment. Use the payment flow.',
      });
    }

    if (match.status !== 'UPCOMING') {
      return res.status(400).json({
        message: 'Match is not open for joining',
      });
    }

    const alreadyJoined = match.players.some(
      (player) => player.toString() === userId.toString()
    );
    if (alreadyJoined) {
      return res.status(409).json({
        message: 'You have already joined this match',
      });
    }

    if (match.playersCount >= match.maxPlayers) {
      return res.status(400).json({ message: 'Match is full' });
    }

    match.players.push(userId);
    match.playersCount += 1;

    if (match.playersCount >= match.maxPlayers) {
      match.status = 'READY';
    }

    await match.save();

    return res.status(200).json({
      message: 'Successfully joined match!',
      match: {
        _id: match._id,
        title: match.title,
        status: match.status,
        playersCount: match.playersCount,
      },
    });
  } catch (error) {
    console.error('joinFreeMatch error:', error);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
};

module.exports = {
  createMatch,
  listMatches,
  getMatch,
  getJoinStatus,
  getMatchRoom,
  getMatchPlayers,
  updateMatch,
  setMatchStatus,
  deleteMatch,
  publishRoom,
  submitResult,
  toggleChat,
  joinFreeMatch,
};
