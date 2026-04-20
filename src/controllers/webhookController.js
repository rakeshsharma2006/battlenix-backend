const crypto = require('crypto');
const Payment = require('../models/Payment');
const {
  settleCapturedPayment,
  settleStandalonePayment,
  validateCapturedPaymentRecord,
  processRefund,
} = require('./paymentController');
const logger = require('../utils/logger');

const handleWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (!signature || !webhookSecret) {
      logger.warn('Webhook rejected because signature or webhook secret is missing');
      return res.status(400).json({ message: 'Missing signature' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      logger.warn('Webhook rejected because signature verification failed');
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const event = req.body;
    const eventType = event.event;
    logger.info('Webhook received', { eventType });

    if (eventType === 'payment.captured') {
      const paymentEntity = event.payload.payment.entity;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      const payment = await Payment.findOne({ razorpay_order_id: orderId });
      if (!payment) {
        logger.warn('Webhook payment.captured ignored because payment record was not found', {
          orderId,
          paymentId,
        });
        return res.status(200).json({ message: 'Payment not found, ignoring' });
      }

      const validation = validateCapturedPaymentRecord({
        paymentRecord: payment,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        amount: paymentEntity.amount,
        currency: paymentEntity.currency,
        status: paymentEntity.status,
      });

      if (!validation.valid) {
        logger.error('Webhook payment.captured rejected due to validation failure', {
          orderId,
          paymentId,
          paymentRecordId: payment._id,
          code: validation.code,
          message: validation.message,
        });

        if (
          validation.code === 'AMOUNT_MISMATCH' ||
          validation.code === 'CURRENCY_MISMATCH'
        ) {
          await Payment.findByIdAndUpdate(payment._id, {
            $set: {
              status: 'FAILED',
              processingAt: null,
              razorpay_payment_id: paymentId,
            },
          });
          await processRefund(payment._id, validation.message, {
            razorpayPaymentId: paymentId,
          });
        }

        if (validation.code === 'PAYMENT_ID_CONFLICT') {
          await processRefund(payment._id, validation.message, {
            razorpayPaymentId: paymentId,
          });
        }

        return res.status(200).json({ message: validation.message });
      }

      if (!payment.matchId) {
        if (payment.status === 'SUCCESS') {
          return res.status(200).json({ message: 'Already processed' });
        }

        if (payment.status === 'FAILED') {
          return res.status(200).json({ message: 'Payment already failed' });
        }

        const settlement = await settleStandalonePayment({
          paymentId: payment._id,
          razorpayPaymentId: paymentId,
          source: 'Webhook',
        });

        logger.info('Webhook prepaid payment.captured processed', {
          orderId,
          paymentId,
          paymentRecordId: payment._id,
          outcome: settlement.kind,
        });

        return res.status(200).json({
          message: settlement.kind === 'SUCCESS' ? 'Webhook processed' : 'Already processed',
        });
      }

      const settlement = await settleCapturedPayment({
        paymentId: payment._id,
        razorpayPaymentId: paymentId,
        source: 'Webhook',
      });

      logger.info('Webhook payment.captured processed', {
        orderId,
        paymentId,
        paymentRecordId: payment._id,
        outcome: settlement.kind,
      });

      if (settlement.kind === 'SUCCESS') {
        return res.status(200).json({ message: 'Webhook processed' });
      }

      if (settlement.kind === 'FAILED_REFUNDED') {
        return res.status(200).json({
          message: 'Payment captured but join failed. Refund handling started.',
          refund_status: settlement.payment.refundStatus,
        });
      }

      if (settlement.kind === 'ALREADY_SUCCESS') {
        return res.status(200).json({ message: 'Already processed' });
      }

      if (settlement.kind === 'ALREADY_FAILED') {
        return res.status(200).json({ message: 'Payment already failed' });
      }

      if (settlement.kind === 'PAYMENT_ID_CONFLICT') {
        return res.status(200).json({
          message: 'Payment id conflict detected',
          refund_status: settlement.payment.refundStatus,
        });
      }

      return res.status(200).json({ message: 'Payment processing is already in progress' });
    }

    if (eventType === 'payment.failed') {
      const paymentEntity = event.payload.payment.entity;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      const payment = await Payment.findOne({ razorpay_order_id: orderId });
      if (!payment) {
        logger.warn('Webhook payment.failed ignored because payment record was not found', {
          orderId,
          paymentId,
        });
        return res.status(200).json({ message: 'Payment not found, ignoring' });
      }

      if (payment.status === 'SUCCESS') {
        logger.error('Webhook payment.failed received after payment already succeeded', {
          orderId,
          paymentId,
          paymentRecordId: payment._id,
        });
        return res.status(200).json({ message: 'Already succeeded, ignoring' });
      }

      if (payment.status === 'FAILED') {
        logger.info('Webhook payment.failed ignored because payment is already FAILED', {
          orderId,
          paymentId,
          paymentRecordId: payment._id,
        });

        if (payment.razorpay_payment_id) {
          await processRefund(payment._id, 'Payment failed webhook', {
            razorpayPaymentId: payment.razorpay_payment_id,
          });
        }

        return res.status(200).json({ message: 'Payment already failed' });
      }

      const failedPayment = await Payment.findByIdAndUpdate(
        payment._id,
        {
          $set: {
            status: 'FAILED',
            razorpay_payment_id: payment.razorpay_payment_id,
            processingAt: null,
          },
        },
        { new: true }
      );

      logger.info('Webhook marked payment as FAILED', {
        orderId,
        paymentId,
        paymentRecordId: failedPayment._id,
      });

      if (failedPayment.razorpay_payment_id) {
        await processRefund(failedPayment._id, 'Payment failed webhook', {
          razorpayPaymentId: failedPayment.razorpay_payment_id,
        });
      }

      return res.status(200).json({ message: 'Payment marked as failed' });
    }

    logger.info('Webhook event acknowledged without action', { eventType });
    return res.status(200).json({ message: 'Event not handled' });
  } catch (error) {
    logger.error('Webhook processing failed', { error: error.message });
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};

module.exports = { handleWebhook };



















