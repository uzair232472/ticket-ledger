import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { notifyAdmins } from '../services/notificationService.js';
import { MediaValidationError } from '../services/eventMediaService.js';
import { uploadHeroVideos } from '../services/promoVideoService.js';
import { DAY_MS, DEFAULT_PROMOTION_DAYS, MAX_PROMOTION_DAYS, activePromotionWhere, isPromotionActive, promotionStartedAt } from '../services/promotionWindow.js';

/*
 * Promotion requests. An organizer asks for one or both of:
 * - PRIORITY: the event is listed above the others on the home page and the Events page;
 * - HERO: the event fills the home page hero, with its promo video (or its banner when it has none).
 * A Super Admin approves or rejects each one and sets how long it runs (see promotionWindow.js). Both only
 * show while the event is on sale and inside their window.
 */

const KINDS = {
  PRIORITY: { key: 'priority', status: 'priorityStatus', requestedAt: 'priorityRequestedAt', days: 'priorityDays', startsAt: 'priorityStartsAt', endsAt: 'priorityEndsAt', label: 'Top of listings' },
  HERO: { key: 'hero', status: 'heroStatus', requestedAt: 'heroRequestedAt', days: 'heroDays', startsAt: 'heroStartsAt', endsAt: 'heroEndsAt', label: 'Home page hero banner' },
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
  priorityDays: true,
  priorityStartsAt: true,
  priorityEndsAt: true,
  heroDays: true,
  heroStartsAt: true,
  heroEndsAt: true,
};
const fmtDay = (d) => new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });

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
    // How long the organizer would like it to run; the admin sets the final dates
    const days = req.body.days === undefined || req.body.days === '' ? DEFAULT_PROMOTION_DAYS : Number(req.body.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_PROMOTION_DAYS) {
      return res.status(400).json({ success: false, message: `Choose between 1 and ${MAX_PROMOTION_DAYS} days.` });
    }

    const urls = await uploadHeroVideos({ desktop, mobile });
    const now = new Date();
    const data = { promotionNote: note || null };
    const requested = [];
    // Asking again while one is running is a renewal: approved, it starts a new window and moves the
    // event back to the top. The running window carries on until the admin decides.
    if (wantsPriority && event.priorityStatus !== 'REQUESTED') {
      Object.assign(data, { priorityStatus: 'REQUESTED', priorityRequestedAt: now, priorityDays: days });
      requested.push(KINDS.PRIORITY.label);
    }
    if (wantsHero && event.heroStatus !== 'REQUESTED') {
      Object.assign(data, { heroStatus: 'REQUESTED', heroRequestedAt: now, heroDays: days });
      if (urls.desktop) data.heroVideoUrl = urls.desktop;
      if (urls.mobile) data.heroVideoMobileUrl = urls.mobile;
      requested.push(KINDS.HERO.label);
    }
    if (!requested.length) {
      return res.status(409).json({ success: false, message: 'This request is already waiting for review.' });
    }

    const updated = await prisma.event.update({ where: { id: event.id }, data, select: PROMOTION_SELECT });
    const what = requested.join(' and ');
    await notifyAdmins({
      type: 'PROMOTION_REQUEST',
      title: `Promotion request: ${event.name}`,
      message: `${event.company.companyName} asked for ${what.toLowerCase()} for "${event.name}" for ${days} day${days === 1 ? '' : 's'}.${note ? ` Their message: ${note}` : ''} Review it under Event approvals → Promotion requests.`,
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
    const running = isPromotionActive(event, kind.key);
    let data;
    let message;
    if (event[kind.status] === 'REQUESTED' && running) {
      // Withdrawing a renewal: the promotion that is running carries on
      data = { [kind.status]: 'APPROVED', [kind.requestedAt]: null };
      message = `${kind.label}: request withdrawn. Your current promotion runs until ${fmtDay(event[kind.endsAt])}.`;
    } else {
      data = { [kind.status]: 'NONE', [kind.requestedAt]: null, [kind.startsAt]: null, [kind.endsAt]: null };
      if (kind === KINDS.HERO) Object.assign(data, { heroVideoUrl: null, heroVideoMobileUrl: null });
      message = running ? `${kind.label}: stopped.` : `${kind.label}: withdrawn.`;
    }
    const updated = await prisma.event.update({ where: { id: event.id }, data, select: PROMOTION_SELECT });
    return res.json({ success: true, message, data: { promotion: updated } });
  } catch (error) {
    console.error('Promotion withdraw failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to withdraw the request.' });
  }
};

/** Super Admin: events with promotion requests in one state (default: waiting), newest request first. */
export const listPromotions = async (req, res) => {
  try {
    const state = ['REQUESTED', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'REQUESTED';
    const found = await prisma.event.findMany({
      where: { OR: [{ priorityStatus: state }, { heroStatus: state }] },
      include: { company: { select: { id: true, companyName: true, email: true } } },
      orderBy: { promotionReviewedAt: 'desc' },
      take: 100,
    });
    const requestedAt = (e) =>
      Math.max(0, ...['priority', 'hero'].filter((k) => e[`${k}Status`] === 'REQUESTED').map((k) => new Date(e[`${k}RequestedAt`] || 0).getTime()));
    const startedAt = (e) => Math.max(promotionStartedAt(e, 'priority'), promotionStartedAt(e, 'hero'));
    const now = new Date();
    const events = found
      .map((e) => ({ ...e, priorityActive: isPromotionActive(e, 'priority', now), heroActive: isPromotionActive(e, 'hero', now) }))
      // Waiting: the latest request first. Approved: the latest start first.
      .sort((a, b) => (state === 'REQUESTED' ? requestedAt(b) - requestedAt(a) : state === 'APPROVED' ? startedAt(b) - startedAt(a) : 0));
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
    // Approve: when it runs (defaults: from now, for the days the organizer asked for). Approving an
    // approved promotion again changes its dates.
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, { message: 'Add a comment explaining why.', path: ['comment'] });

/** Super Admin: approve or reject one promotion request (approving also works to end a rejected one later). */
export const reviewPromotion = async (req, res) => {
  try {
    const { kind: kindKey, decision, comment, startsAt, endsAt } = decisionSchema.parse(req.body);
    const kind = KINDS[kindKey];
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event[kind.status] === 'NONE') return res.status(409).json({ success: false, message: 'The organizer has withdrawn this request.' });

    const approve = decision === 'APPROVE';
    const now = new Date();
    const wasApproved = event[kind.status] === 'APPROVED';
    const data = { [kind.status]: approve ? 'APPROVED' : 'REJECTED', promotionComment: comment || null, promotionReviewedAt: now };
    if (approve) {
      const start = startsAt || now;
      const end = endsAt || new Date(start.getTime() + (event[kind.days] || DEFAULT_PROMOTION_DAYS) * DAY_MS);
      if (end <= start) return res.status(400).json({ success: false, message: 'The end must be after the start.' });
      if (end <= now) return res.status(400).json({ success: false, message: 'The end date has already passed.' });
      if (end - start > MAX_PROMOTION_DAYS * DAY_MS) return res.status(400).json({ success: false, message: `A promotion can run for at most ${MAX_PROMOTION_DAYS} days.` });
      Object.assign(data, { [kind.startsAt]: start, [kind.endsAt]: end, [kind.requestedAt]: null });
    } else if (wasApproved && isPromotionActive(event, kind.key, now)) {
      // Ending an approved promotion stops it now; rejecting a renewal leaves the running one alone
      data[kind.endsAt] = now;
    }
    const updated = await prisma.event.update({ where: { id: event.id }, data });
    const live = updated.status === 'PUBLISHED' && !updated.isHidden;
    const where = kind === KINDS.HERO ? 'in the home page hero' : 'at the top of the event listings';
    const span = approve ? ` from ${fmtDay(updated[kind.startsAt])} to ${fmtDay(updated[kind.endsAt])}` : '';
    await prisma.notification.create({
      data: {
        userId: event.company.userId,
        type: approve ? 'PROMOTION_APPROVED' : 'PROMOTION_REJECTED',
        title: `${kind.label} ${approve ? (wasApproved ? 'dates changed' : 'approved') : 'not approved'}: ${event.name}`,
        message: approve
          ? `“${event.name}” will be shown ${where}${span}${live ? '' : ' while it is on sale'}.${comment ? ` Admin note: ${comment}` : ''}`
          : `Your request to show “${event.name}” ${where} was not approved. Reason: ${comment}`,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: approve ? 'EVENT_PROMOTION_APPROVED' : 'EVENT_PROMOTION_REJECTED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, kind: kindKey, comment: comment || null, startsAt: updated[kind.startsAt], endsAt: updated[kind.endsAt] } },
    });
    const did = approve ? (wasApproved ? 'dates changed' : 'approved') : wasApproved ? 'ended' : 'rejected';
    return res.json({ success: true, message: `${kind.label} ${did} for “${event.name}”${span}.`, data: { event: updated } });
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
      where: { AND: [activePromotionWhere('hero', now), { OR: [{ endsAt: null, date: { gte: now } }, { endsAt: { gt: now } }] }], status: 'PUBLISHED', isHidden: false },
      select: { id: true, name: true, type: true, categoryLabel: true, city: true, venue: true, date: true, time: true, bannerUrl: true, heroVideoUrl: true, heroVideoMobileUrl: true },
      // The latest promotion first
      orderBy: [{ heroStartsAt: { sort: 'desc', nulls: 'last' } }, { date: 'asc' }],
      take: 5,
    });
    return res.json({ success: true, data: { events } });
  } catch (error) {
    console.error('Hero promotions failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load featured events.' });
  }
};
