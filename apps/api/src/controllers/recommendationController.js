import { z } from 'zod';
import { recommend, recordClick } from '../services/recommendationService.js';

const visitor = (req) => ({ userId: req.user?.id ?? null, sessionId: req.headers['x-session-id'] ? String(req.headers['x-session-id']).slice(0, 120) : null });

/** GET /api/events/recommendations?surface=home - an experimental, rule-based list (labelled as such). */
export const getRecommendations = async (req, res) => {
  try {
    const surface = z.enum(['home', 'event', 'wishlist']).default('home').parse(req.query.surface ?? 'home');
    return res.json({ success: true, data: await recommend({ ...visitor(req), surface }) });
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
