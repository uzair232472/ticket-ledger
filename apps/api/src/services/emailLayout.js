import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_EMAIL } from '../config/brand.js';

/**
 * Shared email layout, styled like the PDF ticket: paper background, the TicketLedger mark with "Ticket"
 * in ink and "Ledger" in green, a dark green banner, white detail cards and a perforated tear line.
 * Table layout and inline styles only, so it renders the same in Gmail, Outlook and phone mail apps.
 * The logo travels inside the email (inline CID attachment), so it shows even when links can't reach the
 * app server. Header and footer logos link to the home page.
 */

const C = {
  page: '#e9eee8',
  paper: '#f7f8f4',
  ink: '#0b1a10',
  muted: '#55645a',
  green: '#15803d',
  greenLight: '#86efac',
  greenDark: '#0d2a1b',
  greenSoft: '#eaf2ea',
  line: '#c9d8cb',
  white: '#ffffff',
};
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";

export const LOGO_CID = 'tl-mark@ticketledger';
export const logoAttachment = () => ({
  filename: 'ticketledger.png',
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/email/tl-mark.png'),
  cid: LOGO_CID,
});

export const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const wordmark = (size, home) => `
  <a href="${home}" target="_blank" style="text-decoration:none; display:inline-block;" title="Go to TicketLedger">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
      <td style="vertical-align:middle; padding-right:10px;"><img src="cid:${LOGO_CID}" width="${Math.round(size * 1.6)}" height="${size}" alt="TicketLedger" style="display:block; border:0;"></td>
      <td style="vertical-align:middle; font-family:${FONT}; font-size:${Math.round(size * 0.78)}px; font-weight:800; letter-spacing:-0.5px; line-height:1;">
        <span style="color:${C.ink};">Ticket</span><span style="color:${C.green};">Ledger</span>
      </td>
    </tr></table>
  </a>`;

/** A perforated tear line, as on the ticket. */
export const tearLine = () => `
  <tr><td style="padding:6px 0;">
    <div style="border-top:2px dashed ${C.line}; height:0; line-height:0; font-size:0;">&nbsp;</div>
  </td></tr>`;

/** White card with label / value rows (the PDF's fact panel). rows: [[label, valueHtml], …] */
export const factCard = (rows) => {
  if (!rows?.length) return '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.white}; border:1px solid ${C.line}; border-radius:12px; margin:4px 0 22px;">
    ${rows
      .map(
        ([label, value], i) => `
      <tr>
        <td style="padding:14px 18px; ${i ? `border-top:1px solid ${C.greenSoft};` : ''} font-family:${FONT};">
          <div style="font-size:10px; font-weight:700; letter-spacing:1.8px; text-transform:uppercase; color:${C.muted};">${esc(label)}</div>
          <div style="margin-top:4px; font-size:15px; font-weight:700; color:${C.ink};">${value}</div>
        </td>
      </tr>`,
      )
      .join('')}
  </table>`;
};

export const button = ({ label, url }) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto 4px;">
    <tr><td style="border-radius:10px; background:${C.green};">
      <a href="${url}" target="_blank" style="display:inline-block; padding:15px 30px; font-family:${FONT}; font-size:15px; font-weight:700; color:${C.white}; text-decoration:none; border-radius:10px;">${esc(label)} &rarr;</a>
    </td></tr>
  </table>`;

/** The one-time code panel: a ticket stub with the code in large monospace. */
export const codePanel = (code, note) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
    <tr><td align="center" style="background:${C.white}; border:2px dashed ${C.green}; border-radius:14px; padding:24px 16px;">
      <div style="font-family:${FONT}; font-size:10px; font-weight:700; letter-spacing:2.4px; text-transform:uppercase; color:${C.muted};">Your code</div>
      <div style="margin-top:8px; font-family:${MONO}; font-size:40px; font-weight:700; letter-spacing:12px; color:${C.ink}; padding-left:12px;">${esc(code)}</div>
      ${note ? `<div style="margin-top:10px; font-family:${FONT}; font-size:13px; color:${C.muted};">${note}</div>` : ''}
    </td></tr>
  </table>`;

export const notice = (html) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
    <tr><td style="background:${C.greenSoft}; border-left:3px solid ${C.green}; border-radius:8px; padding:12px 14px; font-family:${FONT}; font-size:13px; line-height:1.55; color:${C.ink};">${html}</td></tr>
  </table>`;

export const paragraph = (html) => `<p style="margin:0 0 18px; font-family:${FONT}; font-size:15px; line-height:1.65; color:${C.ink};">${html}</p>`;

/**
 * The full email. label: spaced capitals over the banner ("ACCOUNT VERIFICATION"); title: banner headline;
 * body: inner HTML (use the helpers above); footnote: small print above the footer.
 */
export function renderEmail({ preheader = '', label, title, body, footnote = '' }) {
  const home = frontendUrl();
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${esc(title)}</title>
</head>
<body style="margin:0; padding:0; background:${C.page};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background:${C.paper}; border:1px solid ${C.line}; border-radius:18px;">

        <!-- Header: logo (to the home page) and label -->
        <tr><td align="center" style="padding:30px 28px 6px;">
          ${wordmark(38, home)}
          <div style="margin-top:12px; font-family:${FONT}; font-size:10px; font-weight:700; letter-spacing:2.6px; text-transform:uppercase; color:${C.ink};">${esc(label)}</div>
        </td></tr>

        <!-- Banner -->
        <tr><td style="padding:18px 22px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.greenDark}; border-radius:14px;">
            <tr><td style="padding:28px 26px;">
              <div style="font-family:${FONT}; font-size:10px; font-weight:700; letter-spacing:2.4px; text-transform:uppercase; color:${C.greenLight};">TicketLedger · Pakistan</div>
              <div style="margin-top:10px; font-family:${FONT}; font-size:26px; font-weight:800; line-height:1.2; letter-spacing:-0.5px; color:${C.white};">${title}</div>
            </td></tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:26px 28px 6px;">
          ${body}
        </td></tr>

        <tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tearLine()}</table></td></tr>

        ${footnote ? `<tr><td style="padding:14px 28px 0; font-family:${FONT}; font-size:12px; line-height:1.6; color:${C.muted};">${footnote}</td></tr>` : ''}

        <!-- Footer: the logo always returns to the home page -->
        <tr><td align="center" style="padding:22px 28px 28px;">
          ${wordmark(26, home)}
          <div style="margin-top:12px; font-family:${FONT}; font-size:12px; line-height:1.6; color:${C.muted};">
            <a href="${home}" target="_blank" style="color:${C.green}; font-weight:700; text-decoration:none;">Visit TicketLedger</a>
            &nbsp;·&nbsp;
            <a href="${home}/events" target="_blank" style="color:${C.green}; font-weight:700; text-decoration:none;">Explore events</a>
          </div>
          <div style="margin-top:8px; font-family:${FONT}; font-size:11px; line-height:1.6; color:${C.muted};">
            Questions? Write to <a href="mailto:${OFFICIAL_EMAIL}" style="color:${C.green}; font-weight:700; text-decoration:none;">${OFFICIAL_EMAIL}</a><br>
            &copy; ${year} TicketLedger Pakistan. This is an automated message, so please don’t reply.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
