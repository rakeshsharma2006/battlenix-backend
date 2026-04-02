const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment } = require('../controllers/paymentController');
const { handleWebhook } = require('../controllers/webhookController');
const authMiddleware = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { paymentLimiter } = require('../middlewares/rateLimiters');
const { paymentSchemas } = require('../validators/schemas');

router.post('/create-order', authMiddleware, paymentLimiter, validate({ body: paymentSchemas.createOrderBody }), createOrder);
router.post('/verify', authMiddleware, paymentLimiter, validate({ body: paymentSchemas.verifyPaymentBody }), verifyPayment);
router.post('/webhook', handleWebhook);

module.exports = router;
