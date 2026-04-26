const chatService = require('../services/chatService');
const logger = require('../utils/logger');

const handleChatError = (error, res) => {
  const errorMap = {
    'Chat message is required': 400,
    'Match not found': 404,
    'Chat is only available after match start': 400,
    'Chat is only available after match completion': 400,
    'Chat is only available for active or completed matches': 400,
    'You can only chat in matches you created': 403,
    'You are not a participant of this match': 403,
    'You can only view your own chat': 403,
    'targetUserId is required when admin sends a message': 400,
    'Target user is not a participant of this match': 400,
    'targetUserId is required': 400,
    'Admin access required': 403,
  };
  const status = errorMap[error.message] || 500;
  return res.status(status).json({ message: error.message });
};

const sendMatchMessage = async (req, res) => {
  try {
    const chatMessage = await chatService.sendMatchMessage({
      matchId: req.params.matchId,
      senderId: req.user._id,
      senderUsername: req.user.username,
      text: req.body.message || req.body.text,
    });
    return res.status(201).json({ message: 'Message sent', chatMessage });
  } catch (error) {
    logger.error('sendMatchMessage error', { error: error.message });
    return handleChatError(error, res);
  }
};

const getMatchChatHistory = async (req, res) => {
  try {
    const chat = await chatService.getMatchChatHistory({
      matchId: req.params.matchId,
    });
    return res.status(200).json(chat);
  } catch (error) {
    logger.error('getMatchChatHistory error', { error: error.message });
    return handleChatError(error, res);
  }
};

const sendMessage = async (req, res) => {
  try {
    const chatMessage = await chatService.sendMessage({
      matchId: req.body.matchId,
      senderId: req.user._id,
      senderRole: req.user.role,
      text: req.body.text,
      targetUserId: req.body.targetUserId || null,
    });
    return res.status(201).json({ message: 'Message sent', chatMessage });
  } catch (error) {
    logger.error('sendMessage error', { error: error.message });
    return handleChatError(error, res);
  }
};

const getChat = async (req, res) => {
  try {
    const chat = await chatService.getChat({
      matchId: req.params.matchId,
      targetUserId: req.params.userId,
      requesterId: req.user._id,
      requesterRole: req.user.role,
    });
    return res.status(200).json({ chat });
  } catch (error) {
    logger.error('getChat error', { error: error.message });
    return handleChatError(error, res);
  }
};

const getMatchChats = async (req, res) => {
  try {
    const chats = await chatService.getMatchChats({
      matchId: req.params.matchId,
      requesterId: req.user._id,
      requesterRole: req.user.role,
    });
    return res.status(200).json({ chats });
  } catch (error) {
    logger.error('getMatchChats error', { error: error.message });
    return handleChatError(error, res);
  }
};

const Chat = require('../models/Chat');
const { emitToUser } = require('../services/socketService');

const sendDirectMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const targetUserId = req.params.userId;
    const senderId = req.user._id;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    let chat = await Chat.findOne({
      chatType: 'DIRECT',
      $or: [
        { userId: senderId, receiverId: targetUserId },
        { userId: targetUserId, receiverId: senderId }
      ]
    });

    if (!chat) {
      chat = new Chat({
        chatType: 'DIRECT',
        userId: senderId,
        receiverId: targetUserId,
        messages: []
      });
    }

    chat.messages.push({
      sender: req.user.role === 'admin' ? 'ADMIN' : 'USER',
      senderId: senderId,
      text: message,
      createdAt: new Date(),
      isRead: false
    });
    chat.lastMessageAt = new Date();
    await chat.save();

    const lastMsg = chat.messages[chat.messages.length - 1];

    emitToUser(targetUserId.toString(), 'new_direct_message', {
      chatId: chat._id,
      senderId: senderId,
      text: message,
      createdAt: lastMsg.createdAt,
    });

    return res.status(201).json({ message: 'Message sent', chatMessage: lastMsg });
  } catch (error) {
    logger.error('sendDirectMessage error', { error: error.message });
    return res.status(500).json({ message: 'Failed to send direct message' });
  }
};

const getDirectChatHistory = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const senderId = req.user._id;

    const chat = await Chat.findOne({
      chatType: 'DIRECT',
      $or: [
        { userId: senderId, receiverId: targetUserId },
        { userId: targetUserId, receiverId: senderId }
      ]
    }).lean();

    return res.status(200).json({ chat: chat || { messages: [] } });
  } catch (error) {
    logger.error('getDirectChatHistory error', { error: error.message });
    return res.status(500).json({ message: 'Failed to get chat' });
  }
};

const sendSupportMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const senderId = req.user._id;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }
    
    // Support chat belongs to the user who creates it. Admin can reply to it via targetUserId
    // Let's assume sender is USER asking for support, or admin replying.
    // Wait, if it's admin replying, they wouldn't use `/chat/support` without target user id, or they might pass targetUserId in body/params.
    // For simplicity, let's treat req.user as the support seeker, unless targetUserId is provided.
    const targetUserId = req.body.targetUserId || senderId;

    let chat = await Chat.findOne({
      chatType: 'SUPPORT',
      userId: targetUserId
    });

    if (!chat) {
      chat = new Chat({
        chatType: 'SUPPORT',
        userId: targetUserId,
        receiverId: null,
        messages: []
      });
    }

    chat.messages.push({
      sender: req.user.role === 'admin' ? 'ADMIN' : 'USER',
      senderId: senderId,
      text: message,
      createdAt: new Date(),
      isRead: false
    });
    chat.lastMessageAt = new Date();
    await chat.save();
    
    const lastMsg = chat.messages[chat.messages.length - 1];

    const isAdminSender = req.user.role === 'admin' || req.user.role === 'manager';

    if (isAdminSender) {
      // Admin replied → notify the user with the event Flutter listens for
      emitToUser(targetUserId.toString(), 'support_reply', {
        chatId: chat._id,
        senderId: senderId,
        senderRole: 'ADMIN',
        text: message,
        message: message,
        createdAt: lastMsg.createdAt,
        sender: 'ADMIN',
        user: {
          _id: senderId.toString(),
          username: req.user.username || 'Admin',
        },
      });
    } else {
      // User sent a support message → notify all connected admins
      const { getIO } = require('../services/socketService');
      const io = getIO();
      if (io) {
        io.emit('admin_new_support_message', {
          chatId: chat._id,
          userId: targetUserId.toString(),
          senderId: senderId.toString(),
          text: message,
          createdAt: lastMsg.createdAt,
        });
      }
    }

    return res.status(201).json({ message: 'Support message sent', chatMessage: lastMsg });
  } catch (error) {
    logger.error('sendSupportMessage error', { error: error.message });
    return res.status(500).json({ message: 'Failed to send support message' });
  }
};

const getSupportChatHistory = async (req, res) => {
  try {
    const targetUserId = req.query.userId || req.user._id;
    
    // Non-admins can only see their own support history
    if (req.user.role !== 'admin' && targetUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const chat = await Chat.findOne({
      chatType: 'SUPPORT',
      userId: targetUserId
    }).lean();

    return res.status(200).json({ chat: chat || { messages: [] } });
  } catch (error) {
    logger.error('getSupportChatHistory error', { error: error.message });
    return res.status(500).json({ message: 'Failed to get support chat' });
  }
};

const replySupportMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const targetUserId = req.params.userId;
    const senderId = req.user._id;

    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    let chat = await Chat.findOne({
      chatType: 'SUPPORT',
      userId: targetUserId
    });

    if (!chat) {
      return res.status(404).json({ message: 'Support chat not found' });
    }

    chat.messages.push({
      sender: req.user.role === 'admin' || req.user.role === 'manager' ? 'ADMIN' : 'USER',
      senderId: senderId,
      text: message,
      createdAt: new Date(),
      isRead: false
    });
    chat.lastMessageAt = new Date();
    await chat.save();
    
    const lastMsg = chat.messages[chat.messages.length - 1];

    emitToUser(targetUserId.toString(), 'support_reply', {
      chatId: chat._id,
      senderId: senderId,
      senderRole: 'ADMIN',
      text: message,
      message: message,
      createdAt: lastMsg.createdAt,
      sender: 'ADMIN',
      user: {
        _id: senderId.toString(),
        username: req.user.username || 'Admin',
      },
    });

    return res.status(201).json({ message: 'Reply sent', chatMessage: lastMsg });
  } catch (error) {
    logger.error('replySupportMessage error', { error: error.message });
    return res.status(500).json({ message: 'Failed to send reply' });
  }
};

module.exports = {
  sendMatchMessage,
  getMatchChatHistory,
  sendMessage,
  getChat,
  getMatchChats,
  sendDirectMessage,
  getDirectChatHistory,
  sendSupportMessage,
  getSupportChatHistory,
  replySupportMessage,
};
