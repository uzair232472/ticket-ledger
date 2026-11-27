import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';

/*
 * Event page additions from GET /events/:id/extras: the organizer's announcements, the other dates / sessions of
 * the event, when ticket sales open or close, and the event's policies (terms, refunds, age limit). Rendered as
 * the page's own rows (same markup as EventDetails' Row).
 */

function Row({ label, children }) {
  const headingId = `tl-dt-x-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="tl-dt-row" aria-labelledby={headingId}>
      <h2 id={headingId} className="tl-dt-label">{label}</h2>
      <div className="tl-dt-content">{children}</div>
    </section>
  );
}

const when = (v) => new Date(v).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function useEventExtras(eventId) {
  const [extras, setExtras] = useState(null);
  useEffect(() => {
    if (!eventId) return;
    api.get(`/events/${eventId}/extras`).then((r) => setExtras(r.data.data)).catch(() => setExtras(null));
  }, [eventId]);
  return extras;
}

/** Announcements and other dates: shown near the top of the page. */
export function EventExtrasTop({ extras }) {
  if (!extras) return null;
  return (
    <>
      {extras.announcements.length > 0 && (
        <Row label="Announcements">
          <ul className="tl-dt-notes">
            {extras.announcements.map((a) => <li key={a.id}><b>{a.title}</b> · <span>{new Date(a.createdAt).toLocaleDateString()}</span><br />{a.body}</li>)}
          </ul>
        </Row>
      )}
      {extras.dates.length > 1 && (
        <Row label="Dates">
          <div className="flex flex-wrap gap-2">
            {extras.dates.map((d) => (
              d.current
                ? <span key={d.id} className="tl-dt-date is-current" aria-current="true">{when(d.startsAt)}{d.sessionLabel ? ` · ${d.sessionLabel}` : ''}</span>
                : <Link key={d.id} to={`/events/${d.id}`} className="tl-dt-date">{when(d.startsAt)}{d.sessionLabel ? ` · ${d.sessionLabel}` : ''}</Link>
            ))}
          </div>
        </Row>
      )}
    </>
  );
}

/** Sales window note for the Tickets row. */
export function SalesWindowNote({ extras }) {
  if (!extras?.sales) return null;
  const { opensAt, closesAt, open } = extras.sales;
  if (!open && opensAt && new Date(opensAt) > new Date()) return <p className="tl-dt-sales-note">Ticket sales open {when(opensAt)}.</p>;
  if (!open) return <p className="tl-dt-sales-note">Ticket sales have closed.</p>;
  if (closesAt) return <p className="tl-dt-sales-note">Sales close {when(closesAt)}.</p>;
  if (extras.soldOut) return <p className="tl-dt-sales-note">This event has reached its capacity.</p>;
  return null;
}

/** Terms, refund policy and age limit. */
export function EventPolicies({ extras }) {
  const p = extras?.policies;
  if (!p || (!p.terms && !p.refundPolicy && !p.ageRestriction)) return null;
  return (
    <Row label="Policies">
      <div className="grid gap-3">
        {p.ageRestriction && <p><b>Age:</b> {p.ageRestriction}+ only. Bring an ID.</p>}
        {p.refundPolicy && <div><b>Refunds</b><p style={{ whiteSpace: 'pre-wrap' }}>{p.refundPolicy}</p></div>}
        {p.terms && <div><b>Event terms</b><p style={{ whiteSpace: 'pre-wrap' }}>{p.terms}</p><p className="text-xs" style={{ opacity: 0.7 }}>You'll be asked to accept these at checkout.</p></div>}
      </div>
    </Row>
  );
}
