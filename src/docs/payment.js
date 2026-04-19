/**
 * @swagger
 * /payment/create-order:
 *   post:
 *     summary: Create a Razorpay order for a match entry
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [matchId]
 *             properties:
 *               matchId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Order created successfully
 *       400:
 *         description: Match is full or user already joined
 *       403:
 *         description: User is banned or flagged
 *
 * /payment/verify:
 *   post:
 *     summary: Verify a completed payment
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *             properties:
 *               razorpay_order_id:
 *                 type: string
 *               razorpay_payment_id:
 *                 type: string
 *               razorpay_signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
 *       400:
 *         description: Invalid signature or verification failure
 *       403:
 *         description: User is banned or flagged
 *
 * /payment/webhook:
 *   post:
 *     summary: Receive Razorpay webhook events
 *     tags: [Payment]
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook acknowledged
 */
