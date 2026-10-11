import React, { useState } from 'react';
import { ArrowUpToLine, Building2, CalendarDays, CheckCircle2, Clapperboard, Eye, MapPin, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { getEventVisual, resolveMediaUrl } from '../../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';
import { Badge } from '../dash/Studio';
import { useDialog } from '../ui/DialogProvider';
import { DAY_MS, DEFAULT_PROMOTION_DAYS, formatPromoDay, fromDateInput, isPromotionActive, promoTimeLeft, toDateInput } from '../../utils/promotion';

const KINDS = [
  { kind: 'PRIORITY', key: 'priority', field: 'priorityStatus', at: 'priorityRequestedAt', icon: ArrowUpToLine, title: 'Top of listings' },
  { kind: 'HERO', key: 'hero', field: 'heroStatus', at: 'heroRequestedAt', icon: Clapperboard, title: 'Home page hero banner' },
];
const TONE = { REQUESTED: 'amber', APPROVED: 'green', REJECTED: 'rose' };
const LABEL = { REQUESTED: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected' };

/**
 * Dates a promotion runs: an approved one keeps its own; a request starts today for the days asked.
 * A renewal (asked while one runs) starts today too, so the event moves back to the top.
 */
function initialWindow(event, key) {
  const today = toDateInput(Date.now());
  if (event[`${key}Status`] === 'APPROVED' && event[`${key}EndsAt`]) {
    return { from: toDateInput(event[`${key}StartsAt`] || Date.now()), until: toDateInput(event[`${key}EndsAt`]) };
  }
  const days = event[`${key}Days`] || DEFAULT_PROMOTION_DAYS;
  return { from: today, until: toDateInput(Date.now() + (days - 1) * DAY_MS) };
}

/** Super Admin: one event's promotion requests, each approved or rejected on its own, with its dates. */
export default function PromotionReviewCard({ event, onReviewed }) {
  const dialog = useDialog();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [windows, setWindows] = useState(() => Object.fromEntries(KINDS.map((k) => [k.kind, initialWindow(event, k.key)])));
  const setWindow = (kind, part) => (e) => setWindows((w) => ({ ...w, [kind]: { ...w[kind], [part]: e.target.value } }));
  const time = formatEventTime(event.time);
  const requests = KINDS.filter((k) => event[k.field] && event[k.field] !== 'NONE');

  const decide = async (kind, decision) => {
    const { key } = KINDS.find((k) => k.kind === kind);
    if (decision === 'REJECT' && comment.trim().length < 5) {
      setError('Add a comment so the organizer knows why.');
      return;
    }
    const range = windows[kind];
    if (decision === 'APPROVE' && (!range.from || !range.until || range.until < range.from)) {
      setError('Choose a start date and an end date on or after it.');
      return;
    }
    setBusy(`${kind}-${decision}`);
    setError('');
    try {
      // From the start of the first day (or now, if that is today) to the end of the last day, Pakistan time
      // An approved promotion whose start day is unchanged keeps its exact start (and its place in the order)
      const today = toDateInput(Date.now());
      const savedStart = event[`${key}StartsAt`];
      const keepStart = event[`${key}Status`] === 'APPROVED' && savedStart && toDateInput(savedStart) === range.from;
      const start = keepStart ? new Date(savedStart) : range.from === today ? new Date() : fromDateInput(range.from);
      const dates = decision === 'APPROVE' ? { startsAt: start.toISOString(), endsAt: fromDateInput(range.until, true).toISOString() } : {};
      const res = await api.post(`/admin/promotions/${event.id}`, { kind, decision, comment: comment.trim(), ...dates });
      await dialog.alert({ tone: decision === 'APPROVE' ? 'success' : 'info', title: decision === 'APPROVE' ? 'Promotion saved' : 'Promotion rejected', message: `${res.data.message} The organizer has been notified.` });
      setComment('');
      onReviewed(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the decision.');
    } finally {
      setBusy('');
    }
  };

  return (
    <article className="tl-ap-item">
      <div className="tl-ap-media">
        <img src={getEventVisual(event, 0).image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </div>
      <div className="tl-ap-body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Badge tone={event.status === 'PUBLISHED' ? 'green' : 'amber'}>{event.status === 'PUBLISHED' ? 'On sale' : event.status.replace(/_/g, ' ').toLowerCase()}</Badge>
          {event.isHidden && <Badge tone="amber">Hidden by organizer</Badge>}
        </div>
        <h3>{event.name}</h3>
        <p className="tl-ap-meta">
          <span><Building2 className="w-4 h-4" aria-hidden="true" /> {event.company?.companyName}</span>
          <span><CalendarDays className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</span>
          <span><MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}, {event.city}</span>
        </p>
        {event.promotionNote && <p className="tl-rv-comment">Organizer: “{event.promotionNote}”</p>}
        {event.promotionComment && <p className="tl-ap-meta">Last admin note: “{event.promotionComment}”</p>}

        <div className="tl-ap-promo">
          {requests.map(({ kind, key, field, at, icon: Icon, title }) => (
            <div key={kind} className="tl-ap-promo-item">
              <h4>
                <Icon className="w-4 h-4" aria-hidden="true" /> {title}
                <Badge tone={TONE[event[field]]}>{LABEL[event[field]]}</Badge>
                {isPromotionActive(event, key) && <Badge tone="green">Running</Badge>}
              </h4>
              {event[at] && (
                <p className="tl-ap-meta">
                  Requested {new Date(event[at]).toLocaleString()}
                  {event[`${key}Days`] ? ` · for ${event[`${key}Days`]} days` : ''}
                </p>
              )}
              {isPromotionActive(event, key) && event[`${key}EndsAt`] && (
                <p className="tl-ap-meta">
                  Running since {formatPromoDay(event[`${key}StartsAt`] || event.promotionReviewedAt)}, until {formatPromoDay(event[`${key}EndsAt`])} ({promoTimeLeft(event[`${key}EndsAt`])})
                  {event[field] === 'REQUESTED' && '. Approving starts a new window from today and moves it back to the top.'}
                </p>
              )}
              {event[field] === 'APPROVED' && !isPromotionActive(event, key) && event[`${key}EndsAt`] && (
                <p className="tl-ap-meta">
                  {new Date(event[`${key}StartsAt`]) > new Date() ? 'Scheduled' : 'Ran'} {formatPromoDay(event[`${key}StartsAt`])} to {formatPromoDay(event[`${key}EndsAt`])}
                </p>
              )}
              <div className="tl-ap-promo-dates">
                <label>
                  <span>From</span>
                  <input type="date" className="tl-wz-input" value={windows[kind].from} onChange={setWindow(kind, 'from')} />
                </label>
                <label>
                  <span>Until (end of day)</span>
                  <input type="date" className="tl-wz-input" value={windows[kind].until} min={windows[kind].from} onChange={setWindow(kind, 'until')} />
                </label>
              </div>
              {kind === 'HERO' && (
                event.heroVideoUrl || event.heroVideoMobileUrl ? (
                  <div className="tl-ap-promo-videos">
                    {event.heroVideoUrl && <video src={resolveMediaUrl(event.heroVideoUrl)} muted loop playsInline controls preload="metadata" aria-label="Desktop promo video" />}
                    {event.heroVideoMobileUrl && <video src={resolveMediaUrl(event.heroVideoMobileUrl)} muted loop playsInline controls preload="metadata" aria-label="Phone promo video" />}
                  </div>
                ) : (
                  <p className="tl-ap-meta">No promo video: the hero will show the event banner.</p>
                )
              )}
              <div className="tl-ap-actions">
                <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => decide(kind, 'APPROVE')} disabled={Boolean(busy)}>
                  <CheckCircle2 className="w-4 h-4" /> {busy === `${kind}-APPROVE` ? 'Saving…' : event[field] === 'APPROVED' ? 'Save dates' : 'Approve for these dates'}
                </button>
                {event[field] !== 'REJECTED' && (
                  <button type="button" className="tl-wz-btn tl-ap-btn-reject" onClick={() => decide(kind, 'REJECT')} disabled={Boolean(busy)}>
                    <XCircle className="w-4 h-4" /> {busy === `${kind}-REJECT` ? 'Sending…' : event[field] === 'APPROVED' ? 'End with comment' : 'Reject with comment'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="tl-ap-form">
          <label htmlFor={`pr-comment-${event.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
            Comment for the organizer <span style={{ fontWeight: 400, color: 'var(--st-muted)' }}>(required to reject, optional to approve)</span>
          </label>
          <textarea id={`pr-comment-${event.id}`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="e.g. The hero slot is booked until the 20th; we’ll feature you from then." />
          {error && <p role="alert" style={{ color: 'var(--st-rose)', fontSize: 13.5 }}>{error}</p>}
          <div className="tl-ap-actions">
            <a href={`/events/${event.id}`} target="_blank" rel="noreferrer" className="tl-wz-btn">
              <Eye className="w-4 h-4" /> Preview event page
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
