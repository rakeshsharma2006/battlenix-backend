const mongoose = require('mongoose');
const Match = require('../models/Match');
const MatchResult = require('../models/MatchResult');
const User = require('../models/User');

const MAX_RECENT_RESULTS = 10;
const MIN_MATCHES_FOR_SPIKE_CHECK = 5;
const KILL_SPIKE_MULTIPLIER = 3;
const MIN_KILLS_FOR_SPIKE_FLAG = 6;
const REPEATED_WINNER_THRESHOLD = 8;
const MIN_MATCH_DURATION_MS = 60 * 1000;
const MAX_MATCH_DURATION_MS = 8 * 60 * 60 * 1000;
const FLAG_TRUST_THRESHOLD = 40;

const SEVERITY_PENALTIES = {
  low: 5,
  medium: 15,
  high: 25,
};

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const getTrustPenalty = (severity) => SEVERITY_PENALTIES[severity] || SEVERITY_PENALTIES.low;

const toFlagRecord = ({ matchId, code, severity, reason, metadata }) => ({
  type: code,
  reason,
  severity,
  trustPenalty: getTrustPenalty(severity),
  matchId,
  metadata,
  createdAt: new Date(),
});

// Fraud duration checks must use a stable lifecycle timestamp.
// `updatedAt` is too noisy because normal admin edits can change it.
const getDurationAnchorTime = (match) => {
  if (match?.liveAt) {
    return new Date(match.liveAt);
  }

  if (match?.startTime) {
    return new Date(match.startTime);
  }

  return new Date();
};

const buildAssessment = (matchId) => ({
  matchId,
  users: [],
});

const upsertAssessmentUser = (assessment, userId) => {
  const normalizedUserId = String(userId);
  let entry = assessment.users.find((candidate) => candidate.userId === normalizedUserId);

  if (!entry) {
    entry = {
      userId: normalizedUserId,
      totalPenalty: 0,
      reasons: [],
    };
    assessment.users.push(entry);
  }

  return entry;
};

const addFinding = (assessment, { userId, code, severity, reason, metadata = null }) => {
  const entry = upsertAssessmentUser(assessment, userId);
  const flag = toFlagRecord({
    matchId: assessment.matchId,
    code,
    severity,
    reason,
    metadata,
  });

  entry.reasons.push(flag);
  entry.totalPenalty += flag.trustPenalty;
};

const getRecentKillAverages = async ({ userIds, session }) => {
  if (userIds.length === 0) {
    return new Map();
  }

  const history = await MatchResult.aggregate([
    {
      $match: {
        userId: { $in: userIds.map((userId) => toObjectId(userId)) },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$userId',
        recentKills: { $push: '$kills' },
        totalMatches: { $sum: 1 },
      },
    },
    {
      $project: {
        totalMatches: 1,
        recentKills: { $slice: ['$recentKills', MAX_RECENT_RESULTS] },
      },
    },
  ]).session(session);

  return new Map(
    history.map((entry) => {
      const kills = Array.isArray(entry.recentKills) ? entry.recentKills : [];
      const averageKills = kills.length > 0
        ? kills.reduce((sum, value) => sum + Number(value || 0), 0) / kills.length
        : 0;

      return [
        String(entry._id),
        {
          totalMatches: Number(entry.totalMatches) || 0,
          averageKills,
        },
      ];
    })
  );
};

const evaluateRepeatedWinner = async ({ assessment, match, winner, session }) => {
  const recentMatches = await Match.find({
    _id: { $ne: match._id },
    game: match.game,
    status: 'COMPLETED',
    winner: { $ne: null },
  })
    .sort({ updatedAt: -1 })
    .limit(MAX_RECENT_RESULTS - 1)
    .select('winner')
    .session(session)
    .lean();

  if (recentMatches.length < (MAX_RECENT_RESULTS - 1)) {
    return;
  }

  const repeatedWins = recentMatches.reduce(
    (count, entry) => (String(entry.winner) === String(winner) ? count + 1 : count),
    1
  );

  if (repeatedWins >= REPEATED_WINNER_THRESHOLD) {
    const severity = repeatedWins >= 9 ? 'high' : 'medium';
    addFinding(assessment, {
      userId: winner,
      code: 'repeated_winner',
      severity,
      reason: `Winner appears in ${repeatedWins} of the last ${MAX_RECENT_RESULTS} completed ${match.game} matches`,
      metadata: {
        game: match.game,
        repeatedWins,
        sampleSize: MAX_RECENT_RESULTS,
      },
    });
  }
};

const evaluateMatchResult = async (match, results, options = {}) => {
  const { winner, session } = options;
  const assessment = buildAssessment(match._id);
  const normalizedResults = Array.isArray(results)
    ? results.map((entry) => ({
        userId: String(entry.userId),
        kills: Number(entry.kills) || 0,
        position: Number(entry.position),
      }))
    : [];

  if (!winner || normalizedResults.length === 0) {
    return assessment;
  }

  const maxKills = Math.max(0, Number(match.maxPlayers) - 1);
  const userIds = [...new Set(normalizedResults.map((entry) => entry.userId))];
  const killHistoryByUser = await getRecentKillAverages({ userIds, session });

  for (const entry of normalizedResults) {
    if (entry.kills > maxKills) {
      addFinding(assessment, {
        userId: entry.userId,
        code: 'kills_over_limit',
        severity: 'high',
        reason: `Reported kills (${entry.kills}) exceed the theoretical maximum (${maxKills})`,
        metadata: {
          reportedKills: entry.kills,
          maxAllowedKills: maxKills,
          maxPlayers: match.maxPlayers,
        },
      });
      continue;
    }

    const userHistory = killHistoryByUser.get(entry.userId);
    if (!userHistory || userHistory.totalMatches < MIN_MATCHES_FOR_SPIKE_CHECK) {
      continue;
    }

    const spikeThreshold = Math.max(
      MIN_KILLS_FOR_SPIKE_FLAG,
      Math.ceil(userHistory.averageKills * KILL_SPIKE_MULTIPLIER)
    );

    if (entry.kills >= spikeThreshold && userHistory.averageKills >= 2) {
      const severity = entry.kills >= Math.ceil(userHistory.averageKills * 5) ? 'high' : 'medium';
      addFinding(assessment, {
        userId: entry.userId,
        code: 'abnormal_kill_spike',
        severity,
        reason: `Reported kills (${entry.kills}) are significantly above the recent average (${userHistory.averageKills.toFixed(2)})`,
        metadata: {
          reportedKills: entry.kills,
          recentAverageKills: Number(userHistory.averageKills.toFixed(2)),
          recentMatchesReviewed: Math.min(userHistory.totalMatches, MAX_RECENT_RESULTS),
          multiplier: KILL_SPIKE_MULTIPLIER,
        },
      });
    }
  }

  await evaluateRepeatedWinner({ assessment, match, winner, session });

  const referenceTime = getDurationAnchorTime(match);
  const durationMs = Date.now() - referenceTime.getTime();
  if (durationMs < MIN_MATCH_DURATION_MS || durationMs > MAX_MATCH_DURATION_MS) {
    addFinding(assessment, {
      userId: winner,
      code: 'unrealistic_match_duration',
      severity: durationMs < MIN_MATCH_DURATION_MS ? 'medium' : 'low',
      reason: `Match duration (${Math.round(durationMs / 1000)}s) falls outside the expected range`,
      metadata: {
        durationMs,
        minDurationMs: MIN_MATCH_DURATION_MS,
        maxDurationMs: MAX_MATCH_DURATION_MS,
        referenceTime: referenceTime.toISOString(),
      },
    });
  }

  return assessment;
};

const applyFraudAssessment = async ({ assessment, session }) => {
  if (!assessment || !Array.isArray(assessment.users) || assessment.users.length === 0) {
    return [];
  }

  const now = new Date();
  const updates = assessment.users.map((entry) => ({
    updateOne: {
      filter: { _id: toObjectId(entry.userId) },
      update: [
        {
          $set: {
            trustScore: {
              $max: [
                0,
                {
                  $subtract: [{ $ifNull: ['$trustScore', 100] }, entry.totalPenalty],
                },
              ],
            },
            flags: {
              $concatArrays: [{ $ifNull: ['$flags', []] }, entry.reasons],
            },
            updatedAt: now,
          },
        },
        {
          $set: {
            isFlagged: { $lt: ['$trustScore', FLAG_TRUST_THRESHOLD] },
          },
        },
      ],
    },
  }));

  await User.bulkWrite(updates, { session, ordered: false });

  return User.find({ _id: { $in: assessment.users.map((entry) => toObjectId(entry.userId)) } })
    .select('username trustScore isFlagged')
    .session(session)
    .lean();
};

const summarizeFraudAssessment = (assessment, users = []) => {
  const usernameMap = new Map(users.map((user) => [String(user._id), user.username]));

  return assessment.users.map((entry) => ({
    userId: entry.userId,
    username: usernameMap.get(entry.userId) || null,
    totalPenalty: entry.totalPenalty,
    reasons: entry.reasons.map((reason) => ({
      type: reason.type,
      severity: reason.severity,
      reason: reason.reason,
    })),
  }));
};

module.exports = {
  FLAG_TRUST_THRESHOLD,
  evaluateMatchResult,
  applyFraudAssessment,
  summarizeFraudAssessment,
};
