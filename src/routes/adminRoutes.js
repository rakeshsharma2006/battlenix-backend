const express = require('express');
const router = express.Router();
const {
  listPayments,
  listRefunds,
  listMatches,
  listUsers,
  getDashboardStats,
  listFlags,
  getFlagDetails,
  reviewFlag,
  createTimeSlot,
  listTodaySlots,
  deleteTimeSlot,
  bulkCancelMatches,
} = require('../controllers/adminController');
const {
  declareWinner,
  markPaid,
  listPayouts,
  getPayoutDetail,
} = require('../controllers/payoutController');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { adminLimiter } = require('../middlewares/rateLimiters');
const { adminSchemas } = require('../validators/schemas');

router.use(authMiddleware, adminMiddleware, adminLimiter);

router.get('/dashboard', getDashboardStats);
router.get('/users', requirePermission('users.read'), validate({ query: adminSchemas.usersQuery }), listUsers);
router.get('/payments', requirePermission('payments.read'), validate({ query: adminSchemas.paymentsQuery }), listPayments);
router.get('/refunds', requirePermission('refunds.read'), validate({ query: adminSchemas.refundsQuery }), listRefunds);
router.get('/slots', requirePermission('matches.read'), listTodaySlots);
router.get('/matches', requirePermission('matches.read'), validate({ query: adminSchemas.matchesQuery }), listMatches);
router.get('/payouts', requirePermission('matches.read'), validate({ query: adminSchemas.payoutsQuery }), listPayouts);
router.get('/payouts/:payoutId', requirePermission('matches.read'), validate({ params: adminSchemas.payoutIdParams }), getPayoutDetail);
router.get('/flags', requirePermission('flags.read'), listFlags);
router.get('/flags/:userId', requirePermission('flags.read'), validate({ params: adminSchemas.flagUserIdParams }), getFlagDetails);
router.post('/slots/create', requirePermission('slots.manage'), validate({ body: adminSchemas.createSlotBody }), createTimeSlot);
router.delete('/slots/:slotId', requirePermission('slots.manage'), validate({ params: adminSchemas.slotIdParams }), deleteTimeSlot);
router.post('/matches/bulk-cancel', requirePermission('matches.manage'), validate({ body: adminSchemas.bulkCancelMatchesBody }), bulkCancelMatches);
router.post(
  '/matches/:id/declare-winner',
  requirePermission('matches.manage'),
  validate({ params: adminSchemas.matchIdParams, body: adminSchemas.declareWinnerBody }),
  declareWinner
);
router.post(
  '/matches/:id/mark-paid',
  requirePermission('matches.manage'),
  validate({ params: adminSchemas.matchIdParams, body: adminSchemas.markPaidBody }),
  markPaid
);
router.post(
  '/flags/:userId/review',
  requirePermission('flags.review'),
  validate({ params: adminSchemas.flagUserIdParams, body: adminSchemas.reviewFlagBody }),
  reviewFlag
);

module.exports = router;
