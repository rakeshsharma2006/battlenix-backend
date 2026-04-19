/**
 * @swagger
 * /matchmaking/join-random:
 *   post:
 *     summary: Join an auto-created random matchmaking slot
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [map, mode, entryFee, paymentId]
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
 *               paymentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Joined random slot
 *       400:
 *         description: Validation, payment, or slot assignment error
 *
 * /matchmaking/create-friends-room:
 *   post:
 *     summary: Create a private friends matchmaking slot
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [map, mode, entryFee, paymentId]
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
 *               paymentId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Friends room created with slot code
 *       400:
 *         description: Validation, payment, or slot creation error
 *
 * /matchmaking/join-friends-room:
 *   post:
 *     summary: Join a private friends matchmaking slot using a slot code
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slotCode, paymentId]
 *             properties:
 *               slotCode:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *               paymentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Joined friends room
 *       400:
 *         description: Invalid slot code, payment, or room state
 *
 *
 * /matchmaking/slots:
 *   get:
 *     summary: Browse today's available time slots grouped by entry fee
 *     tags: [Matchmaking]
 *     description: Returns today's available time slots grouped by entry fee. Each slot has isExpired, isFull, fillPercent fields.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: map
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Erangel, Livik]
 *       - in: query
 *         name: mode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Solo, Duo, Squad]
 *     responses:
 *       200:
 *         description: Slot groups fetched successfully
 *       400:
 *         description: Invalid map or mode
 *
 * /matchmaking/my-match:
 *   get:
 *     summary: Get the current active matchmaking slot for the authenticated user
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current active match or null
 */
/**
 * @swagger
 * components:
 *   schemas:
 *     SocketEvents:
 *       type: object
 *       description: |
 *         Socket.IO Events emitted by server:
 *         - room_published: { matchId, title, roomId, roomPassword, message }
 *         - slot_updated: { matchId, map, mode, entryFee, playersCount, maxPlayers, isFull, status, fillPercent }
 *           Emitted globally whenever a player joins any slot. Flutter should listen and update slot UI in real-time.
 *         - match_ready: { matchId, title, message }
 *         - match_updated: { matchId, status }
 *         - new_message: { matchId, userId, sender, text, createdAt }
 *         - winner_declared: { matchId, matchTitle, prizeAmount, paymentStatus, message }
 *         - payment_done: { matchId, matchTitle, prizeAmount, paymentStatus, message }
 */

