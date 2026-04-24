/**
 * @swagger
 * /player/me:
 *   get:
 *     summary: Get the authenticated player's profile
 *     tags: [Player]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Player profile with stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 profile:
 *                   allOf:
 *                     - $ref: '#/components/schemas/User'
 *                     - type: object
 *                       properties:
 *                         stats:
 *                           $ref: '#/components/schemas/PlayerStats'
 *
 * /player/me/profile:
 *   patch:
 *     summary: Update the authenticated player's payout profile
 *     tags: [Player]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               gameUID:
 *                 type: string
 *               gameName:
 *                 type: string
 *               upiId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *
 * /player/me/matches:
 *   get:
 *     summary: Get the authenticated player's match history
 *     tags: [Player]
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
 *         description: Match history fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 matches:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *
 * /player/{userId}:
 *   get:
 *     summary: Get a public player profile
 *     tags: [Player]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Public player profile
 *       404:
 *         description: User not found
 */
