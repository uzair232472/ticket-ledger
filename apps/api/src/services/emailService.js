import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

let transporter = null;
let lastSentEmail = null;

// Initialize Nodemailer Transporter
export const getTransporter = () => {
  if (transporter) return transporter;

  const isRealHost = process.env.SMTP_HOST && 
                     !process.env.SMTP_HOST.includes('mock') && 
                     !process.env.SMTP_HOST.includes('mailtrap.io');
  const isRealUser = process.env.SMTP_USER && 
                     process.env.SMTP_USER !== 'mock_user' && 
                     !process.env.SMTP_USER.includes('mock');

  if (isRealHost && isRealUser) {
    if (process.env.SMTP_HOST.includes('gmail')) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  } else {
    // Development / Test transporter - in-memory JSON transport that works offline
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
};

/**
 * Generate formatted HTML template based on notification type
 */
export const generateEmailHTML = ({ type, title, message, data = {} }) => {
  const brandColor = '#059669'; // Emerald
  const darkBg = '#0f172a'; // Slate 900
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #020617; color: #f8fafc; margin: 0; padding: 24px; }
        .container { max-width: 600px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #065f46 0%, #0f172a 100%); padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b; }
        .logo { font-size: 24px; font-weight: 900; color: #34d399; letter-spacing: -0.5px; }
        .content { padding: 32px 24px; }
        .type-badge { display: inline-block; padding: 4px 12px; background: rgba(5, 150, 105, 0.2); border: 1px solid #059669; border-radius: 9999px; color: #34d399; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 16px; }
        .title { font-size: 20px; font-weight: 800; color: #ffffff; margin-bottom: 12px; line-height: 1.3; }
        .message { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
        .card { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; font-size: 13px; }
        .btn { display: inline-block; padding: 12px 24px; background: #059669; color: #020617; font-weight: bold; font-size: 13px; text-decoration: none; border-radius: 10px; text-align: center; }
        .footer { padding: 20px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🎟️ TicketLedger</div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Smart Ticketing & Anti-Scalping Platform</div>
        </div>
        <div class="content">
          <span class="type-badge">${type.replace(/_/g, ' ')}</span>
          <div class="title">${title}</div>
          <div class="message">${message}</div>
          
          ${data && Object.keys(data).length > 0 ? `
            <div class="card">
              ${Object.entries(data).map(([k, v]) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span style="color: #64748b; text-transform: capitalize;">${k.replace(/([A-Z])/g, ' $1')}:</span>
                  <span style="font-weight: 600; color: #f8fafc;">${typeof v === 'object' ? JSON.stringify(v) : v}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div style="text-align: center; margin-top: 24px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/wallet" class="btn">
              Open Ticket Wallet
            </a>
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} TicketLedger Technologies (Pvt) Ltd. All rights reserved.<br>
          Automated cryptographic notification dispatch. Do not reply to this email.
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send an email notification using Nodemailer
 */
export const sendEmailNotification = async ({ to, subject, type, title, message, data = {} }) => {
  const mailTransporter = getTransporter();
  const htmlContent = generateEmailHTML({ type, title, message, data });

  const mailOptions = {
    from: process.env.EMAIL_FROM || '"TicketLedger Alerts" <no-reply@ticketledger.pk>',
    to,
    subject: subject || title,
    text: `${title}\n\n${message}\n\nView details: ${process.env.FRONTEND_URL || 'http://localhost:5173'}/wallet`,
    html: htmlContent,
  };

  const info = await mailTransporter.sendMail(mailOptions);
  
  lastSentEmail = {
    to,
    subject: mailOptions.subject,
    type,
    title,
    messageId: info.messageId || 'msg_' + Math.random().toString(36).substring(7),
    timestamp: new Date().toISOString(),
  };

  return {
    success: true,
    messageId: lastSentEmail.messageId,
    preview: nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null,
  };
};

export const getLastSentEmail = () => lastSentEmail;

/**
 * Send an OTP Verification email with a high-visibility 6-digit code
 */
export const sendOtpEmail = async ({ to, name, otpCode }) => {
  const mailTransporter = getTransporter();
  const userName = name || 'User';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #020617; color: #f8fafc; margin: 0; padding: 24px; }
        .container { max-width: 560px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
        .header { background: linear-gradient(135deg, #065f46 0%, #0f172a 100%); padding: 32px 24px; text-align: center; border-bottom: 1px solid #1e293b; }
        .logo { font-size: 24px; font-weight: 900; color: #34d399; letter-spacing: -0.5px; }
        .content { padding: 32px 24px; }
        .badge { display: inline-block; padding: 4px 12px; background: rgba(5, 150, 105, 0.15); border: 1px solid #059669; border-radius: 9999px; color: #34d399; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 16px; }
        .title { font-size: 20px; font-weight: 800; color: #ffffff; margin-bottom: 8px; }
        .message { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
        .otp-box { background: #020617; border: 2px dashed #059669; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
        .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; color: #34d399; letter-spacing: 10px; margin-left: 10px; }
        .expiry-note { font-size: 12px; color: #64748b; margin-top: 8px; }
        .warning { background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 12px; border-radius: 6px; font-size: 12px; color: #fca5a5; margin-top: 20px; }
        .footer { padding: 20px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🎟️ TicketLedger</div>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Cryptographic Ticketing & Anti-Scalping Protocol</div>
        </div>
        <div class="content">
          <span class="badge">Verification Required</span>
          <div class="title">Verify Your Email Address</div>
          <div class="message">
            Hello <strong>${userName}</strong>,<br>
            Thank you for registering on TicketLedger. Please use the one-time verification code below to activate your account and verify your email.
          </div>

          <div class="otp-box">
            <div class="otp-code">${otpCode}</div>
            <div class="expiry-note">⏱️ This code is valid for <strong>10 minutes</strong>.</div>
          </div>

          <div class="warning">
            🛡️ <strong>Security Tip:</strong> Never share this code with anyone. TicketLedger administrators will never ask for your verification code.
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} TicketLedger Pakistan. All rights reserved.<br>
          If you did not initiate this request, you can safely ignore this email.
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: process.env.FROM_EMAIL || process.env.EMAIL_FROM || '"TicketLedger" <support@ticketledger.pk>',
    to,
    subject: `🔐 ${otpCode} is your TicketLedger Verification Code`,
    text: `Your TicketLedger verification code is: ${otpCode}. It expires in 10 minutes.`,
    html: htmlContent,
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log(`[EMAIL DISPATCH] Sent OTP to ${to} (MessageId: ${info.messageId || 'local'})`);

    lastSentEmail = {
      to,
      subject: mailOptions.subject,
      type: 'EMAIL_OTP_VERIFICATION',
      otpCode,
      messageId: info.messageId || 'msg_' + Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
    };

    return {
      success: true,
      messageId: lastSentEmail.messageId,
      preview: nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null,
    };
  } catch (error) {
    console.warn(`[EMAIL WARNING] Failed to send email via SMTP: ${error.message}.`);
    console.log(`[LOCAL DEV OTP] Code for ${to} is: ${otpCode}`);

    lastSentEmail = {
      to,
      subject: mailOptions.subject,
      type: 'EMAIL_OTP_VERIFICATION',
      otpCode,
      messageId: 'dev_mock_' + Date.now(),
      timestamp: new Date().toISOString(),
      fallback: true,
    };

    return {
      success: true,
      fallback: true,
      message: 'SMTP delivery failed, code logged to console',
    };
  }
};

export default {
  getTransporter,
  sendEmailNotification,
  sendOtpEmail,
  generateEmailHTML,
  getLastSentEmail,
};

