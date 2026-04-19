const mongoose = require('mongoose');

const matchResultSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kills: {
      type: Number,
      required: true,
      min: 0,
    },
    position: {
      type: Number,
      required: true,
      min: 1,
    },
    isWinner: {
      type: Boolean,
      default: false,
      index: true,
    },
    pointsEarned: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

matchResultSchema.index({ matchId: 1, userId: 1 }, { unique: true });
matchResultSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('MatchResult', matchResultSchema);
