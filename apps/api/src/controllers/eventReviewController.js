import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { ScheduleError, findScheduleConflicts, lockVenue, occupiedInterval, resolveSchedule, toPktParts, formatPktTime, venueOf } from '../services/eventScheduleService.js';
import {
  noticeReviewed, noticeSubmitted, noticeChangesRequested, noticeReplied, noticeLaunchSubmitted, noticeLaunchApproved,
} from '../services/eventReviewNotices.js';
import { notifyAdmins } from '../services/notificationService.js';

/*
 * Event approval: the organizer submits a finished event (details, tickets, seating), a Super Admin
 * approves it (it goes on sale), rejects it with a comment (the slot is released; the organizer fixes it and
 * resubmits), or asks for changes: a question, or another suggested date and time. Asking keeps the request
 * pending and its slot held until the organizer replies (and can accept the suggested slot in one step); the
 * admin then decides.
 *
 * Prebooked dates (see prebookController) have two reviews:
 *   1. RESERVATION: the date request. Approval confirms the venue reservation; the date stays hidden.
 *   2. LAUNCH: once the organizer has added tickets, prices and a seating plan, they send it again. Only this
 *      approval shows it publicly and opens sales (launchStatus APPROVED; enforced in setVisibility too).
 * Every step is kept in EventReviewMessage, and the organizer and admins are notified in-app and by email.
 * The venue slot is rechecked under the venue lock on submit, on approval and when a suggestion is accepted,
 * so a conflicting request can never be confirmed.
 */

const SUBMITTABLE = ['DRAFT', 'PRELAUNCH_ANALYSIS', 'REJECTED'];
const CHANGES_REQUESTED = 'CHANGES_REQUESTED';
// Waiting for an admin / waiting for the organizer, for the approvals list and the nav badge
const WAITING_FOR_ADMIN = { OR: [{ status: 'PENDING_APPROVAL', reviewRequest: null }, { launchStatus: 'PENDING' }] };
const WAITING_FOR_ORGANIZER = { OR: [{ status: 'PENDING_APPROVAL', reviewRequest: CHANGES_REQUESTED }, { launchStatus: CHANGES_REQUESTED }] };

const isReservedDate = (event) => Boolean(event.prebookDraftId && event.reservedAt && ['PUBLISHED', 'PAUSED'].includes(event.status));
/** Which review an event is in, or null when nothing is under review. */
function reviewStage(event) {
  if (event.status === 'PENDING_APPROVAL') return 'RESERVATION';
  if (isReservedDate(event) && ['PENDING', CHANGES_REQUESTED].includes(event.launchStatus)) return 'LAUNCH';
  return null;
}
// "7:00 PM PKT", the stored wall-clock text for event.time
const timeText = (instant) => `${formatPktTime(instant)} PKT`;

/** 409 with the clash, when another event now holds this event's slot. */
async function assertSlotStillFree(tx, event) {
  await lockVenue(tx, event);
  const { start, end } = occupiedInterval(event);
  const conflicts = await findScheduleConflicts({ ...venueOf(event), startsAt: start, endsAt: end, excludeEventId: event.id }, tx);
  if (conflicts.length) throw new ScheduleError(409, conflicts[0].message, { field: 'schedule', conflicts: conflicts.map((c) => c.message) });
}

/** Whether attendees will have something to book: a published venue plan or seats from the older grid. */
async function seatingReady(eventId, db = prisma) {
  const [plan, seats] = await Promise.all([
    db.venueLayout.findFirst({ where: { eventId, status: 'PUBLISHED' }, select: { id: true } }),
    db.seat.count({ where: { eventId } }),
  ]);
  return Boolean(plan) || seats > 0;
}
const tiersReady = async (eventId, db = prisma) => (await db.ticketTier.count({ where: { eventId } })) > 0;

const logMessage = (db, event, user, data) =>
  db.eventReviewMessage.create({
    data: { eventId: event.id, authorId: user.id, authorEmail: user.email, authorRole: user.role === 'SUPER_ADMIN' ? 'ADMIN' : 'ORGANIZER', ...data },
  });
const MESSAGES = { orderBy: { createdAt: 'asc' }, take: 100 };

/** Organizer: readiness of an event for submission (used by the Review & submit step). */
export const getSubmissionStatus = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { tiers: { orderBy: { price: 'asc' } }, company: { select: { companyName: true } }, reviewMessages: MESSAGES },
    });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event, { permission: 'event.view', req }))) return res.status(403).json({ success: false, message: 'You can’t manage this event.' });

    const [plan, seatCount] = await Promise.all([
      prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, select: { version: true, publishedAt: true, data: true } }),
      prisma.seat.count({ where: { eventId: event.id } }),
    ]);
    const sections = Array.isArray(plan?.data?.sections) ? plan.data.sections.length : 0;
    const hasSeating = Boolean(plan) || seatCount > 0;

    return res.json({
      success: true,
      data: {
        event,
        seating: { published: Boolean(plan), version: plan?.version || null, sections, seats: seatCount },
        canSubmit: SUBMITTABLE.includes(event.status) && hasSeating,
        // A reserved prebooked date with tickets and seating can be sent for final approval
        canLaunch: isReservedDate(event) && event.launchStatus === 'NONE' && event.tiers.length > 0 && hasSeating,
        stage: reviewStage(event),
        waitingForOrganizer: Boolean(reviewStage(event)) && (event.reviewRequest === CHANGES_REQUESTED || event.launchStatus === CHANGES_REQUESTED),
      },
    });
  } catch (error) {
    console.error('Submission status failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load this event.' });
  }
};

/**
 * Organizer: send the event to TicketLedger admins for approval. A reserved prebooked date is sent for its
 * final (launch) approval instead, which needs tickets and a seating plan.
 */
export const submitEventForReview = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event, { requireApproved: true, permission: 'event.submit', req }))) {
      return res.status(403).json({ success: false, message: 'Only the organizer of this event can submit it.' });
    }

    if (isReservedDate(event)) {
      if (event.launchStatus === 'APPROVED') return res.status(409).json({ success: false, message: 'This date already has final approval.' });
      if (event.launchStatus === 'PENDING') return res.status(409).json({ success: false, message: 'This date is already waiting for final approval.' });
      if (event.launchStatus === CHANGES_REQUESTED) return res.status(409).json({ success: false, message: 'Reply to the admin’s question to send it again.' });
      if (!(await tiersReady(event.id)) || !(await seatingReady(event.id))) {
        return res.status(400).json({ success: false, message: 'Add ticket prices and publish a seating plan first.' });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const moved = await tx.event.updateMany({ where: { id: event.id, launchStatus: 'NONE' }, data: { launchStatus: 'PENDING', launchSubmittedAt: new Date() } });
        if (!moved.count) return null;
        await logMessage(tx, event, req.user, { stage: 'LAUNCH', kind: 'SUBMITTED' });
        return tx.event.findUnique({ where: { id: event.id } });
      });
      if (!updated) return res.status(409).json({ success: false, message: 'This date was just sent.' });
      await noticeLaunchSubmitted(updated, event.company);
      await prisma.auditLog.create({ data: { userId: req.user.id, action: 'EVENT_LAUNCH_SUBMITTED', targetType: 'Event', targetId: event.id, details: { eventName: event.name } } });
      return res.json({ success: true, message: 'Sent to TicketLedger for final approval.', data: { event: updated } });
    }

    if (event.status === 'PENDING_APPROVAL') return res.status(409).json({ success: false, message: 'This event is already waiting for admin approval.' });
    if (!SUBMITTABLE.includes(event.status)) {
      return res.status(409).json({ success: false, message: `An event that is ${event.status.toLowerCase()} can’t be submitted for approval.` });
    }
    // A prebooked date is a venue reservation: tickets and seating can be added once it is confirmed
    if (!event.prebookDraftId && !(await seatingReady(event.id))) {
      return res.status(400).json({ success: false, message: 'Publish a seating plan first, so attendees have seats to choose from.' });
    }

    // A rejected request released its slot, so the venue is checked again before it is held for review
    const updated = await prisma.$transaction(async (tx) => {
      await assertSlotStillFree(tx, event);
      await logMessage(tx, event, req.user, { stage: 'RESERVATION', kind: 'SUBMITTED' });
      return tx.event.update({
        where: { id: event.id },
        data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), reviewRequest: null, suggestedStartsAt: null, suggestedEndsAt: null },
      });
    });

    await noticeSubmitted(updated, event.company);
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_SUBMITTED_FOR_REVIEW', targetType: 'Event', targetId: event.id, details: { eventName: event.name, previousStatus: event.status } },
    });

    return res.json({ success: true, message: 'Sent to TicketLedger admins for approval.', data: { event: updated } });
  } catch (error) {
    if (error instanceof ScheduleError) return res.status(error.status).json({ success: false, message: error.message, ...error.details });
    console.error('Submit for review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit the event.' });
  }
};

/**
 * Super Admin: events by review state, oldest first while waiting. WAITING_ORGANIZER lists those an admin
 * asked about; PENDING_APPROVAL includes prebooked dates waiting for final approval.
 */
export const listEventsForReview = async (req, res) => {
  try {
    const status = ['PENDING_APPROVAL', 'WAITING_ORGANIZER', 'REJECTED', 'PUBLISHED'].includes(req.query.status) ? req.query.status : 'PENDING_APPROVAL';
    const where = {
      PENDING_APPROVAL: WAITING_FOR_ADMIN,
      WAITING_ORGANIZER: WAITING_FOR_ORGANIZER,
      REJECTED: { status: 'REJECTED' },
      PUBLISHED: { status: 'PUBLISHED', approvedAt: { not: null }, launchStatus: { notIn: ['PENDING', CHANGES_REQUESTED] } },
    }[status];
    const events = await prisma.event.findMany({
      where,
      include: {
        company: { select: { id: true, companyName: true, email: true, city: true } },
        tiers: { orderBy: { price: 'asc' }, select: { id: true, name: true, price: true, totalQuantity: true } },
        _count: { select: { seats: true } },
        reviewMessages: MESSAGES,
      },
      orderBy: status === 'PENDING_APPROVAL' || status === 'WAITING_ORGANIZER' ? { submittedAt: 'asc' } : { reviewedAt: 'desc' },
      take: 100,
    });
    const [pending, waiting, rejected] = await Promise.all([
      prisma.event.count({ where: WAITING_FOR_ADMIN }),
      prisma.event.count({ where: WAITING_FOR_ORGANIZER }),
      prisma.event.count({ where: { status: 'REJECTED' } }),
    ]);
    return res.json({
      success: true,
      data: {
        events: events.map((e) => ({ ...e, stage: reviewStage(e) })),
        counts: { PENDING_APPROVAL: pending, WAITING_ORGANIZER: waiting, REJECTED: rejected },
      },
    });
  } catch (error) {
    console.error('List events for review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load events for review.' });
  }
};

// A suggested slot, entered like the event form: PKT date + "HH:MM"
const slotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the suggested start date.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose the suggested start time.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the suggested end date.'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Choose the suggested end time.'),
});
const reviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']),
    comment: z.string().trim().max(1000, 'Keep the comment under 1000 characters.').optional().default(''),
    suggested: slotSchema.nullish(),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, {
    message: 'Add a comment explaining what the organizer should change or answer.',
    path: ['comment'],
  });

/**
 * Super Admin: decide on an event under review.
 * - APPROVE: a registered event goes on sale; a prebooked date's reservation is confirmed (it stays hidden);
 *   a reserved date's final approval shows it publicly.
 * - REJECT (with a comment): first review only. The slot is released and the organizer can resubmit.
 * - REQUEST_CHANGES (with a comment, optionally a suggested slot that must be free): nothing is decided, the
 *   slot stays held, and the organizer is asked to reply.
 */
export const reviewEvent = async (req, res) => {
  try {
    const { decision, comment, suggested } = reviewSchema.parse(req.body);
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const stage = reviewStage(event);
    if (!stage) return res.status(409).json({ success: false, message: 'This event is no longer waiting for a decision.' });
    if (stage === 'LAUNCH' && decision === 'REJECT') {
      return res.status(400).json({ success: false, message: 'This date is already reserved. Ask for changes instead; it stays hidden until you approve it.' });
    }

    let slot = null;
    if (decision === 'REQUEST_CHANGES' && suggested) {
      slot = resolveSchedule(suggested);
      if (slot.startsAt <= new Date()) return res.status(400).json({ success: false, field: 'suggested', message: 'The suggested date must be in the future.' });
      const clash = await findScheduleConflicts({ ...venueOf(event), ...slot, excludeEventId: event.id });
      if (clash.length) return res.status(409).json({ success: false, field: 'suggested', message: `The suggested slot isn’t free either: ${clash[0].message}` });
    }

    const now = new Date();
    const reviewed = { reviewedAt: now, reviewedBy: req.user.email, reviewComment: comment || null };
    const asking = decision === 'REQUEST_CHANGES';
    const approve = decision === 'APPROVE';
    let data;
    if (asking) {
      data = {
        ...reviewed,
        suggestedStartsAt: slot?.startsAt || null,
        suggestedEndsAt: slot?.endsAt || null,
        ...(stage === 'LAUNCH' ? { launchStatus: CHANGES_REQUESTED } : { reviewRequest: CHANGES_REQUESTED }),
      };
    } else if (stage === 'LAUNCH') {
      data = { ...reviewed, launchStatus: 'APPROVED', isHidden: false };
    } else {
      data = {
        ...reviewed,
        status: approve ? 'PUBLISHED' : 'REJECTED',
        approvedAt: approve ? now : null,
        reservedAt: approve ? now : null,
        reviewRequest: null,
        suggestedStartsAt: null,
        suggestedEndsAt: null,
        // An approved prebooked date is a reservation: hidden until its final approval with tickets and seating
        ...(approve && event.prebookDraftId ? { isHidden: true, launchStatus: 'NONE' } : {}),
      };
    }
    // Only move it if it is still in the state that was reviewed (two admins at once: the second one gets a 409)
    const still = stage === 'LAUNCH' ? { launchStatus: event.launchStatus } : { status: 'PENDING_APPROVAL', reviewRequest: event.reviewRequest };

    const moved = await prisma.$transaction(async (tx) => {
      if (approve) await assertSlotStillFree(tx, event);
      const result = await tx.event.updateMany({ where: { id: event.id, ...still }, data });
      if (result.count) {
        await logMessage(tx, event, req.user, {
          stage,
          kind: asking ? CHANGES_REQUESTED : approve ? 'APPROVED' : 'REJECTED',
          message: comment || null,
          suggestedStartsAt: slot?.startsAt || null,
          suggestedEndsAt: slot?.endsAt || null,
        });
      }
      return result;
    });
    if (!moved.count) return res.status(409).json({ success: false, message: 'Another admin has just reviewed this event.' });

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    if (asking) {
      await noticeChangesRequested(updated, event.company, { comment, suggested: slot, stage, reviewerEmail: req.user.email });
    } else if (stage === 'LAUNCH') {
      await noticeLaunchApproved(updated, event.company, { comment, reviewerEmail: req.user.email });
    } else {
      await noticeReviewed(updated, event.company, { approve, comment, reviewerEmail: req.user.email, hiddenUntilReady: Boolean(event.prebookDraftId) });
    }
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: asking ? 'EVENT_CHANGES_REQUESTED' : stage === 'LAUNCH' ? 'EVENT_LAUNCH_APPROVED' : approve ? 'EVENT_APPROVED' : 'EVENT_REJECTED',
        targetType: 'Event',
        targetId: event.id,
        details: { eventName: event.name, comment: comment || null, prebooked: Boolean(event.prebookDraftId), stage, suggested: slot },
      },
    });

    let done = approve ? 'Event approved and published.' : 'Event returned to the organizer.';
    if (event.prebookDraftId) done = approve ? 'Reservation confirmed.' : 'Reservation request rejected.';
    if (stage === 'LAUNCH') done = 'Final approval given. The date is now public.';
    if (asking) done = 'Your question was sent. The request stays pending until the organizer replies.';
    return res.json({ success: true, message: done, data: { event: updated } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid review' });
    if (error instanceof ScheduleError) {
      if (error.details?.field && error.details.field !== 'schedule') return res.status(400).json({ success: false, field: 'suggested', message: error.message });
      return res.status(409).json({ success: false, message: `Can’t confirm this slot: ${error.message} Reject the request so the organizer can choose another time.`, conflicts: error.details.conflicts });
    }
    console.error('Event review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to save the review.' });
  }
};

const replySchema = z.object({
  message: z.string().trim().min(2, 'Write a reply for the admin.').max(2000, 'Keep the reply under 2000 characters.'),
  acceptSuggestion: z.boolean().optional().default(false),
});

/**
 * Organizer: answer an admin's question. With acceptSuggestion, the event moves to the slot the admin suggested
 * (checked again under the venue lock). Either way it goes back to the admins for a decision.
 */
export const replyToReview = async (req, res) => {
  try {
    const { message, acceptSuggestion } = replySchema.parse(req.body);
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    // Only the event's own organization answers; admins speak through their review decisions
    if (req.user.role === 'SUPER_ADMIN' || !(await canManageEvent(req.user, event, { requireApproved: true, permission: 'event.submit', req }))) {
      return res.status(403).json({ success: false, message: 'Only the organizer of this event can reply.' });
    }
    const stage = reviewStage(event);
    const waiting = stage === 'LAUNCH' ? event.launchStatus === CHANGES_REQUESTED : stage === 'RESERVATION' && event.reviewRequest === CHANGES_REQUESTED;
    if (!waiting) return res.status(409).json({ success: false, message: 'There is no question waiting for your reply.' });
    if (acceptSuggestion && !event.suggestedStartsAt) return res.status(400).json({ success: false, message: 'The admin didn’t suggest another date.' });
    if (stage === 'LAUNCH' && (!(await tiersReady(event.id)) || !(await seatingReady(event.id)))) {
      return res.status(400).json({ success: false, message: 'Keep ticket prices and a published seating plan before sending it again.' });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const data = stage === 'LAUNCH' ? { launchStatus: 'PENDING', launchSubmittedAt: now } : { reviewRequest: null, submittedAt: now };
      if (acceptSuggestion) {
        const startsAt = event.suggestedStartsAt;
        const endsAt = event.suggestedEndsAt;
        await lockVenue(tx, event);
        const clash = await findScheduleConflicts({ ...venueOf(event), startsAt, endsAt, excludeEventId: event.id }, tx);
        if (clash.length) throw new ScheduleError(409, `The suggested slot was taken in the meantime: ${clash[0].message}`, { field: 'schedule' });
        Object.assign(data, { date: new Date(toPktParts(startsAt).date), time: timeText(startsAt), startsAt, endsAt });
      }
      Object.assign(data, { suggestedStartsAt: null, suggestedEndsAt: null });
      const moved = await tx.event.updateMany({ where: { id: event.id, ...(stage === 'LAUNCH' ? { launchStatus: CHANGES_REQUESTED } : { reviewRequest: CHANGES_REQUESTED }) }, data });
      if (!moved.count) return null;
      await logMessage(tx, event, req.user, { stage, kind: 'REPLY', message, acceptedSuggestion: acceptSuggestion });
      return tx.event.findUnique({ where: { id: event.id } });
    });
    if (!updated) return res.status(409).json({ success: false, message: 'This review changed in the meantime. Reload the page.' });

    await noticeReplied(updated, event.company, { message, accepted: acceptSuggestion, stage });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_REVIEW_REPLIED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, stage, acceptedSuggestion: acceptSuggestion } },
    });
    return res.json({ success: true, message: acceptSuggestion ? 'Date moved and reply sent to TicketLedger.' : 'Reply sent to TicketLedger.', data: { event: updated } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid reply' });
    if (error instanceof ScheduleError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Review reply failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to send the reply.' });
  }
};

/**
 * Organizer: take an event back from review to change it (editing is locked while an admin reviews it). A first
 * review returns to Draft, keeping its slot held; a final approval request returns to "setup needed". Send it
 * again from the Review page when it's ready.
 */
export const withdrawFromReview = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (req.user.role === 'SUPER_ADMIN' || !(await canManageEvent(req.user, event, { requireApproved: true, permission: 'event.submit', req }))) {
      return res.status(403).json({ success: false, message: 'Only the organizer of this event can withdraw it.' });
    }
    const stage = reviewStage(event);
    if (!stage) return res.status(409).json({ success: false, message: 'This event isn’t under review.' });
    const cleared = { reviewRequest: null, suggestedStartsAt: null, suggestedEndsAt: null };
    const updated = await prisma.$transaction(async (tx) => {
      const moved = await tx.event.updateMany({
        where: { id: event.id, ...(stage === 'LAUNCH' ? { launchStatus: event.launchStatus } : { status: 'PENDING_APPROVAL' }) },
        data: stage === 'LAUNCH' ? { launchStatus: 'NONE', ...cleared } : { status: 'DRAFT', ...cleared },
      });
      if (!moved.count) return null;
      await logMessage(tx, event, req.user, { stage, kind: 'WITHDRAWN' });
      return tx.event.findUnique({ where: { id: event.id } });
    });
    if (!updated) return res.status(409).json({ success: false, message: 'This review changed in the meantime. Reload the page.' });
    await notifyAdmins({
      type: 'EVENT_REVIEW_WITHDRAWN',
      title: `Withdrawn from review: ${event.name}`,
      message: `${event.company.companyName} took "${event.name}" back to make changes. It will come back to the approvals list when they send it again.`,
      link: '/admin/event-approvals',
    });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'EVENT_REVIEW_WITHDRAWN', targetType: 'Event', targetId: event.id, details: { eventName: event.name, stage } } });
    return res.json({ success: true, message: 'Withdrawn from review. Make your changes, then send it again.', data: { event: updated } });
  } catch (error) {
    console.error('Withdraw from review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to withdraw the event.' });
  }
};

/**
 * Super Admin: what is waiting for a decision, for the badges on the console nav (like unread counts).
 * Event approvals counts new events, promotion requests and date changes; Approvals counts companies.
 * Requests waiting for the organizer's reply aren't counted.
 */
export const getPendingCounts = async (req, res) => {
  try {
    const [events, promotions, changes, companies] = await Promise.all([
      prisma.event.count({ where: WAITING_FOR_ADMIN }),
      prisma.event.count({ where: { OR: [{ priorityStatus: 'REQUESTED' }, { heroStatus: 'REQUESTED' }] } }),
      prisma.eventScheduleChange.count({ where: { status: 'PENDING' } }),
      prisma.company.count({ where: { status: 'PENDING' } }),
    ]);
    return res.json({ success: true, data: { events, promotions, changes, companies, eventApprovals: events + promotions + changes } });
  } catch (error) {
    console.error('Pending counts failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load pending counts.' });
  }
};
