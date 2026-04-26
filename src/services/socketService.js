const { Server } = require('socket.io');
const User = require('../models/User');
const logger = require('../utils/logger');
const { verifyAccessToken } = require('./tokenService');

let io;

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: [
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
        /^http:\/\/10\.0\.2\.2:\d+$/,
        process.env.SOCKET_CORS_ORIGIN || '*',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    maxHttpBufferSize: 1e7, // 10MB
    allowEIO3: true, // Compatibility for older clients
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Unauthorized: Missing socket token'));
      }

      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded._id).select('_id role username').lean();

      if (!user) {
        return next(new Error('Unauthorized: User not found'));
      }

      socket.data.user = user;
      return next();
    } catch (error) {
      logger.warn('Socket authentication rejected', { error: error.message });
      return next(new Error('Unauthorized: Invalid socket token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.data.user._id);
    socket.join(userId);

    logger.info('Socket connected', { socketId: socket.id, userId });

    socket.on('join_user_room', () => {
      socket.join(userId);
      logger.info('Socket joined verified user room', { socketId: socket.id, userId });
    });

    // ── Support message via socket (from user) ──────────────────────────────
    socket.on('support_message', async (data) => {
      try {
        const text = data?.message?.toString()?.trim();
        if (!text) return;

        const Chat = require('../models/Chat');

        let chat = await Chat.findOne({ chatType: 'SUPPORT', userId });

        if (!chat) {
          chat = new Chat({
            chatType: 'SUPPORT',
            userId,
            messages: [],
          });
        }

        chat.messages.push({
          sender: 'USER',
          senderId: socket.data.user._id,
          text,
          createdAt: new Date(),
          isRead: false,
        });
        chat.lastMessageAt = new Date();
        await chat.save();

        const lastMsg = chat.messages[chat.messages.length - 1];
        const username = socket.data.user.username || 'User';

        // Confirm back to the sender
        socket.emit('support_message_sent', {
          chatId: chat._id,
          text,
          message: text,
          createdAt: lastMsg.createdAt,
          sender: 'USER',
          user: { _id: userId, username },
        });

        // Notify all connected admins
        io.emit('admin_new_support_message', {
          chatId: chat._id,
          userId,
          text,
          createdAt: lastMsg.createdAt,
        });

        logger.info('Support message via socket', { userId });
      } catch (error) {
        logger.error('Socket support_message error', { error: error.message });
      }
    });

    // ── Direct message via socket ───────────────────────────────────────────
    socket.on('direct_message', async (data) => {
      try {
        const targetUserId = data?.targetUserId?.toString();
        const text = data?.message?.toString()?.trim();
        if (!text || !targetUserId) return;

        const Chat = require('../models/Chat');

        let chat = await Chat.findOne({
          chatType: 'DIRECT',
          $or: [
            { userId, receiverId: targetUserId },
            { userId: targetUserId, receiverId: userId },
          ],
        });

        if (!chat) {
          chat = new Chat({
            chatType: 'DIRECT',
            userId,
            receiverId: targetUserId,
            messages: [],
          });
        }

        const role = socket.data.user.role;
        chat.messages.push({
          sender: role === 'admin' || role === 'manager' ? 'ADMIN' : 'USER',
          senderId: socket.data.user._id,
          text,
          createdAt: new Date(),
          isRead: false,
        });
        chat.lastMessageAt = new Date();
        await chat.save();

        const lastMsg = chat.messages[chat.messages.length - 1];
        const username = socket.data.user.username || 'User';

        emitToUser(targetUserId, 'direct_message', {
          chatId: chat._id,
          senderId: userId,
          text,
          message: text,
          createdAt: lastMsg.createdAt,
          user: { _id: userId, username },
        });

        logger.info('Direct message via socket', { senderId: userId, targetUserId });
      } catch (error) {
        logger.error('Socket direct_message error', { error: error.message });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', { socketId: socket.id, userId, reason });
    });
  });

  return io;
};

const getIO = () => io;

const emitEvent = (eventName, payload) => {
  if (!io) {
    logger.warn('Socket emit skipped because Socket.IO is not initialized', { eventName });
    return;
  }

  io.emit(eventName, payload);
};

const emitToUser = (userId, eventName, payload) => {
  if (!io) {
    logger.warn('Socket emit skipped', { eventName });
    return;
  }

  io.to(String(userId)).emit(eventName, payload);
};

module.exports = { initializeSocket, getIO, emitEvent, emitToUser };
