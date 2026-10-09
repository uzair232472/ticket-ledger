import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { notifyAdmins } from '../services/notificationService.js';
import { MediaValidationError } from '../services/eventMediaService.js';
import { uploadHeroVideos } from '../services/promoVideoService.js';

/*
 * Promotion requests. An organizer asks for one or both of:
 * - PRIORITY: the event is listed above the others on the home page and the Events page;
 * - HERO: the event fills the home page hero, with its promo video (or its banner when it has none).
 * A Super Admin approves or rejects each one. Both only show while the event is on sale.
 */

const KINDS = {
  PRIORITY: { status: 'priorityStatus', requestedAt: 'priorityRequestedAt', label: 'Top of listings' },
  HERO: { status: 'heroStatus', requestedAt: 'heroRequestedAt', label: 'Home page hero banner' },
};
const CLOSED = ['CANCELLED', 'COMPLETED'];
const flag = (v) => v === true || v === 'true' || v === '1';

const PROMOTION_SELECT = {
  id: true,
  name: true,
  status: true,
  priorityStatus: true,
  priorityRequestedAt: true,
  heroStatus: true,
  heroRequestedAt: true,
  heroVideoUrl: true,
  heroVideoMobileUrl: true,
  promotionNote: true,
  promotionComment: true,
  promotionReviewedAt: true,
};

async function loadManagedEvent(req, res) {
  const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
  if (!event) {
    res.status(404).json({ success: false, message: 'Event not found' });
    return null;
  }
  if (!(await canManageEvent(req.user, event))) {
    res.status(403).json({ success: false, message: 'You can’t manage this event.' });
    return null;
  }
  return event;
}

/**
 * Organizer: request priority and/or the hero banner (multipart: priority, hero, note, heroVideo,
 * heroVideoMobile). Uploading a new video for an approved hero sends it back for review.
 */
export const requestPromotion = async (req, res) => {
  try {
    const event = await loadManagedEvent(req, res);
    if (!event) return undefined;
    if (CLOSED.includes(event.status) || (event.endsAt && event.endsAt < new Date())) {
      return res.status(409).json({ success: false, message: 'This event has ended or been cancelled, so it can’t be promoted.' });
    }

    const wantsPriority = flag(req.body.priority);
    const wantsHero = flag(req.body.hero);
    const files = req.files || {};
    const desktop = files.heroVideo?.[0];
    const mobile = files.heroVideoMobile?.[0];
    if (!wantsPriority && !wantsHero) {
      return res.status(400).json({ success: false, message: 'Choose top of listings, the hero banner, or both.' });
    }
    if ((desktop || mobile) && !wantsHero) {
      return res.status(400).json({ success: false, message: 'Promo videos are only used for the hero banner. Tick the hero banner too, or remove the videos.' });
    }
    const note = String(req.body.note ?? '').trim();
    if (note.length > 500) return res.status(400).json({ success: false, message: 'Keep the message under 500 characters.' });

    const urls = await uploadHeroVideos({ desktop, mobile });
    const now = new Date();
    const data = { promotionNote: note || null };
    const requested = [];
    if (wantsPriority && event.priorityStatus !== 'APPROVED') {
      Object.assign(data, { priorityStatus: 'REQUESTED', priorityRequestedAt: now });
      requested.push(KINDS.PRIORITY.label);
    }
    if (wantsHero && (event.heroStatus !== 'APPROVED' || urls.desktop || urls.mobile)) {
      Object.assign(data, { heroStatus: 'REQUESTED', heroRequestedAt: now });
      if (urls.desktop) data.heroVideoUrl = urls.desktop;
      if (urls.mobile) data.heroVideoMobileUrl = urls.mobile;
      requested.push(KINDS.HERO.label);
    }
    if (!requested.length) {
      return res.status(409).json({ success: false, message: 'Already approved. Upload a new promo video if you want to change the hero banner.' });
    }

    const updated = await prisma.event.update({ where: { id: event.id }, data, select: PROMOTION_SELECT });
    const what = requested.join(' and ');
    await notifyAdmins({
      type: 'PROMOTION_REQUEST',
      title: `Promotion request: ${event.name}`,
      message: `${event.company.companyName} asked for ${what.toLowerCase()} for "${event.name}".${note ? ` Their message: ${note}` : ''} Review it under Event approvals → Promotion requests.`,
    });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_PROMOTION_REQUESTED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, requested } },
    });
    return res.json({ success: true, message: `Requested: ${what}. A TicketLedger admin will review it and you’ll be notified.`, data: { promotion: updated } });
  } catch (error) {
    if (error instanceof MediaValidationError) return res.status(400).json({ success: false, message: error.message });
    console.error('Promotion request failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to send the promotion request.' });
  }
};

/** Organizer: withdraw (or stop) one promotion. Withdrawing the hero also removes its videos. */
export const withdrawPromotion = async (req, res) => {
  try {
    const kind = KINDS[String(req.params.kind).toUpperCase()];
    if (!kind) return res.status(400).json({ success: false, message: 'Unknown promotion.' });
    const event = await loadManagedEvent(req, res);
    if (!event) return undefined;
    const data = { [kind.status]: 'NONE', [kind.requestedAt]: null };
    if (kind === KINDS.HERO) Object.assign(data, { heroVideoUrl: null, heroVideoMobileUrl: null });
    const updated = await prisma.event.update({ where: { id: event.id }, data, select: PROMOTION_SELECT });
    return res.json({ success: true, message: `${kind.label}: withdrawn.`, data: { promotion: updated } });
  } catch (error) {
    console.error('Promotion withdraw failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to withdraw the request.' });
  }
};

/** Super Admin: events with promotion requests in one state (default: waiting), oldest request first. */
export const listPromotions = async (req, res) => {
  try {
    const state = ['REQUESTED', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'REQUESTED';
    const events = await prisma.event.findMany({
      where: { OR: [{ priorityStatus: state }, { heroStatus: state }] },
      include: { company: { select: { id: true, companyName: true, email: true } } },
      orderBy: state === 'REQUESTED' ? { updatedAt: 'asc' } : { promotionReviewedAt: 'desc' },
      take: 100,
    });
    const waiting = await prisma.event.count({ where: { OR: [{ priorityStatus: 'REQUESTED' }, { heroStatus: 'REQUESTED' }] } });
    return res.json({ success: true, data: { events, waiting } });
  } catch (error) {
    console.error('List promotions failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load promotion requests.' });
  }
};

const decisionSchema = z
  .object({
    kind: z.enum(['PRIORITY', 'HERO']),
    decision: z.enum(['APPROVE', 'REJECT']),
    comment: z.string().trim().max(500, 'Keep the comment under 500 characters.').optional().default(''),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, { message: 'Add a comment explaining why.', path: ['comment'] });

/** Super Admin: approve or reject one promotion request (approving also works to end a rejected one later). */
export const reviewPromotion = async (req, res) => {
  try {
    const { kind: kindKey, decision, comment } = decisionSchema.parse(req.body);
    const kind = KINDS[kindKey];
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event[kind.status] === 'NONE') return res.status(409).json({ success: false, message: 'The organizer has withdrawn this request.' });

    const approve = decision === 'APPROVE';
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { [kind.status]: approve ? 'APPROVED' : 'REJECTED', promotionComment: comment || null, promotionReviewedAt: new Date() },
    });
    const live = updated.status === 'PUBLISHED' && !updated.isHidden;
    const where = kind === KINDS.HERO ? 'in the home page hero' : 'at the top of the event listings';
    await prisma.notification.create({
      data: {
        userId: event.company.userId,
        type: approve ? 'PROMOTION_APPROVED' : 'PROMOTION_REJECTED',
        title: `${kind.label} ${approve ? 'approved' : 'not approved'}: ${event.name}`,
        message: approve
          ? `“${event.name}” will be shown ${where}${live ? ' from now on' : ' once it is on sale'}.${comment ? ` Admin note: ${comment}` : ''}`
          : `Your request to show “${event.name}” ${where} was not approved. Reason: ${comment}`,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: approve ? 'EVENT_PROMOTION_APPROVED' : 'EVENT_PROMOTION_REJECTED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, kind: kindKey, comment: comment || null } },
    });
    return res.json({ success: true, message: `${kind.label} ${approve ? 'approved' : 'rejected'} for “${event.name}”.`, data: { event: updated } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid decision' });
    console.error('Promotion review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to save the decision.' });
  }
};

/** Public: on-sale events approved for the home page hero (the page picks one per visit). */
export const getHeroPromotions = async (req, res) => {
  try {
    const now = new Date();
    const events = await prisma.event.findMany({
      where: { heroStatus: 'APPROVED', status: 'PUBLISHED', isHidden: false, OR: [{ endsAt: null, date: { gte: now } }, { endsAt: { gt: now } }] },
      select: { id: true, name: true, type: true, categoryLabel: true, city: true, venue: true, date: true, time: true, bannerUrl: true, heroVideoUrl: true, heroVideoMobileUrl: true },
      orderBy: { date: 'asc' },
      take: 5,
    });
    return res.json({ success: true, data: { events } });
  } catch (error) {
    console.error('Hero promotions failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load featured events.' });
  }
};
