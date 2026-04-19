/**
 * @swagger
 * /matches:
 *   get:
 *     summary: List all matches
 *     tags: [Matches]
 *     security: []
 *     responses:
 *       200:
 *         description: Matches fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Match'
 *   post:
 *     summary: Create a new match
 *     tags: [Matches]
 *     description: Admin only. Map determines maxPlayers (Erangel=100, Livik=52). Prize is auto-calculated from the fixed prize table.
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
 *                 format: date-time
 *               title:
 *                 type: string
 *                 description: Optional. Auto-generated as "Map Mode ₹Fee" if omitted.
 *     responses:
 *       201:
 *         description: Match created
 *       400:
 *         description: Invalid match payload
 *
 * /matches/{id}:
 *   get:
 *     summary: Get a single match
 *     tags: [Matches]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Match fetched successfully
 *       404:
 *         description: Match not found
 *   patch:
 *     summary: Update a match
 *     tags: [Matches]
 *     description: Admin only
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
 *     responses:
 *       200:
 *         description: Match updated
 *       400:
 *         description: Invalid update
 *       404:
 *         description: Match not found
 *   delete:
 *     summary: Cancel a match
 *     tags: [Matches]
 *     description: Admin only
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Match cancelled
 *       404:
 *         description: Match not found
 *
 * /matches/{id}/publish-room:
 *   post:
 *     summary: Publish room details and move match live
 *     tags: [Matches]
 *     description: Admin only
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
 *             required: [roomId, roomPassword]
 *             properties:
 *               roomId:
 *                 type: string
 *               roomPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Room published
 *       400:
 *         description: Match is not ready
 *
 * /matches/{id}/result:
 *   post:
 *     summary: Submit match results
 *     tags: [Matches]
 *     description: Admin only. For Duo/Squad, include winnerTeam with all team member userIds for prize splitting.
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
 *             required: [winner, results]
 *             properties:
 *               winner:
 *                 type: string
 *                 description: UserId of 1st place player
 *               winnerTeam:
 *                 type: array
 *                 description: Optional. Array of userIds for Duo/Squad winner team (1-4 members). Prize is split equally.
 *                 items:
 *                   type: string
 *               results:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     position:
 *                       type: integer
 *                     kills:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Match results submitted
 *       400:
 *         description: Invalid result payload
 */
