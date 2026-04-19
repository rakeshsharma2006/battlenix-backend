const { createClient } = require('redis');
const logger = require('../utils/logger');

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => logger.error('Redis Client Error', { error: err.message }));
redisClient.on('connect', () => logger.info('Redis client connected'));

// Automatically connect
redisClient.connect().catch(err => logger.error('Redis connection failed', { error: err.message }));

module.exports = redisClient;
