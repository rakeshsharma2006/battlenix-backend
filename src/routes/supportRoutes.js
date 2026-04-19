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

// ── USER ROUTES ──
router.post(
  '/',
  authMiddleware,
  uploadScreenshot.array('screenshots', 3),
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
