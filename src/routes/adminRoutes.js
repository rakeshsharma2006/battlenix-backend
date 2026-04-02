const express = require('express');
const router = express.Router();
const { listPayments, listRefunds, listMatches } = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { adminLimiter } = require('../middlewares/rateLimiters');
const { adminSchemas } = require('../validators/schemas');

router.use(authMiddleware, adminMiddleware, adminLimiter);

router.get('/payments', validate({ query: adminSchemas.paymentsQuery }), listPayments);
router.get('/refunds', validate({ query: adminSchemas.refundsQuery }), listRefunds);
router.get('/matches', validate({ query: adminSchemas.matchesQuery }), listMatches);

module.exports = router;
