const express = require('express');
const router = express.Router();
const sampleController = require('../controllers/sampleController');
const authRoutes = require('./authRoutes');
const matchRoutes = require('./matchRoutes');
const paymentRoutes = require('./paymentRoutes');
const adminRoutes = require('./adminRoutes');

router.get('/', sampleController.getWelcomeMessage);
router.get('/health', sampleController.getHealth);

router.use('/auth', authRoutes);
router.use('/matches', matchRoutes);
router.use('/payment', paymentRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
