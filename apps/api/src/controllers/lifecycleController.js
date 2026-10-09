import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { ScheduleError } from '../services/eventScheduleService.js';
import { MAX_REFUND_ATTEMPTS, processRefunds } from '../services/refundService.js';
import {
  LifecycleError,
  applyScheduleChange,
  cancelEvent,
  holderRefundOptions,
  lifecycleSummary,
  postponeEvent,
  refundOpen,
  rejectScheduleChange,
  requestHolderRefund,
  requestReschedule,
} from '../services/eventLifecycleService.js';

/** Maps service errors to responses; anything unexpected is a 500 with `fallback`. */
const fail = (res, error, fallback) => {
  if (error instanceof LifecycleError || error instanceof ScheduleError) {
    return res.status(error.status).json({ success: false, message: error.message, ...error.details });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid request' });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

async function managedEvent(req, res) {
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

const LIFECYCLE_FIELDS = ['id', 'name', 'status', 'date', 'time', 'startsAt', 'endsAt', 'city', 'venue', 'latitude', 'longitude', 'locationAddress', 'cancelledAt', 'cancelReason', 'postponedAt', 'postponeReason', 'rescheduledAt', 'refundWindowEndsAt'];
const pick = (event) => Object.fromEntries(LIFECYCLE_FIELDS.map((k) => [k, event[k]]));

// ---------------- Organizer (or Super Admin) ----------------

/** GET /events/:id/lifecycle: what cancelling or moving the event would affect, plus its change history. */
export const getLifecycle = async (req, res) => {
  try {
    const event = await managedEvent(req, res);
    if (!event) return undefined;
    return res.json({ success: true, data: { event: pick(event), summary: await lifecycleSummary(event) } });
  } catch (error) {
    return fail(res, error, 'Failed to load this event.');
  }
};

const reasonSchema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters; attendees will see it.').max(500, 'Keep the reason under 500 characters.') });

/** POST /events/:id/cancel { reason, confirmName } */
export const cancelEventHandler = async (req, res) => {
  try {
    const event = await managedEvent(req, res);
    if (!event) return undefined;
    const { reason } = reasonSchema.parse(req.body);
    if (String(req.body.confirmName || '').trim().toLowerCase() !== event.name.trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Type the event name exactly to confirm.', field: 'confirmName' });
    }
    const result = await cancelEvent({ event, actor: req.user, reason });
    return res.json({
      success: true,
      message: result.tickets ? `“${event.name}” is cancelled. ${result.tickets} ticket${result.tickets === 1 ? '' : 's'} are being refunded and every attendee has been emailed.` : `“${event.name}” is cancelled.`,
      data: result,
    });
  } catch (error) {
    return fail(res, error, 'Failed to cancel the event.');
  }
};

/** POST /events/:id/postpone { reason } */
export const postponeEventHandler = async (req, res) => {
  try {
    const event = await managedEvent(req, res);
    if (!event) return undefined;
    const { reason } = reasonSchema.parse(req.body);
    const result = await postponeEvent({ event, actor: req.user, reason });
    return res.json({ success: true, message: `“${event.name}” is postponed. Sales are paused and ${result.holders} attendee${result.holders === 1 ? ' has' : 's have'} been emailed.`, data: result });
  } catch (error) {
    return fail(res, error, 'Failed to postpone the event.');
  }
};

/** POST /events/:id/reschedule { date, time, endDate, endTime, city, venue, latitude?, longitude?, locationAddress?, reason } */
export const rescheduleEventHandler = async (req, res) => {
  try {
    const event = await managedEvent(req, res);
    if (!event) return undefined;
    const result = await requestReschedule({ event, actor: req.user, input: req.body || {} });
    const message = !result.applied
      ? 'Sent for approval. Attendees are emailed once a TicketLedger admin approves the new date.'
      : result.minor
        ? 'The new time is live and attendees have been emailed.'
        : 'The new date is live.';
    return res.json({ success: true, message, data: result });
  } catch (error) {
    return fail(res, error, 'Failed to request the date change.');
  }
};

/** DELETE /events/:id/reschedule: withdraw the pending request. */
export const withdrawRescheduleHandler = async (req, res) => {
  try {
    const event = await managedEvent(req, res);
    if (!event) return undefined;
    const { count } = await prisma.eventScheduleChange.updateMany({ where: { eventId: event.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (!count) return res.status(409).json({ success: false, message: 'There is no date change waiting for approval.' });
    return res.json({ success: true, message: 'Date change withdrawn.' });
  } catch (error) {
    return fail(res, error, 'Failed to withdraw the request.');
  }
};

// ---------------- Ticket holders ----------------

/** GET /events/:id/refund-options: the signed-in holder's tickets and refund choices for this event. */
export const getRefundOptions = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const options = await holderRefundOptions(event, req.user.id);
    return res.json({ success: true, data: { event: pick(event), ...options } });
  } catch (error) {
    return fail(res, error, 'Failed to load your refund options.');
  }
};

/** POST /events/:id/refund-request { ticketIds? }: give tickets back for a full refund while the window is open. */
export const requestRefundHandler = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const result = await requestHolderRefund({ event, user: req.user, ticketIds: req.body?.ticketIds });
    return res.json({ success: true, message: `Refund requested for ${result.refunds} ticket${result.refunds === 1 ? '' : 's'}. We’ve emailed you the details.`, data: result });
  } catch (error) {
    return fail(res, error, 'Failed to request the refund.');
  }
};

/** GET /bookings/refunds: refunds paid (or owed) to the signed-in user. */
export const getMyRefunds = async (req, res) => {
  try {
    const refunds = await prisma.refund.findMany({
      where: { userId: req.user.id },
      include: { event: { select: { id: true, name: true, date: true, venue: true, city: true } }, ticket: { select: { seat: { select: { section: true, row: true, seatNumber: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: { refunds } });
  } catch (error) {
    return fail(res, error, 'Failed to load your refunds.');
  }
};

/** GET /bookings/event-notices: the user's events that were cancelled, postponed or moved with refunds open. */
export const getMyEventNotices = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      where: {
        tickets: { some: { userId: req.user.id } },
        OR: [{ status: 'CANCELLED' }, { postponedAt: { not: null } }, { refundWindowEndsAt: { gt: new Date() } }],
      },
      select: { id: true, name: true, status: true, date: true, time: true, venue: true, city: true, cancelReason: true, cancelledAt: true, postponedAt: true, postponeReason: true, refundWindowEndsAt: true, rescheduledAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json({ success: true, data: { events: events.map((e) => ({ ...e, refund: refundOpen(e) })) } });
  } catch (error) {
    return fail(res, error, 'Failed to load event updates.');
  }
};

// ---------------- Super Admin ----------------

/** GET /admin/schedule-changes?status=PENDING */
export const listScheduleChanges = async (req, res) => {
  try {
    const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'PENDING';
    const changes = await prisma.eventScheduleChange.findMany({
      where: { status, ...(status === 'APPROVED' ? { minor: false } : {}) },
      include: { event: { select: { id: true, name: true, status: true, type: true, categoryLabel: true, bannerUrl: true, cardImageUrl: true, company: { select: { companyName: true, email: true } }, _count: { select: { tickets: { where: { status: { in: ['ACTIVE', 'SCANNED'] } } } } } } } },
      orderBy: status === 'PENDING' ? { createdAt: 'asc' } : { reviewedAt: 'desc' },
      take: 100,
    });
    const waiting = await prisma.eventScheduleChange.count({ where: { status: 'PENDING' } });
    return res.json({ success: true, data: { changes, waiting } });
  } catch (error) {
    return fail(res, error, 'Failed to load date changes.');
  }
};

const decisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(500).optional().default('') })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, { message: 'Add a comment explaining why.', path: ['comment'] });

/** POST /admin/schedule-changes/:id { decision, comment } */
export const reviewScheduleChange = async (req, res) => {
  try {
    const { decision, comment } = decisionSchema.parse(req.body);
    if (decision === 'APPROVE') {
      const result = await applyScheduleChange({ changeId: req.params.id, reviewer: req.user, comment });
      return res.json({ success: true, message: `Approved. ${result.holders} attendee${result.holders === 1 ? ' has' : 's have'} been emailed the new date.`, data: { holders: result.holders } });
    }
    await rejectScheduleChange({ changeId: req.params.id, reviewer: req.user, comment });
    return res.json({ success: true, message: 'Rejected. The organizer has been told; the event keeps its date.' });
  } catch (error) {
    if (error instanceof ScheduleError) {
      return res.status(409).json({ success: false, message: `The venue isn’t free for the new date any more: ${error.message} Reject the request so the organizer can pick another time.` });
    }
    return fail(res, error, 'Failed to save the decision.');
  }
};

/** GET /admin/refunds?status=FAILED|PENDING|PROCESSING|SUCCEEDED */
export const listRefunds = async (req, res) => {
  try {
    const status = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'].includes(req.query.status) ? req.query.status : 'FAILED';
    const [refunds, counts] = await Promise.all([
      prisma.refund.findMany({
        where: { status },
        include: { event: { select: { id: true, name: true } }, user: { select: { id: true, name: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      prisma.refund.groupBy({ by: ['status'], _count: true }),
    ]);
    return res.json({ success: true, data: { refunds, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), maxAttempts: MAX_REFUND_ATTEMPTS } });
  } catch (error) {
    return fail(res, error, 'Failed to load refunds.');
  }
};

/** POST /admin/refunds/retry { ids? }: retry the given failed refunds, or all of them. */
export const retryRefundsHandler = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) && req.body.ids.length
      ? req.body.ids.map(String)
      : (await prisma.refund.findMany({ where: { status: { in: ['FAILED', 'PENDING'] } }, select: { id: true }, take: 200 })).map((r) => r.id);
    const result = await processRefunds(ids);
    return res.json({ success: true, message: `${result.sent} refund${result.sent === 1 ? '' : 's'} sent${result.failed ? `, ${result.failed} failed again` : ''}.`, data: result });
  } catch (error) {
    return fail(res, error, 'Failed to retry refunds.');
  }
};
