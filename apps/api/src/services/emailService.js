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
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
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

export default {
  getTransporter,
  sendEmailNotification,
  generateEmailHTML,
  getLastSentEmail,
};
