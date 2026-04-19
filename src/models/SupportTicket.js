const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ticketNumber: {
      type: String,
      unique: true,
      // Auto generated: BN-2026-001
    },
    category: {
      type: String,
      enum: [
        'PAYMENT_FAILED',
        'PAYMENT_DEDUCTED',
        'APP_CRASH',
        'ROOM_NOT_RECEIVED',
        'PRIZE_NOT_RECEIVED',
        'ACCOUNT_ISSUE',
        'MATCH_ISSUE',
        'REFUND_REQUEST',
        'OTHER',
      ],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    screenshots: [
      {
        url: String,       // Cloudinary URL
        publicId: String,  // For deletion
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      enum: [
        'OPEN',
        'IN_PROGRESS', 
        'RESOLVED',
        'CLOSED',
      ],
      default: 'OPEN',
      index: true,
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
      default: 'MEDIUM',
    },
    // Admin replies
    replies: [
      {
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        adminUsername: String,
        message: String,
        isAdminReply: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Related data
    relatedMatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      default: null,
    },
    relatedPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    // User device info
    deviceInfo: {
      platform: String,  // android/ios
      appVersion: String,
      deviceModel: String,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Auto generate ticket number
supportTicketSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('SupportTicket').countDocuments();
    const year = new Date().getFullYear();
    this.ticketNumber = `BN-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Auto set priority based on category
supportTicketSchema.pre('save', function(next) {
  if (this.isNew) {
    const highPriority = [
      'PAYMENT_DEDUCTED',
      'PRIZE_NOT_RECEIVED', 
      'REFUND_REQUEST',
    ];
    const urgentPriority = [
      'PAYMENT_FAILED',
    ];
    
    if (urgentPriority.includes(this.category)) {
      this.priority = 'URGENT';
    } else if (highPriority.includes(this.category)) {
      this.priority = 'HIGH';
    }
  }
  next();
});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
