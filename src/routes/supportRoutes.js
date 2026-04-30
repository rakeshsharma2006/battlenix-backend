const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');
const { uploadScreenshot } = require('../config/cloudinary');
const {
  createTicket,
  getUserTickets,
  getTicketById,
  getAllTickets,
  replyToTicket,
  updateTicket,
  getTicketStats,
} = require('../controllers/supportController');

const handleScreenshotUpload = (req, res, next) => {
  uploadScreenshot.array('screenshots', 3)(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        message: error.message || 'Screenshot upload failed',
      });
    }

    next();
  });
};

// ── USER ROUTES ──
router.post(
  '/',
  authMiddleware,
  handleScreenshotUpload,
  createTicket
);

router.get(
  '/my-tickets',
  authMiddleware,
  getUserTickets
);

router.get(
  '/my-tickets/:id',
  authMiddleware,
  getTicketById
);

// ── ADMIN ROUTES ──
router.get(
  '/admin/all',
  authMiddleware,
  adminMiddleware,
  getAllTickets
);

router.get(
  '/admin/stats',
  authMiddleware,
  adminMiddleware,
  getTicketStats
);

router.post(
  '/admin/:id/reply',
  authMiddleware,
  adminMiddleware,
  replyToTicket
);

router.patch(
  '/admin/:id',
  authMiddleware,
  adminMiddleware,
  updateTicket
);

module.exports = router;
