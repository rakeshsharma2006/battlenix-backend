const mongoose = require('mongoose');
const Match = require('../models/Match');
const logger = require('../utils/logger');
const {
  serializeMatch,
  emitMatchUpdated,
  publishRoomAndGoLive,
  completeMatchResults,
} = require('../services/matchLifecycleService');

const MATCH_POPULATE = [
  { path: 'players', select: 'username' },
  { path: 'winner', select: 'username' },
  { path: 'results.userId', select: 'username' },
];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeResultEntry = (entry) => ({
  userId: String(entry.userId),
  position: Number(entry.position),
  kills: Number(entry.kills ?? 0),
});

const validateResultsPayload = (match, winner, results) => {
  if (!winner || !isValidObjectId(winner)) {
    return 'winner is required and must be a valid user id';
  }

  if (!Array.isArray(results) || results.length === 0) {
    return 'results must be a non-empty array';
  }

  const joinedUserIds = new Set(match.players.map((playerId) => playerId.toString()));
  const seenUserIds = new Set();
  const seenPositions = new Set();

  for (const rawEntry of results) {
    const entry = normalizeResultEntry(rawEntry);

    if (!isValidObjectId(entry.userId)) {
      return 'Each result entry must contain a valid userId';
    }

    if (!Number.isInteger(entry.position) || entry.position < 1) {
      return 'Each result entry must contain a valid positive integer position';
    }

    if (!Number.isInteger(entry.kills) || entry.kills < 0) {
      return 'Each result entry must contain a valid non-negative integer kills value';
    }

    if (!joinedUserIds.has(entry.userId)) {
      return 'Results can only be submitted for players who joined the match';
    }

    if (seenUserIds.has(entry.userId)) {
      return 'Duplicate userId found in results';
    }

    if (seenPositions.has(entry.position)) {
      return 'Duplicate position found in results';
    }

    seenUserIds.add(entry.userId);
    seenPositions.add(entry.position);
  }

  if (!joinedUserIds.has(String(winner))) {
    return 'Winner must be one of the players in the match';
  }

  if (!seenUserIds.has(String(winner))) {
    return 'Winner must also be present in the results array';
  }

  return null;
};

const createMatch = async (req, res) => {
  try {
    const { title, game, entryFee, maxPlayers, startTime } = req.body;

    if (!title || !game || entryFee === undefined || maxPlayers === undefined || !startTime) {
      return res.status(400).json({ message: 'title, game, entryFee, maxPlayers, and startTime are required' });
    }

    const normalizedEntryFee = Number(entryFee);
    const normalizedMaxPlayers = Number(maxPlayers);
    const normalizedStartTime = new Date(startTime);

    if (Number.isNaN(normalizedEntryFee) || normalizedEntryFee < 0) {
      return res.status(400).json({ message: 'entryFee must be a non-negative number' });
    }

    if (!Number.isInteger(normalizedMaxPlayers) || normalizedMaxPlayers < 1) {
      return res.status(400).json({ message: 'maxPlayers must be a positive integer' });
    }

    if (Number.isNaN(normalizedStartTime.getTime())) {
      return res.status(400).json({ message: 'startTime must be a valid date' });
    }

    const match = await Match.create({
      title,
      game,
      entryFee: normalizedEntryFee,
      maxPlayers: normalizedMaxPlayers,
      startTime: normalizedStartTime,
      playersCount: 0,
      status: 'UPCOMING',
    });

    logger.info('Match created', {
      matchId: match._id,
      title,
      game,
      entryFee: normalizedEntryFee,
      maxPlayers: normalizedMaxPlayers,
      startTime: normalizedStartTime.toISOString(),
      actorId: req.user._id,
    });

    emitMatchUpdated(match);
    return res.status(201).json({ message: 'Match created', match: serializeMatch(match, { includeSensitive: true }) });
  } catch (error) {
    logger.error('createMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to create match', error: error.message });
  }
};

const listMatches = async (req, res) => {
  try {
    const matches = await Match.find()
      .populate(MATCH_POPULATE)
      .sort({ startTime: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      matches: matches.map((match) => serializeMatch(match)),
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

    return res.status(200).json({ match: serializeMatch(match) });
  } catch (error) {
    logger.error('getMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch match', error: error.message });
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

    if (req.body.startTime) {
      const normalizedStartTime = new Date(req.body.startTime);
      if (Number.isNaN(normalizedStartTime.getTime())) {
        return res.status(400).json({ message: 'startTime must be a valid date' });
      }
      match.startTime = normalizedStartTime;
    }

    if (req.body.entryFee !== undefined) {
      const normalizedEntryFee = Number(req.body.entryFee);
      if (Number.isNaN(normalizedEntryFee) || normalizedEntryFee < 0) {
        return res.status(400).json({ message: 'entryFee must be a non-negative number' });
      }
      match.entryFee = normalizedEntryFee;
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
    }

    if (req.body.title !== undefined) match.title = req.body.title;
    if (req.body.game !== undefined) match.game = req.body.game;
    if (req.body.status === 'CANCELLED') match.status = 'CANCELLED';

    await match.save();

    logger.info('Match updated', {
      matchId: match._id,
      actorId: req.user._id,
      status: match.status,
    });

    emitMatchUpdated(match);
    return res.status(200).json({ message: 'Match updated', match: serializeMatch(match, { includeSensitive: true }) });
  } catch (error) {
    logger.error('updateMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to update match', error: error.message });
  }
};

const deleteMatch = async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status === 'COMPLETED') {
      return res.status(400).json({ message: 'Completed matches cannot be cancelled' });
    }

    match.status = 'CANCELLED';
    await match.save();

    logger.info('Match cancelled', { matchId: match._id, actorId: req.user._id });
    emitMatchUpdated(match);

    return res.status(200).json({ message: 'Match cancelled', match: serializeMatch(match, { includeSensitive: true }) });
  } catch (error) {
    logger.error('deleteMatch error', { error: error.message });
    return res.status(500).json({ message: 'Failed to cancel match', error: error.message });
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
    const { winner, results } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    if (match.status !== 'LIVE') {
      return res.status(400).json({ message: 'Results can only be submitted when the match is LIVE' });
    }

    const validationError = validateResultsPayload(match, winner, results);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const normalizedResults = results.map((entry) => ({
      userId: entry.userId,
      position: Number(entry.position),
      kills: Number(entry.kills ?? 0),
    }));

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

module.exports = {
  createMatch,
  listMatches,
  getMatch,
  updateMatch,
  deleteMatch,
  publishRoom,
  submitResult,
};
