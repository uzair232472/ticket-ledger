import { z } from 'zod';
import prisma from '../config/prisma.js';
import { mlFlags } from '../config/mlFlags.js';
import { recommend, recordClick, recordRendered } from '../services/recommendationService.js';

const visitor = (req) => ({ userId: req.user?.id ?? null, sessionId: req.headers['x-session-id'] ? String(req.headers['x-session-id']).slice(0, 120) : null });

/**
 * Public card fields for the listed events, read in one query. Loading them through GET /events/:id would log an
 * event_view for every card (fake browsing in the behaviour data), so the list carries what a card needs.
 * The same fields for both experiment groups (identical presentation).
 */
async function cardsFor(ids) {
  if (!ids.length) return [];
  const rows = await prisma.event.findMany({
    where: { id: { in: ids }, status: 'PUBLISHED', isHidden: false, cancelledAt: null },
    select: { id: true, name: true, type: true, categoryLabel: true, city: true, venue: true, date: true, time: true, bannerUrl: true, tiers: { select: { price: true, availableQuantity: true }, orderBy: { price: 'asc' } } },
  });
  return rows.map((e) => {
    const prices = e.tiers.map((t) => Number(t.price));
    return {
      ...e, featured: false,
      pricing: { minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0, totalAvailable: e.tiers.reduce((a, t) => a + t.availableQuantity, 0) },
    };
  });
}

/** GET /api/events/recommendations?surface=home[&cards=1] - an experimental, rule-based list (labelled as such). */
export const getRecommendations = async (req, res) => {
  try {
    const surface = z.enum(['home', 'event', 'wishlist']).default('home').parse(req.query.surface ?? 'home');
    // The display (cards) is switched by ML_REC_DISPLAY (off by default): off = no list is served or logged
    if (req.query.cards === '1' && !mlFlags().recommendations) return res.json({ success: true, data: { enabled: false, listId: null, events: [] } });
    const list = await recommend({ ...visitor(req), surface });
    if (req.query.cards !== '1') return res.json({ success: true, data: list });
    const cards = await cardsFor(list.events.map((e) => e.eventId));
    const byId = new Map(cards.map((c) => [c.id, c]));
    // The variant and basis stay server-side: the page shows both groups the same way
    return res.json({ success: true, data: { listId: list.listId, experimental: true, events: list.events.map((e) => ({ ...e, card: byId.get(e.eventId) || null })).filter((e) => e.card) } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not load recommendations.' });
  }
};

/** POST /api/events/recommendations/:listId/click { eventId } */
export const postRecommendationClick = async (req, res) => {
  try {
    const listId = z.string().uuid().parse(req.params.listId);
    const { eventId } = z.object({ eventId: z.string().min(1).max(64) }).parse(req.body || {});
    return res.json({ success: true, data: await recordClick({ listId, eventId, ...visitor(req) }) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid request' });
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not record the click.' });
  }
};

/** POST /api/events/recommendations/:listId/rendered - the list was on screen (counted once per list) */
export const postRecommendationRendered = async (req, res) => {
  try {
    const listId = z.string().uuid().parse(req.params.listId);
    return res.json({ success: true, data: await recordRendered({ listId, ...visitor(req) }) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid request' });
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not record the impression.' });
  }
};
