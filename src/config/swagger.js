const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BattleNix API',
      version: '1.0.0',
      description: 'Battle Royale Tournament Backend API',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            pages: { type: 'integer' },
          },
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            username: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['user', 'manager', 'admin'] },
            trustScore: { type: 'number' },
            isFlagged: { type: 'boolean' },
            isBanned: { type: 'boolean' },
            gameUID: { type: 'string', nullable: true },
            gameName: { type: 'string', nullable: true },
            upiId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Match: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            title: { type: 'string' },
            game: { type: 'string' },
            entryFee: { type: 'number' },
            maxPlayers: { type: 'integer' },
            playersCount: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['UPCOMING', 'READY', 'LIVE', 'COMPLETED', 'CANCELLED'],
            },
            startTime: { type: 'string', format: 'date-time' },
            winner: { type: 'string', nullable: true },
            createdBy: { type: 'string', nullable: true, description: 'Admin who created the match' },
          },
        },
        PlayerStats: {
          type: 'object',
          properties: {
            totalPoints: { type: 'number' },
            totalWins: { type: 'integer' },
            totalKills: { type: 'integer' },
            totalMatches: { type: 'integer' },
            weeklyPoints: { type: 'number' },
            monthlyPoints: { type: 'number' },
            lastMatchAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [require('path').join(__dirname, '../docs/*.js')],
};

module.exports = swaggerJsdoc(options);
