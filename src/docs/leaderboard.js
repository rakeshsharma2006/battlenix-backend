/**
 * @swagger
 * /leaderboard/global:
 *   get:
 *     summary: Get the global leaderboard
 *     tags: [Leaderboard]
 *     security: []
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
 *         description: Global leaderboard fetched
 *
 * /leaderboard/weekly:
 *   get:
 *     summary: Get the weekly leaderboard
 *     tags: [Leaderboard]
 *     security: []
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
 *         description: Weekly leaderboard fetched
 *
 * /leaderboard/monthly:
 *   get:
 *     summary: Get the monthly leaderboard
 *     tags: [Leaderboard]
 *     security: []
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
 *         description: Monthly leaderboard fetched
 *
 * /leaderboard/me:
 *   get:
 *     summary: Get the authenticated user's personal rank
 *     tags: [Leaderboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Personal rank fetched
 *       401:
 *         description: Unauthorized
 */
