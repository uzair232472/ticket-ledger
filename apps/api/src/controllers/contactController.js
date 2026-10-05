import { z } from 'zod';
import { getTransporter, mailFrom } from '../services/emailService.js';
import { OFFICIAL_EMAIL } from '../config/brand.js';
import { renderEmail, paragraph, factCard, esc, logoAttachment } from '../services/emailLayout.js';

const TOPICS = {
  BOOKING: 'Tickets and bookings',
  PAYMENT: 'Payments and refunds',
  ORGANIZER: 'Hosting an event',
  ACCOUNT: 'My account',
  OTHER: 'Something else',
};

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  topic: z.enum(Object.keys(TOPICS)).default('OTHER'),
  message: z.string().trim().min(10, 'Write a little more (at least 10 characters)').max(3000, 'Keep the message under 3000 characters'),
});

const supportInbox = () => process.env.SUPPORT_EMAIL || OFFICIAL_EMAIL;

/**
 * POST /api/contact — the Contact us form. The message goes to the support inbox with Reply-To set to the
 * sender, so support answers directly. No confirmation is mailed to the typed address (that would let the
 * form send email to strangers).
 */
export const sendContactMessage = async (req, res) => {
  try {
    const body = contactSchema.parse(req.body);
    const topic = TOPICS[body.topic];
    const html = renderEmail({
      preheader: `${body.name}: ${body.message.slice(0, 100)}`,
      label: 'Contact form',
      title: esc(`New message: ${topic}`),
      body: `${factCard([
        ['From', `${esc(body.name)} &lt;${esc(body.email)}&gt;`],
        ['Topic', esc(topic)],
        ...(req.user ? [['Signed in as', `${esc(req.user.email || '')} · ${esc(req.user.role || '')}`]] : []),
      ])}${paragraph(esc(body.message).replace(/\n/g, '<br>'))}`,
      footnote: 'Reply to this email to answer the sender directly.',
    });
    await getTransporter().sendMail({
      from: mailFrom(),
      to: supportInbox(),
      replyTo: `"${body.name.replace(/"/g, '')}" <${body.email}>`,
      subject: `[Contact] ${topic} — ${body.name}`,
      text: `From: ${body.name} <${body.email}>\nTopic: ${topic}\n\n${body.message}`,
      html,
      attachments: [logoAttachment()],
    });
    return res.json({ success: true, message: 'Thanks! Your message is on its way. We usually reply within one working day.' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0]?.message || 'Check the form and try again.' });
    console.error('Contact form failed:', err.message);
    return res.status(502).json({ success: false, message: 'We couldn’t send your message right now. Please email us instead.' });
  }
};
