import { z } from 'zod';
import prisma from '../config/prisma.js';
import { canManageEvent } from '../utils/eventAccess.js';

/*
 * Event approval: the organizer submits a finished event (details, tickets, seating), a Super Admin
 * approves it (it goes on sale) or rejects it with a comment (the organizer fixes it and resubmits).
 * Both sides get an in-app notification, which is also emailed (config/prisma.js).
 */

const SUBMITTABLE = ['DRAFT', 'PRELAUNCH_ANALYSIS', 'REJECTED'];
const when = (d) => new Date(d).toLocaleDateString('en-PK', { dateStyle: 'medium', timeZone: 'Asia/Karachi' });

/** Whether attendees will have something to book: a published venue plan or seats from the older grid. */
async function seatingReady(eventId) {
  const [plan, seats] = await Promise.all([
    prisma.venueLayout.findFirst({ where: { eventId, status: 'PUBLISHED' }, select: { id: true } }),
    prisma.seat.count({ where: { eventId } }),
  ]);
  return Boolean(plan) || seats > 0;
}

/** Organizer: readiness of an event for submission (used by the Review & submit step). */
export const getSubmissionStatus = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { tiers: { orderBy: { price: 'asc' } }, company: { select: { companyName: true } } },
    });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event))) return res.status(403).json({ success: false, message: 'You can’t manage this event.' });

    const [plan, seatCount] = await Promise.all([
      prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, select: { version: true, publishedAt: true, data: true } }),
      prisma.seat.count({ where: { eventId: event.id } }),
    ]);
    const sections = Array.isArray(plan?.data?.sections) ? plan.data.sections.length : 0;

    return res.json({
      success: true,
      data: {
        event,
        seating: { published: Boolean(plan), version: plan?.version || null, sections, seats: seatCount },
        canSubmit: SUBMITTABLE.includes(event.status) && (Boolean(plan) || seatCount > 0),
      },
    });
  } catch (error) {
    console.error('Submission status failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load this event.' });
  }
};

/** Organizer: send the event to TicketLedger admins for approval. */
export const submitEventForReview = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event, { requireApproved: true }))) {
      return res.status(403).json({ success: false, message: 'Only the organizer of this event can submit it.' });
    }
    if (event.status === 'PENDING_APPROVAL') return res.status(409).json({ success: false, message: 'This event is already waiting for admin approval.' });
    if (!SUBMITTABLE.includes(event.status)) {
      return res.status(409).json({ success: false, message: `An event that is ${event.status.toLowerCase()} can’t be submitted for approval.` });
    }
    if (!(await seatingReady(event.id))) {
      return res.status(400).json({ success: false, message: 'Publish a seating plan first, so attendees have seats to choose from.' });
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
    });

    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true, email: true } });
    const title = `New event to review: ${event.name}`;
    const message = `${event.company.companyName} sent "${event.name}" (${when(event.date)}, ${event.venue}, ${event.city}) for approval.`;
    await prisma.notification.createMany({
      data: [
        ...admins.map((a) => ({ userId: a.id, type: 'EVENT_REVIEW_REQUEST', title, message })),
        {
          userId: req.user.id,
          type: 'EVENT_SUBMITTED',
          title: `“${event.name}” sent for approval`,
          message: 'A TicketLedger admin will review your event. You’ll get an email when it’s approved or if changes are needed.',
        },
      ],
    });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_SUBMITTED_FOR_REVIEW', targetType: 'Event', targetId: event.id, details: { eventName: event.name, previousStatus: event.status } },
    });

    return res.json({ success: true, message: 'Sent to TicketLedger admins for approval.', data: { event: updated } });
  } catch (error) {
    console.error('Submit for review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit the event.' });
  }
};

/** Super Admin: events by review state (default: waiting for approval), oldest submission first. */
export const listEventsForReview = async (req, res) => {
  try {
    const status = ['PENDING_APPROVAL', 'REJECTED', 'PUBLISHED'].includes(req.query.status) ? req.query.status : 'PENDING_APPROVAL';
    const events = await prisma.event.findMany({
      where: status === 'PUBLISHED' ? { status, approvedAt: { not: null } } : { status },
      include: {
        company: { select: { id: true, companyName: true, email: true, city: true } },
        tiers: { orderBy: { price: 'asc' }, select: { id: true, name: true, price: true, totalQuantity: true } },
        _count: { select: { seats: true } },
      },
      orderBy: status === 'PENDING_APPROVAL' ? { submittedAt: 'asc' } : { reviewedAt: 'desc' },
      take: 100,
    });
    const counts = await prisma.event.groupBy({ by: ['status'], where: { status: { in: ['PENDING_APPROVAL', 'REJECTED'] } }, _count: true });
    return res.json({
      success: true,
      data: { events, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) },
    });
  } catch (error) {
    console.error('List events for review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to load events for review.' });
  }
};

const reviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    comment: z.string().trim().max(1000, 'Keep the comment under 1000 characters.').optional().default(''),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment.length >= 5, { message: 'Add a comment explaining what the organizer should change.', path: ['comment'] });

/** Super Admin: approve (goes on sale) or reject (with a comment) a submitted event. */
export const reviewEvent = async (req, res) => {
  try {
    const { decision, comment } = reviewSchema.parse(req.body);
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: { include: { user: { select: { id: true, email: true } } } } } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ success: false, message: 'This event is no longer waiting for approval.' });
    }

    const approve = decision === 'APPROVE';
    const now = new Date();
    // Only move it if it is still pending (two admins reviewing at once: the second one gets a 409)
    const moved = await prisma.event.updateMany({
      where: { id: event.id, status: 'PENDING_APPROVAL' },
      data: {
        status: approve ? 'PUBLISHED' : 'REJECTED',
        approvedAt: approve ? now : null,
        reviewedAt: now,
        reviewedBy: req.user.email,
        reviewComment: comment || null,
      },
    });
    if (!moved.count) return res.status(409).json({ success: false, message: 'Another admin has just reviewed this event.' });

    const title = approve ? `“${event.name}” is approved and on sale` : `Changes needed for “${event.name}”`;
    const message = approve
      ? `Your event has been approved by TicketLedger and is now live for ticket sales.${comment ? ` Admin note: ${comment}` : ''}`
      : `Your event wasn’t approved yet. Admin comment: ${comment} Update the event and send it for approval again.`;
    await prisma.notification.create({
      data: { userId: event.company.userId, type: approve ? 'EVENT_APPROVED' : 'EVENT_REJECTED', title, message },
    });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: approve ? 'EVENT_APPROVED' : 'EVENT_REJECTED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, comment: comment || null } },
    });
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    return res.json({ success: true, message: approve ? 'Event approved and published.' : 'Event returned to the organizer.', data: { event: updated } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid review' });
    console.error('Event review failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to save the review.' });
  }
};
