const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ['USER', 'ADMIN'],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    chatType: {
      type: String,
      enum: ['ROOM', 'DIRECT', 'SUPPORT'],
      default: 'ROOM',
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    message: {
      type: String,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    matchCreatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

chatSchema.index(
  { chatType: 1, matchId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { chatType: 'ROOM' },
    name: 'room_chat_unique',
  }
);
chatSchema.index(
  { chatType: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { chatType: 'SUPPORT' },
    name: 'support_chat_unique',
  }
);
chatSchema.index(
  { chatType: 1, userId: 1, receiverId: 1 },
  {
    unique: true,
    partialFilterExpression: { chatType: 'DIRECT' },
    name: 'direct_chat_unique',
  }
);
chatSchema.index({ matchId: 1, matchCreatedBy: 1 });
chatSchema.index({ userId: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Chat', chatSchema);
