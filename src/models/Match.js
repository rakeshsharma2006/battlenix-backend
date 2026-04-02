const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    position: {
      type: Number,
      required: true,
      min: 1,
    },
    kills: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const matchSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    game: {
      type: String,
      required: true,
      trim: true,
    },
    entryFee: {
      type: Number,
      required: true, // stored in rupees
      min: 0,
    },
    maxPlayers: {
      type: Number,
      required: true,
      min: 1,
    },
    playersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['UPCOMING', 'READY', 'LIVE', 'COMPLETED', 'CANCELLED'],
      default: 'UPCOMING',
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      default: null,
      trim: true,
    },
    roomPassword: {
      type: String,
      default: null,
      trim: true,
    },
    isRoomPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    results: {
      type: [resultSchema],
      default: [],
    },
    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

matchSchema.index({ status: 1, startTime: 1 });
matchSchema.index({ status: 1, playersCount: 1, maxPlayers: 1 });

module.exports = mongoose.model('Match', matchSchema);
