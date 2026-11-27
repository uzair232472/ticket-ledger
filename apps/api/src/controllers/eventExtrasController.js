import prisma from '../config/prisma.js';
import { listAnnouncements, seriesDates, capacityLeft } from '../services/eventToolsService.js';

/** GET /api/events/:id/extras: what the event page shows besides the event itself. */
export const getEventExtras = async (req, res) => {
  try {
    const e = await prisma.event.findUnique({ where: { id: req.params.id }, select: { id: true, seriesId: true, sessionLabel: true, salesOpenAt: true, salesCloseAt: true, terms: true, termsVersion: true, refundPolicy: true, ageRestriction: true, capacityLimit: true, status: true, isHidden: true } });
    if (!e || e.status !== 'PUBLISHED') return res.status(404).json({ success: false, message: 'Event not found' });
    const [announcements, dates, left] = await Promise.all([listAnnouncements(e.id, { publicOnly: true }), seriesDates(e), capacityLeft(e)]);
    const now = new Date();
    res.json({
      success: true,
      data: {
        announcements: announcements.map(({ id, title, body, createdAt }) => ({ id, title, body, createdAt })),
        dates: dates.filter((d) => d.status === 'PUBLISHED' && !d.isHidden).map(({ id, startsAt, date, time, sessionLabel }) => ({ id, startsAt: startsAt || date, time, sessionLabel, current: id === e.id })),
        sessionLabel: e.sessionLabel,
        sales: { opensAt: e.salesOpenAt, closesAt: e.salesCloseAt, open: (!e.salesOpenAt || e.salesOpenAt <= now) && (!e.salesCloseAt || e.salesCloseAt > now) },
        policies: { terms: e.terms, termsVersion: e.termsVersion, refundPolicy: e.refundPolicy, ageRestriction: e.ageRestriction },
        soldOut: e.capacityLimit ? left <= 0 : false,
      },
    });
  } catch (error) {
    console.error('Event extras failed:', error);
    res.status(500).json({ success: false, message: 'Could not load the event details.' });
  }
};
