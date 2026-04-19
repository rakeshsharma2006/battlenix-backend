const mongoose = require('mongoose');
const Match = require('../models/Match');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getResolvedMatchConfig } = require('../config/prizeConfig');

const ACTIVE_MATCH_STATUSES = ['UPCOMING', 'READY', 'LIVE'];

const generateSlotCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

const normalizeObjectId = (value) => (
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value)
);

const TEAM_SIZE_BY_MODE = {
  Solo: 1,
  Duo: 2,
  Squad: 4,
};

const acquireUserMatchLock = async ({ userId, session }) => {
  const user = await User.findOneAndUpdate(
    { _id: userId },
    { $currentDate: { updatedAt: true } },
    { session, new: false, select: '_id' }
  );

  if (!user) {
    throw new Error('User not found');
  }
};

const buildPlayerAssignment = ({ userId, playersCount, mode }) => {
  const teamSize = TEAM_SIZE_BY_MODE[mode] || 1;

  return {
    userId,
    teamId: Math.floor(playersCount / teamSize) + 1,
    slot: (playersCount % teamSize) + 1,
  };
};

const ensureUserNotInActiveMatch = async ({ userId, session, excludeMatchId = null }) => {
  const query = {
    players: userId,
    status: { $in: ACTIVE_MATCH_STATUSES },
  };

  if (excludeMatchId) {
    query._id = { $ne: excludeMatchId };
  }

  const alreadyIn = await Match.findOne(query).session(session).lean();
  if (alreadyIn) {
    throw new Error('You are already in an active match');
  }
};

const joinRandomSlot = async ({ userId, game, map, mode, entryFee, session }) => {
  const normalizedUserId = normalizeObjectId(userId);
  const matchConfig = getResolvedMatchConfig({ game, map, mode, entryFee });

  await acquireUserMatchLock({ userId: normalizedUserId, session });
  await ensureUserNotInActiveMatch({ userId: normalizedUserId, session });

  let match = await Match.findOne({
    game: matchConfig.game,
    map: matchConfig.map,
    mode: matchConfig.mode,
    entryFee: matchConfig.entryFee,
    status: 'UPCOMING',
    slotType: 'RANDOM',
    isAutoCreated: true,
    $expr: { $lt: ['$playersCount', '$maxPlayers'] },
  })
    .sort({ createdAt: 1 })
    .session(session);

  if (!match) {
    match = await Match.create([{
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
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      players: [],
      playersCount: 0,
    }], { session });
    match = match[0];
  }

  if (!Array.isArray(match.playerAssignments)) {
    match.playerAssignments = [];
  }

  match.players.push(normalizedUserId);
  match.playerAssignments.push(buildPlayerAssignment({
    userId: normalizedUserId,
    playersCount: match.playersCount,
    mode: match.mode,
  }));
  match.playersCount = match.players.length;
  match.status = match.playersCount === match.maxPlayers ? 'READY' : 'UPCOMING';

  await match.save({ session });

  logger.info('User joined random slot', {
    userId: normalizedUserId,
    matchId: match._id,
    game: matchConfig.game,
    map: matchConfig.map,
    mode: matchConfig.mode,
    entryFee: matchConfig.entryFee,
    playersCount: match.playersCount,
    maxPlayers: match.maxPlayers,
  });

  return match;
};

const createFriendsSlot = async ({ userId, game, map, mode, entryFee, session }) => {
  const normalizedUserId = normalizeObjectId(userId);
  const matchConfig = getResolvedMatchConfig({ game, map, mode, entryFee });

  await acquireUserMatchLock({ userId: normalizedUserId, session });
  await ensureUserNotInActiveMatch({ userId: normalizedUserId, session });

  let attempts = 0;
  let match = null;
  let slotCode = null;

  while (attempts < 10 && !match) {
    attempts += 1;
    slotCode = generateSlotCode();

    try {
      match = await Match.create([{
        title: `${matchConfig.map} ${matchConfig.mode} Rs ${matchConfig.entryFee} [Friends]`,
        game: matchConfig.game,
        map: matchConfig.map,
        mode: matchConfig.mode,
        entryFee: matchConfig.entryFee,
        maxPlayers: matchConfig.maxPlayers,
        prizeBreakdown: matchConfig.prizeBreakdown,
        slotType: 'FRIENDS',
        slotCode,
        isAutoCreated: true,
        status: 'UPCOMING',
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        players: [normalizedUserId],
        playerAssignments: [buildPlayerAssignment({
          userId: normalizedUserId,
          playersCount: 0,
          mode: matchConfig.mode,
        })],
        playersCount: 1,
      }], { session });
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.slotCode) {
        match = null;
        continue;
      }

      throw error;
    }
  }

  if (!match) {
    throw new Error('Could not generate unique slot code. Try again.');
  }

  logger.info('Friends slot created', {
    userId: normalizedUserId,
    matchId: match[0]._id,
    game: matchConfig.game,
    slotCode,
    map: matchConfig.map,
    mode: matchConfig.mode,
    entryFee: matchConfig.entryFee,
  });

  return match[0];
};

const joinFriendsSlot = async ({ userId, slotCode, session }) => {
  const normalizedUserId = normalizeObjectId(userId);

  const match = await Match.findOne({
    slotCode: slotCode.toUpperCase(),
    status: 'UPCOMING',
    slotType: 'FRIENDS',
  }).session(session);

  if (!match) {
    throw new Error('Invalid or expired slot code');
  }

  await acquireUserMatchLock({ userId: normalizedUserId, session });
  await ensureUserNotInActiveMatch({
    userId: normalizedUserId,
    session,
    excludeMatchId: match._id,
  });

  if (match.playersCount >= match.maxPlayers) {
    throw new Error('This slot is full');
  }

  if (match.players.map((playerId) => playerId.toString()).includes(normalizedUserId.toString())) {
    throw new Error('You are already in this slot');
  }

  if (!Array.isArray(match.playerAssignments)) {
    match.playerAssignments = [];
  }

  match.players.push(normalizedUserId);
  match.playerAssignments.push(buildPlayerAssignment({
    userId: normalizedUserId,
    playersCount: match.playersCount,
    mode: match.mode,
  }));
  match.playersCount = match.players.length;
  match.status = match.playersCount === match.maxPlayers ? 'READY' : 'UPCOMING';

  await match.save({ session });

  logger.info('User joined friends slot', {
    userId: normalizedUserId,
    matchId: match._id,
    slotCode: match.slotCode,
    playersCount: match.playersCount,
    maxPlayers: match.maxPlayers,
  });

  return match;
};

module.exports = {
  joinRandomSlot,
  createFriendsSlot,
  joinFriendsSlot,
};
