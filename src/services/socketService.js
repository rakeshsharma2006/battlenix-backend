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
      const user = await User.findById(decoded._id).select('_id role').lean();

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
