const { z } = require('zod');

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const positiveIntStringSchema = z.coerce.number().int().min(1);

const authSchemas = {
  registerBody: z.object({
    username: z.string().trim().min(3).max(30),
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
  }),
  loginBody: z.object({
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
  }),
};

const paymentSchemas = {
  createOrderBody: z.object({
    matchId: objectIdSchema,
  }),
  verifyPaymentBody: z.object({
    razorpay_order_id: z.string().trim().min(1),
    razorpay_payment_id: z.string().trim().min(1),
    razorpay_signature: z.string().trim().min(1),
  }),
};

const resultEntrySchema = z.object({
  userId: objectIdSchema,
  position: z.coerce.number().int().min(1),
  kills: z.coerce.number().int().min(0).default(0),
});

const matchSchemas = {
  matchIdParams: z.object({
    id: objectIdSchema,
  }),
  createMatchBody: z.object({
    title: z.string().trim().min(1).max(120),
    game: z.string().trim().min(1).max(120),
    entryFee: z.coerce.number().min(0),
    maxPlayers: z.coerce.number().int().min(1).max(1000),
    startTime: z.string().datetime({ offset: true }).or(z.string().datetime()),
  }),
  updateMatchBody: z.object({
    title: z.string().trim().min(1).max(120).optional(),
    game: z.string().trim().min(1).max(120).optional(),
    entryFee: z.coerce.number().min(0).optional(),
    maxPlayers: z.coerce.number().int().min(1).max(1000).optional(),
    startTime: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
    status: z.enum(['CANCELLED']).optional(),
  }).strict(),
  publishRoomBody: z.object({
    roomId: z.string().trim().min(1).max(100),
    roomPassword: z.string().trim().min(1).max(100),
  }),
  submitResultBody: z.object({
    winner: objectIdSchema,
    results: z.array(resultEntrySchema).min(1),
  }),
};

const adminSchemas = {
  paymentsQuery: z.object({
    page: positiveIntStringSchema.default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
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
  }),
};

module.exports = {
  authSchemas,
  paymentSchemas,
  matchSchemas,
  adminSchemas,
};
