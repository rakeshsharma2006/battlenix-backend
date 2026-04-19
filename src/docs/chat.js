/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Admin-Player match chat management
 */

/**
 * @swagger
 * /chat/send:
 *   post:
 *     summary: Send a chat message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - matchId
 *               - text
 *             properties:
 *               matchId:
 *                 type: string
 *               text:
 *                 type: string
 *                 maxLength: 500
 *               targetUserId:
 *                 type: string
 *                 description: Required if sender is admin
 *     responses:
 *       201:
 *         description: Message sent
 *       400:
 *         description: Bad request (match not completed / targetUserId missing / target user not in match)
 *       403:
 *         description: Forbidden (not match creator / not a participant / banned)
 */

/**
 * @swagger
 * /chat/{matchId}:
 *   get:
 *     summary: Get all chat threads for a match (Admin only)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of chat threads
 *       403:
 *         description: Forbidden (not the match creator admin)
 */

/**
 * @swagger
 * /chat/{matchId}/user/{userId}:
 *   get:
 *     summary: Get specific chat thread
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chat thread
 *       403:
 *         description: Forbidden (players see only their own thread, admin must be match creator)
 */
