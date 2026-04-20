const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, cancelOrder } = require('../controllers/paymentController');
const { handleWebhook } = require('../controllers/webhookController');
const authMiddleware = require('../middlewares/authMiddleware');
const checkBan = require('../middlewares/checkBan');
const checkFlagged = require('../middlewares/checkFlagged');
const validate = require('../middlewares/validationMiddleware');
const { paymentLimiter } = require('../middlewares/rateLimiters');
const { paymentSchemas } = require('../validators/schemas');

router.post('/create-order', authMiddleware, checkBan, checkFlagged, paymentLimiter, validate({ body: paymentSchemas.createOrderBody }), createOrder);
router.post('/verify', authMiddleware, checkBan, checkFlagged, paymentLimiter, validate({ body: paymentSchemas.verifyPaymentBody }), verifyPayment);
router.post('/webhook', handleWebhook);
router.post('/cancel-order', authMiddleware, checkBan, checkFlagged, cancelOrder);

module.exports = router;
