const QRCode = require('qrcode');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');

const ReferralCode = require('../models/ReferralCode');
const ReferralClick = require('../models/ReferralClick');
const CreatorPayout = require('../models/CreatorPayout');
const ReferralCommissionLog = require('../models/ReferralCommissionLog');
const ReferralActivityLog = require('../models/ReferralActivityLog');
const MatchResult = require('../models/MatchResult');
const User = require('../models/User');
const logger = require('../utils/logger');

// ── Helpers ──────────────────────────────────────────────────────────────────

const REFERRAL_BASE_URL = process.env.REFERRAL_BASE_URL || 'https://yourdomain.com';
const APP_DOWNLOAD_URL = process.env.APP_DOWNLOAD_URL || 'https://yourdomain.com/download';
const PLAYSTORE_PACKAGE = process.env.PLAYSTORE_PACKAGE || 'com.battlenix.app';

const buildReferralLink = (code) => `${REFERRAL_BASE_URL}/r/${code}`;

const isCodeExpired = (referral) =>
  referral.expiresAt && new Date(referral.expiresAt) < new Date();

const isCodeUsable = (referral) =>
  referral && referral.isActive && !isCodeExpired(referral);

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.connection?.remoteAddress || req.ip || null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN METHODS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Create a new referral code
const createReferralCode = async (req, res) => {
  try {
    const {
      code,
      creatorName,
      channelName,
      platform,
      channelUrl,
      commissionModel,
      commissionPerUser,
      commissionPercent,
      rewardCoinsToUser,
      rewardCashToUser,
      expiresAt,
      notes,
    } = req.body;

    if (code === undefined || code === null || typeof code !== 'string') {
      return res.status(400).json({ message: 'Code is required and must be a string' });
    }
    const normalizedCode = String(code).toUpperCase().trim();

    const existing = await ReferralCode.findOne({ code: normalizedCode });
    if (existing) {
      return res.status(409).json({ message: 'Referral code already exists' });
    }

    const referral = await ReferralCode.create({
      code: normalizedCode,
      creatorName,
      channelName: channelName || null,
      platform: platform || 'OTHER',
      channelUrl: channelUrl || null,
      createdBy: req.user._id,
      commissionModel: commissionModel || 'PER_FIRST_MATCH',
      commissionPerUser: commissionPerUser || 0,
      commissionPercent: commissionPercent || 0,
      rewardCoinsToUser: rewardCoinsToUser || 0,
      rewardCashToUser: rewardCashToUser || 0,
      expiresAt: expiresAt || null,
      notes: notes || null,
    });

    logger.info('Referral code created', {
      code: referral.code,
      creatorName: referral.creatorName,
      createdBy: req.user._id,
    });

    ReferralActivityLog.create({
      referralCodeId: referral._id,
      code: referral.code,
      event: 'CODE_CREATED',
      actorId: req.user._id,
      metadata: { creatorName: referral.creatorName, commissionModel: referral.commissionModel },
    }).catch((err) => {
      logger.error('Failed to log CODE_CREATED activity', { error: err.message });
    });

    return res.status(201).json({
      message: 'Referral code created successfully',
      referral,
    });
  } catch (error) {
    logger.error('createReferralCode error', { error: error.message });
    return res.status(500).json({ message: 'Failed to create referral code', error: error.message });
  }
};

// 2. Get all referral codes (paginated + summary)
const getAllReferralCodes = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const [codes, totalCodes] = await Promise.all([
      ReferralCode.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReferralCode.countDocuments(),
    ]);

    // Compute per-code analytics
    const enrichedCodes = codes.map((c) => ({
      ...c,
      pendingCommission: (c.totalCommissionEarned || 0) - (c.totalCommissionPaid || 0),
      ctr: c.totalClicks > 0 ? ((c.totalSignups / c.totalClicks) * 100).toFixed(2) + '%' : '0%',
      signupRate: c.totalClicks > 0 ? ((c.totalSignups / c.totalClicks) * 100).toFixed(2) + '%' : '0%',
      avgRevenuePerUser: c.totalSignups > 0 ? (c.totalRevenue / c.totalSignups).toFixed(2) : '0.00',
    }));

    // Summary stats across ALL codes (not just current page)
    const summaryPipeline = await ReferralCode.aggregate([
      {
        $group: {
          _id: null,
          totalCodes: { $sum: 1 },
          activeCodes: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalClicks: { $sum: '$totalClicks' },
          totalSignups: { $sum: '$totalSignups' },
          totalRevenue: { $sum: '$totalRevenue' },
          totalCommissionEarned: { $sum: '$totalCommissionEarned' },
          totalCommissionPaid: { $sum: '$totalCommissionPaid' },
        },
      },
    ]);

    const summary = summaryPipeline[0] || {
      totalCodes: 0,
      activeCodes: 0,
      totalClicks: 0,
      totalSignups: 0,
      totalRevenue: 0,
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
    };

    summary.totalPendingCommission = (summary.totalCommissionEarned || 0) - (summary.totalCommissionPaid || 0);
    summary.conversionRate = summary.totalClicks > 0
      ? ((summary.totalSignups / summary.totalClicks) * 100).toFixed(2) + '%'
      : '0%';

    return res.status(200).json({
      message: 'Referral codes retrieved',
      summary,
      codes: enrichedCodes,
      pagination: {
        page,
        limit,
        totalCodes,
        totalPages: Math.ceil(totalCodes / limit),
      },
    });
  } catch (error) {
    logger.error('getAllReferralCodes error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch referral codes', error: error.message });
  }
};

// 3. Get detailed info for a single referral code
const getReferralCodeDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await ReferralCode.findById(id).lean();
    if (!referral) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    // Referred users
    const referredUsers = await User.find({ referralCodeId: id })
      .select('username email referredAt firstMatchPlayedAt isReferralRewardGiven fraudFlags createdAt')
      .sort({ createdAt: -1 })
      .lean();

    // Payout history
    const payouts = await CreatorPayout.find({ referralCodeId: id })
      .sort({ paidAt: -1 })
      .lean();

    // Click trend (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const clickTrend = await ReferralClick.aggregate([
      {
        $match: {
          referralCodeId: referral._id,
          clickedAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$clickedAt' },
          },
          clicks: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    referral.pendingCommission = (referral.totalCommissionEarned || 0) - (referral.totalCommissionPaid || 0);

    // Enhanced analytics
    const totalClicks = await ReferralClick.countDocuments({ referralCodeId: referral._id });
    const totalSignups = referral.totalSignups || 0;
    const totalFirstMatches = referral.totalFirstMatches || 0;
    const totalRevenue = referral.totalRevenue || 0;
    const totalCommission = referral.totalCommissionEarned || 0;

    const analytics = {
      clickToSignupRate: totalClicks > 0
        ? ((totalSignups / totalClicks) * 100).toFixed(1) + '%' : '0%',
      signupToFirstMatchRate: totalSignups > 0
        ? ((totalFirstMatches / totalSignups) * 100).toFixed(1) + '%' : '0%',
      avgRevenuePerUser: totalSignups > 0
        ? (totalRevenue / totalSignups).toFixed(2) : '0',
      avgCommissionPerUser: totalSignups > 0
        ? (totalCommission / totalSignups).toFixed(2) : '0',
    };

    return res.status(200).json({
      message: 'Referral code details',
      referral,
      referredUsers,
      payouts,
      clickTrend,
      analytics,
    });
  } catch (error) {
    logger.error('getReferralCodeDetails error', { error: error.message });
    return res.status(500).json({ message: 'Failed to fetch referral details', error: error.message });
  }
};

// 4. Update editable fields
const updateReferralCode = async (req, res) => {
  try {
    const { id } = req.params;

    const allowedFields = [
      'creatorName', 'channelName', 'platform', 'channelUrl',
      'commissionModel', 'commissionPerUser', 'commissionPercent',
      'rewardCoinsToUser', 'rewardCashToUser', 'expiresAt', 'notes',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const referral = await ReferralCode.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!referral) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    logger.info('Referral code updated', { code: referral.code, updates: Object.keys(updates) });

    return res.status(200).json({
      message: 'Referral code updated',
      referral,
    });
  } catch (error) {
    logger.error('updateReferralCode error', { error: error.message });
    return res.status(500).json({ message: 'Failed to update referral code', error: error.message });
  }
};

// 5. Toggle active/inactive
const toggleReferralCode = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await ReferralCode.findById(id);
    if (!referral) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    referral.isActive = !referral.isActive;
    await referral.save();

    logger.info('Referral code toggled', { code: referral.code, isActive: referral.isActive });

    if (!referral.isActive) {
      ReferralActivityLog.create({
        referralCodeId: referral._id,
        code: referral.code,
        event: 'CODE_DISABLED',
        actorId: req.user._id,
      }).catch((err) => {
        logger.error('Failed to log CODE_DISABLED activity', { error: err.message });
      });
    }

    return res.status(200).json({
      message: `Referral code ${referral.isActive ? 'activated' : 'deactivated'}`,
      referral,
    });
  } catch (error) {
    logger.error('toggleReferralCode error', { error: error.message });
    return res.status(500).json({ message: 'Failed to toggle referral code', error: error.message });
  }
};

// 6. Mark commission paid (create payout entry)
const markCommissionPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, method, transactionRef, notes } = req.body;

    const referral = await ReferralCode.findOneAndUpdate(
      { 
        _id: id, 
        $expr: { $gte: [{ $subtract: ["$totalCommissionEarned", "$totalCommissionPaid"] }, amount] }
      },
      { $inc: { totalCommissionPaid: amount } },
      { new: true }
    );

    if (!referral) {
      const existing = await ReferralCode.findById(id);
      if (!existing) return res.status(404).json({ message: 'Referral code not found' });
      const pendingCommission = (existing.totalCommissionEarned || 0) - (existing.totalCommissionPaid || 0);
      return res.status(400).json({
        message: `Payout amount (${amount}) exceeds pending commission (${pendingCommission.toFixed(2)})`,
      });
    }

    try {
      const payout = await CreatorPayout.create({
        referralCodeId: referral._id,
        code: referral.code,
        creatorName: referral.creatorName,
        amount,
        method: method || 'UPI',
        transactionRef: transactionRef || null,
        notes: notes || null,
        paidBy: req.user._id,
      });

      logger.info('payout_recorded', {
        code: referral.code,
        amount,
        method: payout.method,
        paidBy: req.user._id,
      });

      ReferralActivityLog.create({
        referralCodeId: referral._id,
        code: referral.code,
        event: 'PAYOUT_MARKED_PAID',
        actorId: req.user._id,
        metadata: { amount, method: payout.method, transactionRef },
      }).catch((err) => {
        logger.error('Failed to log PAYOUT_MARKED_PAID activity', { error: err.message });
      });

      return res.status(201).json({
        message: 'Payout recorded successfully',
        payout,
      });
    } catch (createErr) {
      // rollback
      await ReferralCode.findByIdAndUpdate(id, { $inc: { totalCommissionPaid: -amount } });
      throw createErr;
    }
  } catch (error) {
    logger.error('markCommissionPaid error', { error: error.message });
    return res.status(500).json({ message: 'Failed to record payout', error: error.message });
  }
};

// 7. Generate QR code for referral link
const generateQRCode = async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await ReferralCode.findById(id).select('code').lean();
    if (!referral) {
      return res.status(404).json({ message: 'Referral code not found' });
    }

    const link = buildReferralLink(referral.code);
    const qrCodeBase64 = await QRCode.toDataURL(link, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return res.status(200).json({
      message: 'QR code generated',
      link,
      qrCode: qrCodeBase64,
    });
  } catch (error) {
    logger.error('generateQRCode error', { error: error.message });
    return res.status(500).json({ message: 'Failed to generate QR code', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

// 8. Validate a referral code (public)
const validateCode = async (req, res) => {
  try {
    const code = (req.params.code || '').toUpperCase().trim();

    const referral = await ReferralCode.findOne({ code })
      .select('code creatorName isActive expiresAt rewardCoinsToUser rewardCashToUser')
      .lean();

    if (!referral || !isCodeUsable(referral)) {
      return res.status(200).json({
        valid: false,
        message: referral ? 'Referral code is inactive or expired' : 'Referral code not found',
      });
    }

    return res.status(200).json({
      valid: true,
      creatorName: referral.creatorName,
      rewardCoins: referral.rewardCoinsToUser || 0,
      rewardCash: referral.rewardCashToUser || 0,
    });
  } catch (error) {
    logger.error('validateCode error', { error: error.message });
    return res.status(500).json({ valid: false, message: 'Validation failed' });
  }
};

// 9. Track a referral click and redirect
const trackReferralClick = async (req, res) => {
  // Validate redirect URL once
  const safeUrl = process.env.APP_DOWNLOAD_URL
    || 'https://play.google.com/store/apps/details?id=com.battlenix';

  try {
    new URL(safeUrl);
  } catch {
    return res.status(500).json({ message: 'Redirect URL not configured' });
  }

  try {
    const code = (req.params.code || '').toUpperCase().trim();

    const referral = await ReferralCode.findOne({ code }).select('_id code isActive expiresAt').lean();

    if (!referral || !isCodeUsable(referral)) {
      logger.warn('Referral click for invalid/inactive code', { code });
      return res.redirect(302, safeUrl);
    }

    const hasConsent = req.headers.cookie?.includes('consent_analytics=true') || req.query.consent === 'true';
    if (!hasConsent) {
      logger.info('Skipping referral click tracking due to lack of consent', { code });
      // Still increment totalClicks
      ReferralCode.findByIdAndUpdate(referral._id, {
        $inc: { totalClicks: 1 },
      }).catch((err) => {
        logger.error('Failed to increment totalClicks', { code, error: err.message });
      });

      return res.redirect(302, safeUrl);
    }

    // Parse user agent
    const ua = new UAParser(req.headers['user-agent'] || '');
    const uaResult = ua.getResult();

    // Geo lookup
    const ip = getClientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;

    let anonymizedIp = null;
    if (ip) {
      if (ip.includes('.')) {
        anonymizedIp = ip.split('.').slice(0, 3).join('.') + '.0';
      } else if (ip.includes(':')) {
        anonymizedIp = ip.split(':').slice(0, 4).join(':') + '::';
      } else {
        anonymizedIp = ip;
      }
    }

    // Save click record (fire-and-forget for performance)
    ReferralClick.create({
      referralCodeId: referral._id,
      code: referral.code,
      ip: anonymizedIp,
      country: geo?.country || null,
      city: geo?.city || null,
      deviceType: uaResult.device?.type || 'desktop',
      os: uaResult.os?.name || null,
      browser: uaResult.browser?.name || null,
      userAgent: req.headers['user-agent'] || null,
    }).catch((err) => {
      logger.error('Failed to save referral click', { code, error: err.message });
    });

    // Atomic increment totalClicks
    ReferralCode.findByIdAndUpdate(referral._id, {
      $inc: { totalClicks: 1 },
    }).catch((err) => {
      logger.error('Failed to increment totalClicks', { code, error: err.message });
    });

    logger.info('click_tracked', {
      code,
      ip: ip || 'unknown',
      country: geo?.country || 'unknown',
    });

    return res.redirect(302, safeUrl);
  } catch (error) {
    logger.error('trackReferralClick error', { error: error.message });
    return res.redirect(302, safeUrl);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// REFERRAL ATTRIBUTION HELPER (used by payment flow)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process referral commission when a referred user joins their first paid match.
 * Called from the payment settlement flow.
 *
 * IMPORTANT: Referral errors must NEVER fail the payment flow.
 * This function catches all errors internally.
 */
const processReferralCommission = async ({ userId, entryFee, paymentId, matchId }) => {
  try {
    // Deduplication: skip if this payment already generated a commission
    if (paymentId) {
      const existingLog = await ReferralCommissionLog.findOne({ paymentId });
      if (existingLog) {
        logger.info('commission_skipped_duplicate', {
          paymentId,
          existingLogId: existingLog._id,
        });
        return;
      }
    }

    const user = await User.findById(userId)
      .select('referralCodeId firstMatchPlayedAt isReferralRewardGiven')
      .lean();

    if (!user || !user.referralCodeId) {
      return; // Not a referred user
    }

    const referral = await ReferralCode.findById(user.referralCodeId).lean();
    if (!referral) {
      return;
    }

    const isFirstMatch = !user.firstMatchPlayedAt;

    // Track first match
    if (isFirstMatch) {
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, firstMatchPlayedAt: null },
        { $set: { firstMatchPlayedAt: new Date() } },
        { new: false }
      );

      if (updatedUser) {
        await ReferralCode.findByIdAndUpdate(referral._id, {
          $inc: { totalFirstMatches: 1 },
        });
      }
    }

    // Calculate commission
    let commission = 0;

    if (referral.commissionModel === 'PER_FIRST_MATCH' && isFirstMatch) {
      commission = referral.commissionPerUser || 0;
    } else if (referral.commissionModel === 'PERCENT_REVENUE') {
      commission = (entryFee * (referral.commissionPercent || 0)) / 100;
    } else if (referral.commissionModel === 'HYBRID') {
      if (isFirstMatch) {
        commission += referral.commissionPerUser || 0;
      }
      commission += (entryFee * (referral.commissionPercent || 0)) / 100;
    }

    // Update referral stats atomically
    const incUpdates = {
      totalMatchesPlayed: 1,
      totalRevenue: entryFee,
    };
    if (commission > 0) {
      incUpdates.totalCommissionEarned = commission;
    }

    await ReferralCode.findByIdAndUpdate(referral._id, {
      $inc: incUpdates,
    });

    // Write commission log + activity log
    if (commission > 0 && paymentId) {
      await ReferralCommissionLog.create({
        userId,
        paymentId,
        matchId: matchId || null,
        referralCodeId: referral._id,
        code: referral.code,
        commissionModel: referral.commissionModel,
        entryFee,
        commissionAmount: commission,
        isFirstMatch,
        status: 'CREATED',
      });

      ReferralActivityLog.create({
        referralCodeId: referral._id,
        code: referral.code,
        event: 'COMMISSION_CREATED',
        metadata: { userId, paymentId, commission, isFirstMatch },
      }).catch((err) => {
        logger.error('Failed to log COMMISSION_CREATED activity', { error: err.message });
      });

      logger.info('commission_created', {
        paymentId,
        code: referral.code,
        commissionAmount: commission,
        isFirstMatch,
      });
    } else if (commission > 0) {
      logger.info('commission_created', {
        code: referral.code,
        userId,
        entryFee,
        commission,
        isFirstMatch,
        commissionModel: referral.commissionModel,
      });
    }

    // Grant user reward once (mark as given)
    if (isFirstMatch && !user.isReferralRewardGiven) {
      const hasReward = (referral.rewardCashToUser || 0) > 0 || (referral.rewardCoinsToUser || 0) > 0;
      if (hasReward) {
        const updateDoc = {
          $set: { isReferralRewardGiven: true },
        };
        const cashInc = referral.rewardCashToUser || 0;
        const coinInc = referral.rewardCoinsToUser || 0;
        if (cashInc > 0 || coinInc > 0) {
          updateDoc.$inc = {};
          if (cashInc > 0) updateDoc.$inc.cashBalance = cashInc;
          if (coinInc > 0) updateDoc.$inc.coinBalance = coinInc;
        }
        
        await User.findByIdAndUpdate(userId, updateDoc);

        logger.info('Referral reward granted to user', {
          userId,
          code: referral.code,
          rewardCash: referral.rewardCashToUser,
          rewardCoins: referral.rewardCoinsToUser,
        });
      }
    }
  } catch (error) {
    // IMPORTANT: Never let referral errors break the payment flow
    logger.error('processReferralCommission error (non-fatal)', {
      userId,
      entryFee,
      error: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const exportReferralData = async (req, res) => {
  try {
    const referral = await ReferralCode.findById(req.params.id).lean();
    if (!referral) {
      return res.status(404).json({ message: 'Referral not found' });
    }

    const users = await User.find({ referralCodeId: referral._id })
      .select('username email upiId createdAt fraudFlags')
      .lean();

    const userIds = users.map((u) => u._id);

    const [matchResults, commissionLogs] = await Promise.all([
      MatchResult.aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: {
          _id: '$userId',
          matchesPlayed: { $sum: 1 },
          revenue: { $sum: '$pointsEarned' },
        }},
      ]),
      ReferralCommissionLog.aggregate([
        { $match: {
          userId: { $in: userIds },
          referralCodeId: referral._id,
        }},
        { $group: {
          _id: '$userId',
          commissionGenerated: { $sum: '$commissionAmount' },
        }},
      ]),
    ]);

    const matchMap = new Map(matchResults.map((r) => [String(r._id), r]));
    const commissionMap = new Map(commissionLogs.map((r) => [String(r._id), r]));

    const headers = [
      'username', 'email', 'upiId', 'joinedAt',
      'matchesPlayed', 'revenue', 'commissionGenerated', 'fraudFlags',
    ].join(',');

    const rows = users.map((user) => {
      const uid = String(user._id);
      const match = matchMap.get(uid) || {};
      const commission = commissionMap.get(uid) || {};
      return [
        user.username || '',
        user.email || '',
        user.upiId || '',
        user.createdAt?.toISOString() || '',
        match.matchesPlayed || 0,
        match.revenue || 0,
        commission.commissionGenerated || 0,
        (user.fraudFlags || []).join('|'),
      ].map((v) => {
        let str = String(v).replace(/"/g, '""');
        if (/^[=+-\@]/.test(str)) {
          str = "'" + str;
        }
        return `"${str}"`;
      }).join(',');
    });

    const csv = [headers, ...rows].join('\n');

    ReferralActivityLog.create({
      referralCodeId: referral._id,
      code: referral.code,
      event: 'EXPORT_GENERATED',
      actorId: req.user._id,
      metadata: { userCount: users.length },
    }).catch((err) => {
      logger.error('Failed to log EXPORT_GENERATED activity', { error: err.message });
    });

    logger.info('export_generated', {
      referralId: referral._id,
      code: referral.code,
      userCount: users.length,
      actorId: req.user._id,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="referral_${referral.code}_${Date.now()}.csv"`
    );
    return res.send(csv);
  } catch (error) {
    logger.error('exportReferralData error', { error: error.message });
    return res.status(500).json({ message: 'Export failed' });
  }
};

module.exports = {
  // Admin
  createReferralCode,
  getAllReferralCodes,
  getReferralCodeDetails,
  updateReferralCode,
  toggleReferralCode,
  markCommissionPaid,
  generateQRCode,
  exportReferralData,
  // Public
  validateCode,
  trackReferralClick,
  // Helper for payment flow
  processReferralCommission,
};
