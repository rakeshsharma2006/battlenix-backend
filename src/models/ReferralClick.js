const mongoose = require('mongoose');

const referralClickSchema = new mongoose.Schema(
  {
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReferralCode',
      required: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    ip: {
      type: String,
      default: null,
    },
    country: {
      type: String,
      default: null,
    },
    city: {
      type: String,
      default: null,
    },
    deviceType: {
      type: String,
      default: null,
    },
    os: {
      type: String,
      default: null,
    },
    browser: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    clickedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

referralClickSchema.index({ code: 1, clickedAt: -1 }, { name: 'click_code_date' });

module.exports = mongoose.model('ReferralClick', referralClickSchema);
