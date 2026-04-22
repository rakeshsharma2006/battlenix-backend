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

const playerAssignmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teamId: {
      type: Number,
      required: true,
      min: 1,
    },
    slot: {
      type: Number,
      required: true,
      min: 1,
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
      enum: ['BGMI', 'FREE_FIRE'],
      required: true,
      trim: true,
    },
    map: {
      type: String,
      enum: ['Erangel', 'Livik', 'Bermuda', 'Purgatory', 'Kalahari'],
      required: true,
    },
    mode: {
      type: String,
      enum: ['Solo', 'Duo', 'Squad'],
      required: true,
    },
    prizeBreakdown: {
      playerPrize:    { type: Number, default: 0 },
      managerCut:     { type: Number, default: 0 },
      adminCut:       { type: Number, default: 0 },
      teamSize:       { type: Number, default: 1 },
      prizePerMember: { type: Number, default: 0 },
    },
    winnerTeam: {
      type: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }],
      default: [],
    },
    paymentStatus: {
      type: String,
      enum: ['NOT_APPLICABLE', 'PENDING', 'PAID'],
      default: 'NOT_APPLICABLE',
      index: true,
    },
    declaredWinnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    winnerUpiId: {
      type: String,
      default: null,
    },
    prizeAmount: {
      type: Number,
      default: 0,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    slotType: {
      type: String,
      enum: ['RANDOM', 'FRIENDS'],
      default: 'RANDOM',
      index: true,
    },
    slotCode: {
      type: String,
    },
    isAutoCreated: {
      type: Boolean,
      default: false,
    },
    entryType: {
      type: String,
      enum: ['FREE', 'PAID'],
      default: 'PAID',
    },
    entryFee: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    customPrize: {
      type: Number,
      default: null,
    },
    chatEnabled: {
      type: Boolean,
      default: true,
    },
    maxPlayers: {
      type: Number,
      required: true,
      min: 2,
      max: 100,
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
    playerAssignments: {
      type: [playerAssignmentSchema],
      default: [],
    },
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
    liveAt: {
      type: Date,
      default: null,
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

matchSchema.index({ status: 1, startTime: 1 });
matchSchema.index({ status: 1, playersCount: 1, maxPlayers: 1 });
matchSchema.index({ game: 1, map: 1, mode: 1, entryFee: 1, status: 1, slotType: 1 });
matchSchema.index({ slotCode: 1 }, { unique: true, sparse: true });

// OPTIMIZATION 2: Additional indexes for common query patterns
matchSchema.index({ status: 1, game: 1 });        // game lobby listing
matchSchema.index({ players: 1, status: 1 });    // "is user in active match?" check — covers hasUserJoinedMatch + findActiveMatchForUser
matchSchema.index({ entryFee: 1, status: 1 });   // free-match listing filter

module.exports = mongoose.model('Match', matchSchema);
