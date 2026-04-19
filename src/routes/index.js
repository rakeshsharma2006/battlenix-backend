const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../config/swagger');
const express = require('express');
const router = express.Router();
const sampleController = require('../controllers/sampleController');
const authRoutes = require('./authRoutes');
const googleAuthRoutes = require('./googleAuthRoutes');
const matchRoutes = require('./matchRoutes');
const paymentRoutes = require('./paymentRoutes');
const matchmakingRoutes = require('./matchmakingRoutes');
const playerRoutes = require('./playerRoutes');
const adminRoutes = require('./adminRoutes');
const leaderboardRoutes = require('./leaderboardRoutes');
const chatRoutes = require('./chatRoutes');
const supportRoutes = require('./supportRoutes');

router.get('/', sampleController.getWelcomeMessage);
router.get('/health', sampleController.getHealth);

router.use('/docs', swaggerUi.serve);
router.get('/docs', swaggerUi.setup(swaggerSpec));

router.use('/auth', authRoutes);
router.use('/auth', googleAuthRoutes);
router.use('/matches', matchRoutes);
router.use('/payment', paymentRoutes);
router.use('/matchmaking', matchmakingRoutes);
router.use('/player', playerRoutes);
router.use('/admin', adminRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/chat', chatRoutes);
router.use('/support', supportRoutes);

module.exports = router;
