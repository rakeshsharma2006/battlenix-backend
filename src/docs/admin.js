/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get admin dashboard stats
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role. Includes backend deployment diagnostics for admin troubleshooting.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats fetched, including backend runtime diagnostics
 *
 * /admin/payments:
 *   get:
 *     summary: List payments
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payments fetched
 *
 * /admin/refunds:
 *   get:
 *     summary: List refunds
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: refundStatus
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Refunds fetched
 *
 * /admin/matches:
 *   get:
 *     summary: List matches for admin review
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admin matches fetched
 *
 * /admin/matches/{id}/declare-winner:
 *   post:
 *     summary: Declare a manual payout winner for a completed match
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [winnerId]
 *             properties:
 *               winnerId:
 *                 type: string
 *               prizeAmount:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Winner declared successfully
 *
 * /admin/matches/{id}/mark-paid:
 *   post:
 *     summary: Mark a declared payout as paid
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment marked as paid successfully
 *
 * /admin/payouts:
 *   get:
 *     summary: List payout records
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID]
 *     responses:
 *       200:
 *         description: Payouts fetched successfully
 *
 * /admin/payouts/{payoutId}:
 *   get:
 *     summary: Get payout details
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payoutId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payout fetched successfully
 *       404:
 *         description: Payout not found
 *
 *
 * /admin/slots:
 *   get:
 *     summary: List today's time slots
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *           enum: [Erangel, Livik]
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [Solo, Duo, Squad]
 *     responses:
 *       200:
 *         description: Today's slots fetched
 *
 * /admin/slots/create:
 *   post:
 *     summary: Create a time-based slot
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [map, mode, entryFee, startTime]
 *             properties:
 *               map:
 *                 type: string
 *                 enum: [Erangel, Livik]
 *               mode:
 *                 type: string
 *                 enum: [Solo, Duo, Squad]
 *               entryFee:
 *                 type: number
 *                 enum: [20, 30, 50, 100]
 *               startTime:
 *                 type: string
 *     responses:
 *       201:
 *         description: Time slot created
 *       400:
 *         description: Duplicate or invalid slot payload
 *
 * /admin/slots/{slotId}:
 *   delete:
 *     summary: Delete an empty time slot
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slotId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Slot deleted
 *       404:
 *         description: Slot not found
 *
 * /admin/flags:
 *   get:
 *     summary: List flagged users
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Flagged users fetched
 *
 * /admin/flags/{userId}:
 *   get:
 *     summary: Get a single user's flag details
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Flag details fetched
 *       404:
 *         description: User not found
 *
 * /admin/flags/{userId}/review:
 *   post:
 *     summary: Review and clear or ban a flagged user
 *     tags: [Admin]
 *     description: Requires bearer authentication and admin or manager role.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, adminNote]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [clear, ban]
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Review action applied
 *       404:
 *         description: User not found
 */


