const { Server } = require('socket.io');
const logger = require('../utils/logger');

let io;

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', { socketId: socket.id, reason });
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

module.exports = { initializeSocket, getIO, emitEvent };
