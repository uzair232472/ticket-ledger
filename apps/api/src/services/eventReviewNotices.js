import prisma from '../config/prisma.js';
import { notifyAdmins } from './notificationService.js';
import { formatPktDate, formatPktTime, occupiedInterval } from './eventScheduleService.js';

/*
 * Notifications for the approval workflow, shared by registered events and prebooked dates. Each goes to the
 * organizer and the admins in-app and by email (config/prisma.js). Prebooked dates are worded as venue
 * reservations, and a submitted request is never called "Reserved": only an approved one is.
 */

// Ends a free-text comment with a full stop so the next sentence reads cleanly
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** "Sat 12 Oct, 6:00 PM – 9:00 PM at FMC Parking, Islamabad" (with both dates when it runs past midnight). */
export function slotText(event) {
  const { start, end } = occupiedInterval(event);
  const endDay = formatPktDate(end) === formatPktDate(start) ? '' : `${formatPktDate(end)}, `;
  const hours = event.startsAt ? `${formatPktTime(start)} – ${endDay}${formatPktTime(end)}` : event.time;
  return `${formatPktDate(start)}, ${hours} at ${event.venue}, ${event.city}`;
}

const isPrebook = (event) => Boolean(event.prebookDraftId);

/** After an event (or prebooked date) is sent for approval. */
export async function noticeSubmitted(event, company, db = prisma) {
  const slot = slotText(event);
  if (isPrebook(event)) {
    await notifyAdmins(
      {
        type: 'EVENT_REVIEW_REQUEST',
        title: `New reservation request: ${event.name} (${formatPktDate(occupiedInterval(event).start)})`,
        message: `${company.companyName} requested to reserve ${slot} for "${event.name}". Approve it to confirm the reservation, or reject it with a reason.`,
      },
      db,
    );
    await db.notification.create({
      data: {
        userId: company.userId,
        type: 'EVENT_SUBMITTED',
        title: `Reservation requested: ${event.name} (${formatPktDate(occupiedInterval(event).start)})`,
        message: `Your request for ${slot} was submitted and is pending approval. The slot is held for your request but it is not reserved yet. You’ll be notified when it’s confirmed or rejected.`,
      },
    });
    return;
  }
  await notifyAdmins(
    {
      type: 'EVENT_REVIEW_REQUEST',
      title: `New event to review: ${event.name}`,
      message: `${company.companyName} sent "${event.name}" (${slot}) for approval. Please review it and approve or reject it.`,
    },
    db,
  );
  await db.notification.create({
    data: {
      userId: company.userId,
      type: 'EVENT_SUBMITTED',
      title: `“${event.name}” sent for approval`,
      message: `Your event (${slot}) is pending approval. A TicketLedger admin will review it, and you’ll get an email when it’s approved or if changes are needed.`,
    },
  });
}

/**
 * After an admin approves or rejects. `hiddenUntilReady`: an approved prebooked date that still needs
 * tickets or seating before it can be shown publicly.
 */
export async function noticeReviewed(event, company, { approve, comment, reviewerEmail, hiddenUntilReady = false }, db = prisma) {
  const slot = slotText(event);
  const day = formatPktDate(occupiedInterval(event).start);
  const reason = comment ? sentence(comment) : '';
  let organizer;
  let admin;
  if (isPrebook(event)) {
    const visibility = event.isHidden || hiddenUntilReady
      ? hiddenUntilReady
        ? ' It stays hidden from the public until you add tickets and a seating plan, then you can show it.'
        : ' It stays hidden from the public, as you chose. You can show it whenever you’re ready.'
      : ' It is now visible to the public.';
    organizer = approve
      ? { type: 'EVENT_APPROVED', title: `Reservation confirmed: ${event.name} (${day})`, message: `Reserved: ${slot} is now reserved for "${event.name}".${visibility}${reason ? ` Admin note: ${reason}` : ''}` }
      : { type: 'EVENT_REJECTED', title: `Reservation request rejected: ${event.name} (${day})`, message: `Your request for ${slot} was rejected, so the slot was not reserved and has been released. Rejection reason: ${reason} You can change the date and request it again.` };
    admin = approve
      ? { type: 'ADMIN_EVENT_APPROVED', title: `Reservation confirmed: ${event.name} (${day})`, message: `${reviewerEmail} approved ${company.companyName}'s request for ${slot}. The slot is now reserved and the organizer has been notified.${reason ? ` Admin note: ${reason}` : ''}` }
      : { type: 'ADMIN_EVENT_REJECTED', title: `Reservation request rejected: ${event.name} (${day})`, message: `${reviewerEmail} rejected ${company.companyName}'s request for ${slot}. The slot was released and the organizer has been notified. Rejection reason: ${reason}` };
  } else {
    organizer = approve
      ? { type: 'EVENT_APPROVED', title: `“${event.name}” is approved and on sale`, message: `Your event (${slot}) has been approved by TicketLedger and is now live for ticket sales.${reason ? ` Admin note: ${reason}` : ''}` }
      : { type: 'EVENT_REJECTED', title: `Changes needed for “${event.name}”`, message: `Your event (${slot}) was rejected by TicketLedger. Rejection reason: ${reason} Update the event and send it for approval again.` };
    admin = {
      type: approve ? 'ADMIN_EVENT_APPROVED' : 'ADMIN_EVENT_REJECTED',
      title: `Event ${approve ? 'approved' : 'rejected'}: ${event.name}`,
      message:
        `${reviewerEmail} ${approve ? 'approved' : 'rejected'} "${event.name}" by ${company.companyName} (${slot}). The organizer has been notified.` +
        (approve ? (reason ? ` Admin note: ${reason}` : ' It is now on sale.') : ` Rejection reason: ${reason}`),
    };
  }
  await db.notification.create({ data: { userId: company.userId, ...organizer } });
  await notifyAdmins(admin, db);
}
