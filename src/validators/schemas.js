const { z } = require('zod');
const {
  VALID_GAMES,
  VALID_MAPS,
  VALID_MODES,
  VALID_FEES,
  getValidMapsForGame,
  inferGameFromMap,
} = require('../config/prizeConfig');

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const positiveIntStringSchema = z.coerce.number().int().min(1);
const gameSchema = z.enum(VALID_GAMES);
const mapSchema = z.enum(VALID_MAPS);
const modeSchema = z.enum(VALID_MODES);
const entryFeeSchema = z.coerce.number().refine((value) => VALID_FEES.includes(value), {
  message: `Entry fee must be ${VALID_FEES.join(', ')}`,
});

const validateGameMapPair = (value, ctx) => {
  const game = value.game || inferGameFromMap(value.map) || 'BGMI';
  const validMaps = getValidMapsForGame(game);

  if (!validMaps.includes(value.map)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['map'],
      message: `map must be one of: ${validMaps.join(', ')} for game ${game}`,
    });
  }
};

const authSchemas = {
  registerBody: z.object({
    username: z.string().trim().min(3).max(30),
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
  }).strict(),
  loginBody: z.object({
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
  }).strict(),
  refreshBody: z.object({
    refreshToken: z.string().trim().min(1),
  }).strict(),
  googleSignInBody: z.object({
    idToken: z.string().trim().min(1).optional(),
    credential: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1).optional(),
  }).strict().superRefine((data, ctx) => {
    if (!data.idToken && !data.credential && !data.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idToken'],
        message: 'Google idToken is required',
      });
    }
  }).transform((data) => ({
    idToken: data.idToken || data.credential || data.token,
  })),
  googleVerifyBody: z.object({
    idToken: z.string().trim().min(1).optional(),
    credential: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1).optional(),
    googleToken: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    googleId: z.string().trim().min(1).optional(),
  }).strict().superRefine((data, ctx) => {
    if (!data.idToken && !data.credential && !data.token && !data.googleToken && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idToken'],
        message: 'Either a Google token or email is required',
      });
    }
  }),
};

const paymentSchemas = {
  createOrderBody: z.object({
    matchId: objectIdSchema.optional(),
    entryFee: z.coerce.number().min(0).optional(),
  }).superRefine((data, ctx) => {
    if (!data.matchId && data.entryFee === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['matchId'],
        message: 'Either matchId or entryFee is required',
      });
    }

    if (data.entryFee !== undefined && data.entryFee !== 0 && !VALID_FEES.includes(data.entryFee)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entryFee'],
        message: `Entry fee must be ${VALID_FEES.join(', ')}, or 0 when joining a free match by matchId`,
      });
    }

    if (!data.matchId && data.entryFee === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entryFee'],
        message: `Standalone entry fee must be ${VALID_FEES.join(', ')}`,
      });
    }
  }),
  verifyPaymentBody: z.object({
    razorpay_order_id: z.string().trim().min(1),
    razorpay_payment_id: z.string().trim().min(1),
    razorpay_signature: z.string().trim().min(1),
  }),
};

const matchmakingBaseSchema = z.object({
  game: gameSchema.optional(),
  map: mapSchema,
  mode: modeSchema,
});

const matchmakingSchemas = {
  slotsQuery: matchmakingBaseSchema.superRefine(validateGameMapPair),
  joinRandom: matchmakingBaseSchema.extend({
    entryFee: entryFeeSchema,
    paymentId: objectIdSchema,
  }).superRefine(validateGameMapPair),
  joinFriendsRoom: z.object({
    slotCode: z.string().trim().length(6).transform((value) => value.toUpperCase()),
    paymentId: objectIdSchema,
  }),
};

const matchSchemas = {
  matchIdParams: z.object({
    id: objectIdSchema,
  }),
  createMatchBody: z.object({
    game: gameSchema.optional(),
    map: mapSchema,
    mode: modeSchema,
    entryType: z.enum(['FREE', 'PAID']).default('PAID').optional(),
    entryFee: z.coerce.number().min(0).optional(),
    maxPlayers: z.coerce.number().int().min(2).max(100),
    customPrize: z.coerce.number().min(0).nullable().optional(),
    prizeBreakdown: z.object({
      playerPrize: z.number().min(0),
      managerCut: z.number().min(0),
      adminCut: z.number().min(0),
    }).optional(),
    startTime: z.string().datetime({ offset: true }).or(z.string().min(1)),
    title: z.string().trim().max(100).optional(),
  }).superRefine((data, ctx) => {
    validateGameMapPair(data, ctx);
    if (data.entryType === 'FREE') {
      if (data.entryFee !== undefined && data.entryFee !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryFee'],
          message: 'Entry fee must be 0 for FREE matches'
        });
      } else {
        data.entryFee = 0;
      }
    } else {
      if (![20, 30, 50, 100].includes(data.entryFee)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entryFee'],
          message: 'Entry fee must be 20, 30, 50, or 100 for PAID matches'
        });
      }
    }
  }),
  updateMatchBody: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    game: gameSchema.optional(),
    entryFee: z.coerce.number().min(0).optional(),
    maxPlayers: z.coerce.number().int().min(2).max(100).optional(),
    startTime: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    status: z.enum(['CANCELLED']).optional(),
  }).strict(),
  statusBody: z.object({
    status: z.enum(['UPCOMING', 'READY', 'LIVE', 'COMPLETED', 'CANCELLED']),
  }),
  chatToggleBody: z.object({
    enabled: z.boolean(),
  }),
  publishRoomBody: z.object({
    roomId: z.string().trim().min(1).max(100),
    roomPassword: z.string().trim().min(1).max(100),
  }),
  submitResultBody: z.object({
    winner: objectIdSchema,
    winnerTeam: z.array(objectIdSchema).min(1).max(4).optional(),
    results: z.array(z.object({
      userId: objectIdSchema,
      position: z.number().int().min(1),
      kills: z.number().int().min(0),
    })).min(1),
  }),
};

const adminSchemas = {
  paymentsQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
    search: z.string().trim().max(100).optional(),
  }),
  refundsQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    refundStatus: z.enum(['PENDING', 'PROCESSED', 'FAILED']).optional(),
  }),
  matchesQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['UPCOMING', 'READY', 'LIVE', 'COMPLETED', 'CANCELLED']).optional(),
    game: gameSchema.optional(),
    search: z.string().trim().max(100).optional(),
  }),
  usersQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
  }),
  reviewFlagBody: z.object({
    action: z.enum(['clear', 'ban']),
    adminNote: z.string().trim().min(1).max(500),
  }),
  createSlotBody: z.object({
    game: gameSchema.optional(),
    map: mapSchema,
    mode: modeSchema,
    entryFee: entryFeeSchema,
    startTime: z.string().min(1, 'startTime is required'),
  }).superRefine(validateGameMapPair),
  slotIdParams: z.object({
    slotId: objectIdSchema,
  }),
  matchIdParams: z.object({
    id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid match id'),
  }),
  payoutIdParams: z.object({
    payoutId: objectIdSchema,
  }),
  flagUserIdParams: z.object({
    userId: objectIdSchema,
  }),
  payoutsQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'PAID']).optional(),
  }),
  declareWinnerBody: z.object({
    winnerId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid winnerId'),
    prizeAmount: z.coerce.number().min(0).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  markPaidBody: z.object({
    notes: z.string().trim().max(500).optional(),
  }).default({}),
  withdrawQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID']).optional(),
  }),
  withdrawIdParams: z.object({
    id: objectIdSchema,
  }),
  withdrawRejectBody: z.object({
    adminNote: z.string().trim().max(500).optional(),
  }),
  bulkApproveBody: z.object({
    requestIds: z.array(objectIdSchema).min(1).max(100),
  }),
  bulkCancelMatchesBody: z.object({
    matchIds: z.array(objectIdSchema).min(1).max(100),
  }),
};

const leaderboardSchemas = {
  listQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};

const playerSchemas = {
  matchHistoryQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
   // playerSchemas mein change karo
  updateProfileBody: z.object({
  username: z.string().trim().max(30).optional(),
  // ✅ FIX: gameUid → gameUID (Flutter se match karo)
  gameUID: z.string().trim().max(50).optional(),
  gameName: z.string().trim().max(50).optional(),
  upiId: z.string().trim().min(5).max(100).optional(),
}).strict(),
  playerIdParams: z.object({
    userId: objectIdSchema,
  }),
};

const walletSchemas = {
  transactionQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

const withdrawSchemas = {
  requestBody: z.object({
    amount: z.coerce.number().min(50, 'Minimum withdrawal is Rs 50'),
    upiId: z.string().trim().min(5).max(100),
  }).strict(),
  listQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

const chatSchemas = {
  sendMessageBody: z.object({
    matchId: objectIdSchema,
    text: z.string().trim().min(1).max(500),
    targetUserId: objectIdSchema.optional(),
  }),
  matchMessageBody: z.object({
    message: z.string().trim().min(1).max(500).optional(),
    text: z.string().trim().min(1).max(500).optional(),
  }).refine((data) => {
    const message = data.message?.trim() || data.text?.trim();
    return Boolean(message);
  }, {
    message: 'message is required',
  }),
  matchIdParams: z.object({
    matchId: objectIdSchema,
  }),
  chatParams: z.object({
    matchId: objectIdSchema,
    userId: objectIdSchema,
  }),
};

module.exports = {
  authSchemas,
  paymentSchemas,
  matchmakingSchemas,
  matchSchemas,
  adminSchemas,
  leaderboardSchemas,
  playerSchemas,
  walletSchemas,
  withdrawSchemas,
  chatSchemas,
};
