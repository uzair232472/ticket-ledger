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
        ? ' It stays hidden from the public. Add tickets, prices and a seating plan, then send it for final approval; it goes on sale once that is approved.'
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

const organizerLink = (event) => `/organizer/events/${event.id}/submit`;
const adminLink = '/admin/event-approvals';
const stageName = (event, stage) => (stage === 'LAUNCH' ? 'final approval' : isPrebook(event) ? 'reservation request' : 'approval');

/** An admin asked a question or suggested another slot instead of deciding. `suggested`: { startsAt, endsAt } or null. */
export async function noticeChangesRequested(event, company, { comment, suggested, stage, reviewerEmail }, db = prisma) {
  const suggestion = suggested ? ` Suggested instead: ${slotText({ ...event, ...suggested })}. You can accept it in one step.` : '';
  await db.notification.create({
    data: {
      userId: company.userId,
      type: 'EVENT_CHANGES_REQUESTED',
      title: `TicketLedger needs a reply: ${event.name}`,
      message: `An admin reviewed your ${stageName(event, stage)} for "${event.name}" (${slotText(event)}) and asks: ${sentence(comment)}${suggestion} Reply from the Review page; nothing is decided until you do.`,
      link: organizerLink(event),
    },
  });
  await notifyAdmins(
    {
      type: 'ADMIN_EVENT_CHANGES_REQUESTED',
      title: `Waiting on organizer: ${event.name}`,
      message: `${reviewerEmail} asked ${company.companyName} about "${event.name}": ${sentence(comment)}${suggested ? ` Suggested: ${slotText({ ...event, ...suggested })}.` : ''}`,
      link: adminLink,
    },
    db,
  );
}

/** The organizer replied (and maybe accepted the suggested slot): the request is back with the admins. */
export async function noticeReplied(event, company, { message, accepted, stage }, db = prisma) {
  await notifyAdmins(
    {
      type: 'EVENT_REVIEW_REPLY',
      title: `Organizer replied: ${event.name}`,
      message: `${company.companyName} replied about "${event.name}"${accepted ? ` and accepted the suggested slot (${slotText(event)})` : ''}: ${sentence(message)} It is waiting for your ${stageName(event, stage)} decision again.`,
      link: adminLink,
    },
    db,
  );
  await db.notification.create({
    data: {
      userId: company.userId,
      type: 'EVENT_SUBMITTED',
      title: `Reply sent: ${event.name}`,
      message: `Your reply was sent to TicketLedger${accepted ? ` and the date was moved to ${slotText(event)}` : ''}. You’ll be notified of the decision.`,
      link: organizerLink(event),
    },
  });
}

/** A reserved prebooked date sent for final approval with its tickets and seating. */
export async function noticeLaunchSubmitted(event, company, db = prisma) {
  await notifyAdmins(
    {
      type: 'EVENT_REVIEW_REQUEST',
      title: `Ready to go live: ${event.name} (${formatPktDate(occupiedInterval(event).start)})`,
      message: `${company.companyName} finished tickets, prices and seating for the reserved date ${slotText(event)}. Approve it to show it publicly and open sales, or ask for changes.`,
      link: adminLink,
    },
    db,
  );
  await db.notification.create({
    data: {
      userId: company.userId,
      type: 'EVENT_SUBMITTED',
      title: `Sent for final approval: ${event.name}`,
      message: `Your reserved date (${slotText(event)}) with its tickets and seating plan was sent to TicketLedger. It stays hidden until an admin approves it.`,
      link: organizerLink(event),
    },
  });
}

/** Final approval of a prebooked date: it is now public and on sale. */
export async function noticeLaunchApproved(event, company, { comment, reviewerEmail }, db = prisma) {
  const note = comment ? ` Admin note: ${sentence(comment)}` : '';
  await db.notification.create({
    data: { userId: company.userId, type: 'EVENT_APPROVED', title: `“${event.name}” is approved and on sale`, message: `Final approval given: ${slotText(event)} is now public and tickets are on sale.${note}`, link: `/events/${event.id}` },
  });
  await notifyAdmins({ type: 'ADMIN_EVENT_APPROVED', title: `Live: ${event.name}`, message: `${reviewerEmail} gave final approval to "${event.name}" by ${company.companyName} (${slotText(event)}). It is now public.${note}`, link: adminLink }, db);
}
