const Match = require('../models/Match');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { emitEvent } = require('./socketService');
const { applyMatchResultsToLeaderboard, emitLeaderboardUpdate } = require('./leaderboardService');
const {
  evaluateMatchResult,
  applyFraudAssessment,
  summarizeFraudAssessment,
} = require('./fraudDetectionService');

const toPlainMatch = (match) => {
  if (!match) return null;
  return typeof match.toObject === 'function' ? match.toObject() : { ...match };
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getObjectId = (value) => {
  if (!value) return '';

  if (value._id) {
    return String(value._id);
  }

  return String(value);
};

const getUsername = (value) => {
  if (!value) return null;

  if (value.username) {
    return value.username;
  }

  if (value.userId?.username) {
    return value.userId.username;
  }

  return null;
};

const buildMatchResult = (plainMatch) => {
  if (!plainMatch || plainMatch.status !== 'COMPLETED') {
    return null;
  }

  const winnerId = getObjectId(plainMatch.winner);
  const results = Array.isArray(plainMatch.results) ? plainMatch.results : [];
  const winnerEntry =
    results.find((entry) => getObjectId(entry.userId) === winnerId) ||
    results[0] ||
    null;

  if (!winnerId && !winnerEntry) {
    return null;
  }

  const prizeBreakdown = plainMatch.prizeBreakdown || {};
  const prize =
    toNumber(plainMatch.prizeAmount) ||
    toNumber(prizeBreakdown.prizePerMember) ||
    toNumber(prizeBreakdown.playerPrize);

  return {
    winnerId: winnerId || getObjectId(winnerEntry?.userId),
    winnerUsername: getUsername(plainMatch.winner) || getUsername(winnerEntry),
    kills: toNumber(winnerEntry?.kills),
    placement: toNumber(winnerEntry?.position) || 1,
    prize,
  };
};

const serializeMatch = (match, options = {}) => {
  const plainMatch = toPlainMatch(match);
  if (!plainMatch) return null;

  const includeSensitive = Boolean(options.includeSensitive);
  plainMatch.slotCode = plainMatch.slotCode ?? null;
  if (!includeSensitive) {
    plainMatch.roomId = null;
    plainMatch.roomPassword = null;
  }
  plainMatch.result = buildMatchResult(plainMatch);

  return plainMatch;
};

const buildMatchEventPayload = (eventName, matchOrPatch, options = {}) => {
  const type = options.type || 'FULL';
  const data = type === 'FULL'
    ? serializeMatch(matchOrPatch)
    : { ...matchOrPatch };
  const matchId = String(
    options.matchId ||
    data?.matchId ||
    data?._id ||
    matchOrPatch?.matchId ||
    matchOrPatch?._id
  );

  if (!matchId) {
    throw new Error(`Cannot emit ${eventName} without a match id`);
  }

  return {
    type,
    matchId,
    data,
  };
};

const emitMatchSocketEvent = (eventName, matchOrPatch, options = {}) => {
  emitEvent(eventName, buildMatchEventPayload(eventName, matchOrPatch, options));
};

const emitMatchUpdated = (matchOrPatch, options = {}) => {
  if (!matchOrPatch) return;

  emitMatchSocketEvent('match_updated', matchOrPatch, {
    type: options.type || 'FULL',
    includeSensitive: options.includeSensitive,
    matchId: options.matchId,
  });
};

const emitMatchEvent = (eventName, match, options = {}) => {
  emitMatchSocketEvent(eventName, match, {
    type: options.type || 'FULL',
    includeSensitive: options.includeSensitive,
  });
  emitMatchUpdated(match, {
    type: options.type || 'FULL',
    includeSensitive: options.includeSensitive,
  });
};

const getCapacityDrivenStatus = (match) => (
  Number(match.playersCount) === Number(match.maxPlayers) ? 'READY' : 'UPCOMING'
);

const syncCapacityDrivenStatus = async (match, options = {}) => {
  if (!match || ['LIVE', 'COMPLETED', 'CANCELLED'].includes(match.status)) {
    return match;
  }

  const nextStatus = getCapacityDrivenStatus(match);
  if (match.status === nextStatus) {
    return match;
  }

  match.status = nextStatus;

  if (options.save !== false && typeof match.save === 'function') {
    await match.save(options.session ? { session: options.session } : undefined);
  }

  logger.info('Match status synchronized from capacity', {
    matchId: match._id,
    status: nextStatus,
    source: options.source || 'system',
  });

  if (options.emit !== false) {
    if (nextStatus === 'READY') {
      emitMatchEvent('match_ready', match);
    } else {
      emitMatchUpdated(match);
    }
  }

  return match;
};

const promoteMatchToReadyIfEligible = async (matchId, meta = {}) => {
  const match = await Match.findOneAndUpdate(
    {
      _id: matchId,
      status: 'UPCOMING',
      $expr: { $eq: ['$playersCount', '$maxPlayers'] },
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
        liveAt: new Date(),
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
  const session = await mongoose.startSession();
  let completedMatch = null;
  let leaderboardEntries = [];
  let fraudAssessment = null;
  let fraudUsers = [];

  try {
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      try {
        await session.withTransaction(async () => {
          fraudAssessment = null;
          fraudUsers = [];

          const match = await Match.findOne({
            _id: matchId,
            status: 'LIVE',
          }).session(session);

          if (!match) {
            return;
          }

          fraudAssessment = await evaluateMatchResult(match, results, { winner, session });

          if (fraudAssessment.users.length > 0) {
            fraudUsers = await applyFraudAssessment({ assessment: fraudAssessment, session });
          }

          match.winner = winner;
          match.results = results;
          match.status = 'COMPLETED';
          await match.save({ session });

          completedMatch = match.toObject();
          leaderboardEntries = await applyMatchResultsToLeaderboard({
            session,
            matchId: match._id,
            results,
            winner,
            matchCompletedAt: match.updatedAt || new Date(),
          });
        });
        break;
      } catch (error) {
        if (error.name === 'ValidationError' || error.code === 11000) {
          throw error;
        }
        if (attempts < 3 && error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError')) {
          logger.warn('Transient transaction error', { matchId, attempts });
          continue;
        }
        throw error;
      }
    }
  } finally {
    await session.endSession();
  }

  if (completedMatch) {
    logger.info('Match completed', { matchId, actorId, winner });
    if (fraudAssessment?.users?.length) {
      logger.warn('Fraud detection flagged suspicious match results', {
        matchId,
        actorId,
        winner,
        affectedUsers: summarizeFraudAssessment(fraudAssessment, fraudUsers),
      });
    }
    emitLeaderboardUpdate({
      scope: 'match_result',
      matchId: completedMatch._id,
      leaderboard: leaderboardEntries,
    });
    emitMatchEvent('match_completed', completedMatch);
  }

  return completedMatch;
};

const runLifecycleSweep = async () => {
  const now = new Date();
  const readyCandidates = await Match.find({
    status: 'UPCOMING',
    $expr: { $eq: ['$playersCount', '$maxPlayers'] },
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
        $set: {
          status: 'LIVE',
          liveAt: now,
        },
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
  buildMatchEventPayload,
  emitMatchSocketEvent,
  emitMatchUpdated,
  emitMatchEvent,
  getCapacityDrivenStatus,
  syncCapacityDrivenStatus,
  promoteMatchToReadyIfEligible,
  publishRoomAndGoLive,
  completeMatchResults,
  runLifecycleSweep,
};
