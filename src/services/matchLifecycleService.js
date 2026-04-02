const Match = require('../models/Match');
const logger = require('../utils/logger');
const { emitEvent } = require('./socketService');

const toPlainMatch = (match) => {
  if (!match) return null;
  return typeof match.toObject === 'function' ? match.toObject() : { ...match };
};

const serializeMatch = (match, options = {}) => {
  const plainMatch = toPlainMatch(match);
  if (!plainMatch) return null;

  const includeSensitive = Boolean(options.includeSensitive);
  if (!includeSensitive && plainMatch.status !== 'LIVE') {
    plainMatch.roomId = null;
    plainMatch.roomPassword = null;
  }

  return plainMatch;
};

const emitMatchEvent = (eventName, match) => {
  const payload = serializeMatch(match);
  emitEvent(eventName, payload);
  emitEvent('match_updated', payload);
};

const promoteMatchToReadyIfEligible = async (matchId, meta = {}) => {
  const match = await Match.findOneAndUpdate(
    {
      _id: matchId,
      status: 'UPCOMING',
      $expr: { $gte: ['$playersCount', '$maxPlayers'] },
    },
    {
      $set: { status: 'READY' },
    },
    { new: true }
  );

  if (match) {
    logger.info('Match promoted to READY', { matchId, source: meta.source || 'system' });
    emitMatchEvent('match_ready', match);
  }

  return match;
};

const publishRoomAndGoLive = async ({ matchId, roomId, roomPassword, actorId }) => {
  const match = await Match.findOneAndUpdate(
    {
      _id: matchId,
      status: 'READY',
    },
    {
      $set: {
        roomId,
        roomPassword,
        isRoomPublished: true,
        status: 'LIVE',
      },
    },
    { new: true }
  );

  if (match) {
    logger.info('Match room published and match moved to LIVE', {
      matchId,
      actorId,
    });
    emitMatchEvent('match_live', match);
  }

  return match;
};

const completeMatchResults = async ({ matchId, winner, results, actorId }) => {
  const match = await Match.findOneAndUpdate(
    {
      _id: matchId,
      status: 'LIVE',
    },
    {
      $set: {
        winner,
        results,
        status: 'COMPLETED',
      },
    },
    { new: true }
  );

  if (match) {
    logger.info('Match completed', { matchId, actorId, winner });
    emitMatchEvent('match_completed', match);
  }

  return match;
};

const emitMatchUpdated = (match) => {
  if (!match) return;
  emitEvent('match_updated', serializeMatch(match));
};

const runLifecycleSweep = async () => {
  const now = new Date();
  const readyCandidates = await Match.find({
    status: 'UPCOMING',
    $expr: { $gte: ['$playersCount', '$maxPlayers'] },
  });

  for (const match of readyCandidates) {
    await promoteMatchToReadyIfEligible(match._id, { source: 'match-lifecycle-job' });
  }

  const liveCandidates = await Match.find({
    status: 'READY',
    isRoomPublished: true,
    startTime: { $lte: now },
  });

  for (const match of liveCandidates) {
    const liveMatch = await Match.findOneAndUpdate(
      {
        _id: match._id,
        status: 'READY',
        isRoomPublished: true,
        startTime: { $lte: now },
      },
      {
        $set: { status: 'LIVE' },
      },
      { new: true }
    );

    if (liveMatch) {
      logger.info('Match promoted to LIVE by lifecycle job', { matchId: match._id });
      emitMatchEvent('match_live', liveMatch);
    }
  }
};

module.exports = {
  serializeMatch,
  emitMatchUpdated,
  promoteMatchToReadyIfEligible,
  publishRoomAndGoLive,
  completeMatchResults,
  runLifecycleSweep,
};
