import { z } from 'zod';
import * as gifts from '../services/giftService.js';
import * as seats from '../services/seatChangeService.js';

const fail = (res, error, fallback) => {
  if (error instanceof gifts.GiftError || error instanceof seats.SeatChangeError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid request' });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};
const handle = (fallback, fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (error) {
    return fail(res, error, fallback);
  }
};

// ── Gifts and group tickets ────────────────────────────────────────────────────────────────────────────
const email = z.string().trim().toLowerCase().email('Enter a valid email address');
export const sendGifts = handle('Could not send the tickets.', async (req, res) => {
  const body = z.object({
    kind: z.enum(['GIFT', 'GROUP']).default('GIFT'),
    ticketIds: z.array(z.string().uuid()).max(10).optional(),
    email: email.optional(),
    name: z.string().trim().max(80).optional(),
    message: z.string().trim().max(300).optional(),
    recipients: z.array(z.object({ ticketId: z.string().uuid(), email, name: z.string().trim().max(80).optional() })).max(10).optional(),
  }).refine((b) => (b.recipients?.length) || (b.ticketIds?.length && b.email), 'Choose tickets and who gets them').parse(req.body || {});
  const out = await gifts.sendGifts(req.user, body);
  const delivered = out.filter((g) => g.delivered).length;
  res.status(201).json({ success: true, message: delivered === out.length ? 'Sent. The tickets are in their wallets now.' : `Sent. ${out.length - delivered} ${out.length - delivered === 1 ? 'person needs' : 'people need'} to claim theirs from the email we sent.`, data: { gifts: out } });
});
export const myGifts = handle('Could not load gifts.', async (req, res) => res.json({ success: true, data: await gifts.myGifts(req.user) }));
export const cancelGift = handle('Could not cancel the gift.', async (req, res) => res.json({ success: true, message: 'Gift cancelled. The ticket stays with you.', data: await gifts.cancelGift(req.user, req.params.id) }));
export const claimWaiting = handle('Could not claim the ticket.', async (req, res) => res.json({ success: true, message: 'The ticket is in your wallet.', data: await gifts.claimWaiting(req.user, req.params.id) }));
export const previewGift = handle('Could not load the gift.', async (req, res) => res.json({ success: true, data: await gifts.previewGift(req.params.token) }));
export const claimGift = handle('Could not claim the ticket.', async (req, res) => res.json({ success: true, message: 'The ticket is in your wallet.', data: await gifts.claimGift(req.user, req.params.token) }));

// ── Seat changes ───────────────────────────────────────────────────────────────────────────────────────
export const seatOptions = handle('Could not load seats.', async (req, res) => res.json({ success: true, data: await seats.options(req.user, req.params.ticketId) }));
export const changeSeat = handle('Could not change the seat.', async (req, res) => {
  const { seatId } = z.object({ seatId: z.string().uuid('Choose a seat') }).parse(req.body || {});
  res.json({ success: true, message: 'Seat changed. Your new QR is in your wallet.', data: await seats.changeSeat(req.user, req.params.ticketId, seatId) });
});
