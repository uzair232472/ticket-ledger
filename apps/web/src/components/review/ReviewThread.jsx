import React from 'react';
import { CalendarClock, CheckCircle2, HelpCircle, MessageSquare, Send, Undo2, XCircle } from 'lucide-react';

const pktDateTime = (iso) =>
  new Date(iso).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
const pktTime = (iso) => new Date(iso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });

/** "Sat, 12 Oct 2026, 6:00 PM – 9:00 PM" for a suggested slot (both dates when it runs past midnight). */
export const slotLabel = (start, end) => {
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  return `${pktDateTime(start)} – ${sameDay ? pktTime(end) : pktDateTime(end)}`;
};

const KIND = {
  SUBMITTED: { icon: Send, label: (m) => (m.stage === 'LAUNCH' ? 'Sent for final approval' : 'Sent for approval') },
  APPROVED: { icon: CheckCircle2, label: (m) => (m.stage === 'LAUNCH' ? 'Final approval given' : 'Approved') },
  REJECTED: { icon: XCircle, label: () => 'Rejected' },
  CHANGES_REQUESTED: { icon: HelpCircle, label: () => 'Asked for changes' },
  WITHDRAWN: { icon: Undo2, label: () => 'Withdrew it to make changes' },
  REPLY: { icon: MessageSquare, label: (m) => (m.acceptedSuggestion ? 'Replied and accepted the suggested date' : 'Replied') },
};

/** The review conversation for one event: submissions, admin questions and suggested dates, replies, decisions. */
export default function ReviewThread({ messages = [], viewer = 'ORGANIZER' }) {
  if (!messages.length) return null;
  return (
    <ol className="tl-rt" aria-label="Review history">
      {messages.map((m) => {
        const k = KIND[m.kind] || KIND.REPLY;
        const mine = m.authorRole === viewer;
        const who = m.authorRole === 'ADMIN' ? (viewer === 'ADMIN' ? m.authorEmail : 'TicketLedger') : viewer === 'ORGANIZER' ? 'You' : 'Organizer';
        return (
          <li key={m.id} className={`tl-rt-item is-${m.authorRole.toLowerCase()}${mine ? ' is-mine' : ''}`} data-kind={m.kind}>
            <k.icon className="w-4 h-4" aria-hidden="true" />
            <div>
              <p className="tl-rt-head">
                <strong>{who}</strong> · {k.label(m)} · <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
              </p>
              {m.message && <p className="tl-rt-text">{m.message}</p>}
              {m.suggestedStartsAt && (
                <p className="tl-rt-slot"><CalendarClock className="w-4 h-4" aria-hidden="true" /> Suggested: {slotLabel(m.suggestedStartsAt, m.suggestedEndsAt)} (PKT)</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
