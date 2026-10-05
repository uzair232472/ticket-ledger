import nodemailer from 'nodemailer';
import { OFFICIAL_EMAIL } from '../config/brand.js';
import { renderEmail, paragraph, factCard, button, codePanel, notice, esc, logoAttachment, frontendUrl } from './emailLayout.js';
import dotenv from 'dotenv';
dotenv.config();

let transporter = null;
let lastSentEmail = null;
// True when no real SMTP server is configured and mail goes to nodemailer's in-memory JSON transport
let isDevTransport = false;

const MAIL_FROM = () =>
  process.env.MAIL_FROM || process.env.FROM_EMAIL || process.env.EMAIL_FROM || `"TicketLedger" <${OFFICIAL_EMAIL}>`;
const FRONTEND_URL = () => (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');

// Codes and links are printed only when they could not have reached a real inbox, and never in production
const logForLocalDev = (line) => {
  if (process.env.NODE_ENV !== 'production') console.log(line);
};

// Initialize Nodemailer Transporter
export const getTransporter = () => {
  if (transporter) return transporter;

  // Automated tests never send real mail: test signups use made-up addresses, and the bounces
  // exhaust the sender's daily quota (Gmail answers "550 5.4.5 Daily user sending limit exceeded").
  const isTestRun = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
  // Mailtrap / Ethereal sandboxes are real SMTP servers that keep mail in a fake inbox, so they are used as-is
  const isRealHost = process.env.SMTP_HOST && !process.env.SMTP_HOST.includes('mock');
  const isRealUser = process.env.SMTP_USER &&
                     process.env.SMTP_USER !== 'mock_user' &&
                     !process.env.SMTP_USER.includes('mock');

  if (isRealHost && isRealUser && !isTestRun) {
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
    isDevTransport = true;
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
};

/**
 * Generate formatted HTML template based on notification type
 */
/** Escapes text for the HTML email body (titles and messages can carry user-written comments). */
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * `action` ({ label, url }) sets the email's button; without it the button opens the ticket wallet.
 */
export const generateEmailHTML = ({ type, title, message, data = {}, action }) => {
  const button_ = action || { label: 'Open your tickets', url: `${frontendUrl()}/wallet` };
  // title / message arrive escaped (they can carry user-written text); data values are escaped here
  const rows = Object.entries(data || {}).map(([k, v]) => [
    k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '),
    esc(typeof v === 'object' ? JSON.stringify(v) : v),
  ]);
  return renderEmail({
    preheader: String(message || '').replace(/<[^>]+>/g, '').slice(0, 140),
    label: String(type || 'Notification').replace(/_/g, ' '),
    title,
    body: `${paragraph(message)}${factCard(rows)}${button(button_)}`,
    footnote: 'You get these emails because email notifications are on for your TicketLedger account. You can turn them off in your account settings.',
  });
};

/**
 * Send an email notification using Nodemailer
 */
export const sendEmailNotification = async ({ to, subject, type, title, message, data = {}, action }) => {
  const mailTransporter = getTransporter();
  const htmlContent = generateEmailHTML({ type, title, message, data, action });

  const mailOptions = {
    from: MAIL_FROM(),
    to,
    subject: subject || title,
    text: `${title}\n\n${message}\n\nView details: ${action?.url || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/wallet`}`,
    html: htmlContent,
    attachments: [logoAttachment()],
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
const OTP_EMAIL_COPY = {
  VERIFY_EMAIL: {
    badge: 'Verification Required',
    title: 'Verify Your Email Address',
    intro: 'Thank you for registering on TicketLedger. Please use the one-time verification code below to activate your account and verify your email.',
    subject: (code) => `🔐 ${code} is your TicketLedger Verification Code`,
    text: (code) => `Your TicketLedger verification code is: ${code}. It expires in 10 minutes.`,
  },
  RESET_PASSWORD: {
    badge: 'Password Reset',
    title: 'Reset Your Password',
    intro: 'We received a request to reset your TicketLedger password. Use the one-time code below to choose a new password.',
    subject: (code) => `🔑 ${code} is your TicketLedger password reset code`,
    text: (code) => `Your TicketLedger password reset code is: ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
  },
};

export const sendOtpEmail = async ({ to, name, otpCode, purpose = 'VERIFY_EMAIL' }) => {
  const mailTransporter = getTransporter();
  const userName = name || 'User';
  const copy = OTP_EMAIL_COPY[purpose] || OTP_EMAIL_COPY.VERIFY_EMAIL;

  const htmlContent = renderEmail({
    preheader: `${otpCode} is your TicketLedger code. It expires in 10 minutes.`,
    label: copy.badge,
    title: esc(copy.title),
    body: `${paragraph(`Hello <strong>${esc(userName)}</strong>,<br>${esc(copy.intro)}`)}${codePanel(otpCode, 'Valid for <strong>10 minutes</strong>. Use it once.')}${notice('<strong>Keep it private.</strong> Never share this code. TicketLedger staff will never ask you for it.')}`,
    footnote: 'If you didn’t ask for this code, you can ignore this email: nothing changes on your account.',
  });

  const mailOptions = {
    from: MAIL_FROM(),
    to,
    subject: copy.subject(otpCode),
    text: copy.text(otpCode),
    html: htmlContent,
    attachments: [logoAttachment()],
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log(`[EMAIL DISPATCH] Sent ${purpose} OTP to ${to} (MessageId: ${info.messageId || 'local'})`);
    if (isDevTransport) logForLocalDev(`[LOCAL DEV OTP] ${purpose} code for ${to} is: ${otpCode}`);

    lastSentEmail = {
      to,
      subject: mailOptions.subject,
      type: 'EMAIL_OTP_VERIFICATION',
      purpose,
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
    logForLocalDev(`[LOCAL DEV OTP] ${purpose} code for ${to} is: ${otpCode}`);

    lastSentEmail = {
      to,
      subject: mailOptions.subject,
      type: 'EMAIL_OTP_VERIFICATION',
      purpose,
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

/**
 * Send a gate staff invite link. SMTP failures are logged and reported, never thrown.
 */
export const sendStaffInviteEmail = async ({ to, inviteToken, eventName, companyName, inviterName }) => {
  const inviteUrl = `${FRONTEND_URL()}/invite/${inviteToken}`;
  const html = renderEmail({
    preheader: `Join the gate team for ${eventName} on TicketLedger.`,
    label: 'Gate team invite',
    title: 'You’re invited to join the gate team',
    body: `${paragraph(`${inviterName ? `<strong>${esc(inviterName)}</strong> has invited you` : 'You have been invited'} to work as gate staff on TicketLedger. Set your password to activate your account and start scanning tickets.`)}${factCard([
      ['Event', esc(eventName)],
      ...(companyName ? [['Organizer', esc(companyName)]] : []),
      ['Your role', 'Gate staff · ticket scanning'],
    ])}${button({ label: 'Accept invite', url: inviteUrl })}`,
    footnote: 'This link works once and expires in 72 hours. If you weren’t expecting it, you can ignore this email.',
  });

  const mailOptions = {
    from: MAIL_FROM(),
    to,
    subject: `You're invited to scan tickets for ${eventName}`,
    text: `You have been invited to work as gate staff for ${eventName} on TicketLedger. Accept the invite (valid 72 hours, single use): ${inviteUrl}`,
    html,
    attachments: [logoAttachment()],
  };

  lastSentEmail = {
    to,
    subject: mailOptions.subject,
    type: 'STAFF_INVITE',
    inviteToken,
    inviteUrl,
    timestamp: new Date().toISOString(),
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    console.log(`[EMAIL DISPATCH] Sent staff invite to ${to} (MessageId: ${info.messageId || 'local'})`);
    if (isDevTransport) logForLocalDev(`[LOCAL DEV INVITE] Invite link for ${to}: ${inviteUrl}`);
    return { success: true };
  } catch (error) {
    console.warn(`[EMAIL WARNING] Failed to send staff invite via SMTP: ${error.message}.`);
    logForLocalDev(`[LOCAL DEV INVITE] Invite link for ${to}: ${inviteUrl}`);
    return { success: false, fallback: true };
  }
};

export const mailFrom = () => MAIL_FROM();

export default {
  getTransporter,
  sendStaffInviteEmail,
  sendEmailNotification,
  sendOtpEmail,
  generateEmailHTML,
  getLastSentEmail,
};

