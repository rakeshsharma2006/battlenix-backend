const Chat = require('../models/Chat');
const Match = require('../models/Match');
const logger = require('../utils/logger');
const { emitToUser } = require('./socketService');

const ensureMatchExists = async (matchId) => {
  const match = await Match.findById(matchId).select('status createdBy players');

  if (!match) {
    throw new Error('Match not found');
  }

  return match;
};

const buildPublicChatMessage = ({
  chatId,
  matchId,
  rawMessage,
  fallbackUserId,
  fallbackUsername,
}) => {
  const sender = rawMessage?.senderId;
  const senderId = String(
    sender?._id ||
      fallbackUserId ||
      rawMessage?.senderId ||
      '',
  );
  const senderUsername =
    sender?.username?.toString().trim() ||
    fallbackUsername?.toString().trim() ||
    'Unknown';
  const createdAt = rawMessage?.createdAt || new Date();
  const createdAtKey = new Date(createdAt).getTime();

  return {
    _id: `${chatId}:${senderId}:${createdAtKey}`,
    matchId: String(matchId),
    message: rawMessage?.text?.toString() ?? '',
    user: {
      _id: senderId,
      username: senderUsername,
    },
    createdAt,
  };
};

const getMatchChatHistory = async ({ matchId }) => {
  await ensureMatchExists(matchId);

  const chatThreads = await Chat.find({ matchId })
    .select('matchId userId messages')
    .populate('userId', 'username')
    .populate('messages.senderId', 'username')
    .lean();

  const messages = chatThreads
    .flatMap((chat) => {
      const chatUserId = String(chat.userId?._id || chat.userId || '');
      const chatUsername = chat.userId?.username?.toString() ?? 'Unknown';

      return (Array.isArray(chat.messages) ? chat.messages : [])
        .filter((message) => message?.sender === 'USER')
        .map((message) => buildPublicChatMessage({
          chatId: chat._id,
          matchId,
          rawMessage: message,
          fallbackUserId: chatUserId,
          fallbackUsername: chatUsername,
        }));
    })
    .sort((left, right) => (
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    ));

  return {
    matchId: String(matchId),
    messages,
  };
};

const sendMatchMessage = async ({
  matchId,
  senderId,
  senderUsername,
  text,
}) => {
  const match = await ensureMatchExists(matchId);
  const normalizedText = text?.trim();

  if (!normalizedText) {
    throw new Error('Chat message is required');
  }

  const chat = await Chat.findOneAndUpdate(
    { matchId, userId: senderId },
    {
      $push: {
        messages: {
          sender: 'USER',
          senderId,
          text: normalizedText,
          createdAt: new Date(),
        },
      },
      $set: {
        lastMessageAt: new Date(),
        matchCreatedBy: match.createdBy,
      },
    },
    { upsert: true, new: true }
  );

  const lastMessage = chat.messages[chat.messages.length - 1];
  const formattedMessage = buildPublicChatMessage({
    chatId: chat._id,
    matchId,
    rawMessage: {
      senderId: {
        _id: senderId,
        username: senderUsername,
      },
      text: lastMessage.text,
      createdAt: lastMessage.createdAt,
    },
    fallbackUserId: senderId,
    fallbackUsername: senderUsername,
  });

  const recipientIds = new Set(
    [
      ...(Array.isArray(match.players) ? match.players.map((playerId) => String(playerId)) : []),
      match.createdBy ? String(match.createdBy) : null,
      String(senderId),
    ].filter(Boolean)
  );

  for (const recipientId of recipientIds) {
    emitToUser(recipientId, 'new_message', formattedMessage);
  }

  logger.info('Match chat message sent', {
    matchId,
    senderId,
  });

  return formattedMessage;
};

const validateChatAccess = async ({ matchId, requesterId, requesterRole }) => {
  const match = await Match.findById(matchId).select('status startTime players createdBy winner');
  
  if (!match) {
    throw new Error('Match not found');
  }
  
  const allowedStatuses = ['READY', 'LIVE', 'COMPLETED'];
  if (!allowedStatuses.includes(match.status)) {
    throw new Error('Chat is only available for active or completed matches');
  }

  const isAdmin = requesterRole === 'admin' || requesterRole === 'manager';

  if (isAdmin) {
    // Admin can access any match chat
    return { match, isAdmin: true };
  } else {
    const isPlayerInMatch = match.players.map(p => p.toString()).includes(requesterId.toString());
    if (!isPlayerInMatch) {
      throw new Error('You are not a participant of this match');
    }
    return { match, isAdmin: false };
  }
};

const sendMessage = async ({ matchId, senderId, senderRole, text, targetUserId }) => {
  const { match, isAdmin } = await validateChatAccess({ matchId, requesterId: senderId, requesterRole: senderRole });

  let senderType;
  let chatUserId;

  if (isAdmin) {
    senderType = 'ADMIN';
    chatUserId = targetUserId;
  } else {
    senderType = 'USER';
    chatUserId = senderId;
  }

  if (senderType === 'ADMIN' && !targetUserId) {
    throw new Error('targetUserId is required when admin sends a message');
  }

  if (senderType === 'ADMIN') {
    const isPlayerInMatch = match.players.map(p => p.toString()).includes(targetUserId.toString());
    if (!isPlayerInMatch) {
      throw new Error('Target user is not a participant of this match');
    }
  }

  const chat = await Chat.findOneAndUpdate(
    { matchId, userId: chatUserId },
    {
      $push: {
        messages: {
          sender: senderType,
          senderId,
          text: text.trim(),
          createdAt: new Date(),
        },
      },
      $set: {
        lastMessageAt: new Date(),
        matchCreatedBy: match.createdBy,
      },
    },
    { upsert: true, new: true }
  );

  const lastMessage = chat.messages[chat.messages.length - 1];

  logger.info('Chat message sent', {
    matchId,
    senderId,
    senderType,
    chatUserId,
  });

  emitToUser(String(chatUserId), 'new_message', {
    matchId,
    userId: chatUserId,
    sender: senderType,
    text: text.trim(),
    createdAt: lastMessage.createdAt,
  });

  return lastMessage;
};

const getChat = async ({ matchId, targetUserId, requesterId, requesterRole }) => {
  const { isAdmin } = await validateChatAccess({ matchId, requesterId, requesterRole });

  if (!isAdmin) {
    if (targetUserId.toString() !== requesterId.toString()) {
      throw new Error('You can only view your own chat');
    }
  } else {
    if (!targetUserId) {
      throw new Error('targetUserId is required');
    }
  }

  const chat = await Chat.findOne({ matchId, userId: targetUserId })
    .populate('userId', 'username')
    .lean();

  if (!chat) {
    return { messages: [], matchId, userId: targetUserId };
  }

  const readerSide = isAdmin ? 'USER' : 'ADMIN';
  await Chat.updateOne(
    { matchId, userId: targetUserId },
    { $set: { 'messages.$[elem].isRead': true } },
    { arrayFilters: [{ 'elem.sender': readerSide, 'elem.isRead': false }] }
  );

  return chat;
};

const getMatchChats = async ({ matchId, requesterId, requesterRole }) => {
  const isAdmin = requesterRole === 'admin' || requesterRole === 'manager';
  
  if (!isAdmin) {
    throw new Error('Admin access required');
  }

  const match = await Match.findById(matchId).select('createdBy');
  if (!match) {
    throw new Error('Match not found');
  }

  if (requesterRole !== 'admin' && match.createdBy.toString() !== requesterId.toString()) {
    throw new Error('You can only view chats for matches you created');
  }

  const chats = await Chat.find({ matchId })
    .populate('userId', 'username email')
    .sort({ lastMessageAt: -1 })
    .lean();

  return chats;
};

module.exports = {
  getMatchChatHistory,
  sendMatchMessage,
  validateChatAccess,
  sendMessage,
  getChat,
  getMatchChats,
};
