const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password (not your account password)
  },
});

/**
 * Sends a password reset email with a deep-link URL.
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Plain-text reset token (NOT the hash)
 */
const sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = `battlenix://reset-password?token=${resetToken}`;

  const info = await transporter.sendMail({
    from: `"BattleNix" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Reset Your BattleNix Password',
    html: `
      <div style="background:#0A0A0F;color:white;padding:30px;font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border-radius:12px">
        <h2 style="color:#7C3AED;margin-bottom:8px">BattleNix Password Reset</h2>
        <p style="color:#ccc;margin-bottom:24px">We received a request to reset your password. Click the button below to continue:</p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#7C3AED;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
          Reset Password
        </a>
        <p style="color:#666;margin-top:24px;font-size:13px">
          ⏱ This link is valid for <strong>15 minutes</strong> only.<br>
          If you didn't request a password reset, you can safely ignore this email.
        </p>
        <hr style="border-color:#1a1a2e;margin-top:24px">
        <p style="color:#444;font-size:11px">BattleNix — Competitive Gaming Platform</p>
      </div>
    `,
  });

  logger.info('Password reset email sent', { messageId: info.messageId, to: email });
};

module.exports = { sendPasswordResetEmail };
