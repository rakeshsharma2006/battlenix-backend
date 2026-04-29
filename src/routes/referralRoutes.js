const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const validate = require('../middlewares/validationMiddleware');
const { referralSchemas } = require('../validators/schemas');
const referralController = require('../controllers/referralController');
const { validateCodeLimiter, redirectLimiter } = require('../middlewares/referralRateLimiter');

// ── Public routes ────────────────────────────────────────────────────────────

// Validate a referral code (no auth needed)
router.get(
  '/referral/validate/:code',
  validateCodeLimiter,
  referralController.validateCode
);

// Track referral click and redirect (no auth needed)
router.get(
  '/r/:code',
  redirectLimiter,
  referralController.trackReferralClick
);

// Export referral data as CSV (admin)
router.get(
  '/referral/:id/export',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams }),
  referralController.exportReferralData
);

// ── Admin routes ─────────────────────────────────────────────────────────────

// Create a new referral code
router.post(
  '/referral',
  authMiddleware,
  adminMiddleware,
  validate({ body: referralSchemas.createReferralBody }),
  referralController.createReferralCode
);

// Get all referral codes (paginated + summary)
router.get(
  '/referral',
  authMiddleware,
  adminMiddleware,
  validate({ query: referralSchemas.listQuery }),
  referralController.getAllReferralCodes
);

// Get single referral code details
router.get(
  '/referral/:id',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams }),
  referralController.getReferralCodeDetails
);

// Update editable fields
router.patch(
  '/referral/:id',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams, body: referralSchemas.updateReferralBody }),
  referralController.updateReferralCode
);

// Toggle active/inactive
router.patch(
  '/referral/:id/toggle',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams }),
  referralController.toggleReferralCode
);

// Mark commission paid
router.post(
  '/referral/:id/mark-paid',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams, body: referralSchemas.markPaidBody }),
  referralController.markCommissionPaid
);

// Generate QR code
router.get(
  '/referral/:id/qr',
  authMiddleware,
  adminMiddleware,
  validate({ params: referralSchemas.referralIdParams }),
  referralController.generateQRCode
);

module.exports = router;
