const mongoose = require('mongoose');

const leaderboardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    totalPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalWins: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalKills: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalMatches: {
      type: Number,
      default: 0,
      min: 0,
    },
    weeklyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    weekKey: {
      type: String,
      default: null,
      index: true,
    },
    monthlyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    monthKey: {
      type: String,
      default: null,
      index: true,
    },
    lastMatchAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

leaderboardSchema.index({ totalPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 });
leaderboardSchema.index({ weekKey: 1, weeklyPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 });
leaderboardSchema.index({ monthKey: 1, monthlyPoints: -1, totalWins: -1, totalKills: -1, lastMatchAt: -1 });

module.exports = mongoose.model('Leaderboard', leaderboardSchema);
