const SupportTicket = require('../models/SupportTicket');
const { cloudinary } = require('../config/cloudinary');
const { emitToUser } = require('../services/socketService');
const logger = require('../utils/logger');

const formatTicket = (ticket) => {
  const plain = typeof ticket.toObject === 'function' ? ticket.toObject() : ticket;
  return {
    ...plain,
    screenshotUrls: (plain.screenshots || []).map((screenshot) => screenshot.url).filter(Boolean),
  };
};

const parseDeviceInfo = (deviceInfo) => {
  if (!deviceInfo) return {};
  if (typeof deviceInfo === 'object') return deviceInfo;

  try {
    return JSON.parse(deviceInfo);
  } catch {
    return {};
  }
};

// ── USER ENDPOINTS ──

// Create new ticket
const createTicket = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      category,
      subject,
      description,
      relatedMatchId,
      relatedPaymentId,
      deviceInfo,
    } = req.body;

    // Process uploaded screenshots
    const screenshots = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        screenshots.push({
          url: file.path,
          publicId: file.filename,
        });
      }
    }

    const ticket = await SupportTicket.create({
      userId,
      category,
      subject,
      description,
      screenshots,
      relatedMatchId: relatedMatchId || null,
      relatedPaymentId: relatedPaymentId || null,
      deviceInfo: parseDeviceInfo(deviceInfo),
    });

    logger.info('Support ticket created', {
      ticketId: ticket._id,
      ticketNumber: ticket.ticketNumber,
      userId,
      category,
    });

    return res.status(201).json({
      message: 'Ticket submitted successfully',
      ticket: formatTicket(ticket),
    });
  } catch (error) {
    logger.error('createTicket error', {
      error: error.message,
    });
    return res.status(500).json({
      message: 'Failed to create ticket',
    });
  }
};

// Get user's own tickets
const getUserTickets = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const tickets = await SupportTicket
      .find({ userId })
      .select('-replies')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SupportTicket.countDocuments({ userId });

    return res.json({
      tickets: tickets.map(formatTicket),
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch tickets',
    });
  }
};

// Get single ticket with replies
const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const ticket = await SupportTicket
      .findOne({ _id: id, userId })
      .populate('relatedMatchId', 'title status')
      .populate('relatedPaymentId', 'amount status');

    if (!ticket) {
      return res.status(404).json({
        message: 'Ticket not found',
      });
    }

    return res.json({ ticket: formatTicket(ticket) });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch ticket',
    });
  }
};

// ── ADMIN ENDPOINTS ──

// Get all tickets with filters
const getAllTickets = async (req, res) => {
  try {
    const {
      status,
      category,
      priority,
      page = 1,
      limit = 20,
      search,
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;

    const tickets = await SupportTicket
      .find(filter)
      .populate('userId', 'username email trustScore')
      .populate('relatedMatchId', 'title status')
      .select('-screenshots.publicId')
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SupportTicket.countDocuments(filter);

    // Stats
    const stats = await SupportTicket.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    return res.json({
      tickets: tickets.map(formatTicket),
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      stats: stats.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {}),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch tickets',
    });
  }
};

// Admin reply to ticket
const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, status } = req.body;
    const admin = req.user;

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        message: 'Ticket not found',
      });
    }

    // Add reply
    ticket.replies.push({
      adminId: admin._id,
      adminUsername: admin.username,
      message,
      isAdminReply: true,
    });

    // Update status if provided
    if (status) {
      ticket.status = status;
      if (status === 'RESOLVED' || status === 'CLOSED') {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = admin._id;
      }
    } else if (ticket.status === 'OPEN') {
      ticket.status = 'IN_PROGRESS';
    }

    await ticket.save();

    logger.info('Admin replied to ticket', {
      ticketId: id,
      adminId: admin._id,
      newStatus: ticket.status,
    });

    emitToUser(ticket.userId.toString(), 'support_reply', {
      ticketId: ticket._id,
      ticketNumber: ticket.ticketNumber,
      message,
      adminUsername: admin.username,
      createdAt: new Date(),
    });

    return res.json({
      message: 'Reply sent',
      ticket: {
        _id: ticket._id,
        status: ticket.status,
        replies: ticket.replies,
        screenshotUrls: (ticket.screenshots || []).map((screenshot) => screenshot.url).filter(Boolean),
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to send reply',
    });
  }
};

// Update ticket status/priority
const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      { 
        $set: { 
          ...(status && { status }),
          ...(priority && { priority }),
          ...(
            (status === 'RESOLVED' || status === 'CLOSED') && {
            resolvedAt: new Date(),
            resolvedBy: req.user._id,
          }),
        }
      },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({
        message: 'Ticket not found',
      });
    }

    return res.json({
      message: 'Ticket updated',
      ticket: formatTicket(ticket),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to update ticket',
    });
  }
};

// Get stats for dashboard
const getTicketStats = async (req, res) => {
  try {
    const [statusStats, categoryStats] = await Promise.all([
      SupportTicket.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      SupportTicket.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const openCount = await SupportTicket.countDocuments({ status: 'OPEN' });
    const urgentCount = await SupportTicket.countDocuments({ 
      status: 'OPEN', 
      priority: 'URGENT' 
    });

    return res.json({
      statusStats,
      categoryStats,
      openCount,
      urgentCount,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch stats',
    });
  }
};

module.exports = {
  createTicket,
  getUserTickets,
  getTicketById,
  getAllTickets,
  replyToTicket,
  updateTicket,
  getTicketStats,
};
