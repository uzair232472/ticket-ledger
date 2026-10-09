import React, { useState } from 'react';
import { ArrowUpToLine, Building2, CalendarDays, CheckCircle2, Clapperboard, Eye, MapPin, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { getEventVisual, resolveMediaUrl } from '../../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';
import { Badge } from '../dash/Studio';
import { useDialog } from '../ui/DialogProvider';

const KINDS = [
  { kind: 'PRIORITY', field: 'priorityStatus', at: 'priorityRequestedAt', icon: ArrowUpToLine, title: 'Top of listings' },
  { kind: 'HERO', field: 'heroStatus', at: 'heroRequestedAt', icon: Clapperboard, title: 'Home page hero banner' },
];
const TONE = { REQUESTED: 'amber', APPROVED: 'green', REJECTED: 'rose' };
const LABEL = { REQUESTED: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected' };

/** Super Admin: one event's promotion requests, each approved or rejected on its own. */
export default function PromotionReviewCard({ event, onReviewed }) {
  const dialog = useDialog();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const time = formatEventTime(event.time);
  const requests = KINDS.filter((k) => event[k.field] && event[k.field] !== 'NONE');

  const decide = async (kind, decision) => {
    if (decision === 'REJECT' && comment.trim().length < 5) {
      setError('Add a comment so the organizer knows why.');
      return;
    }
    setBusy(`${kind}-${decision}`);
    setError('');
    try {
      const res = await api.post(`/admin/promotions/${event.id}`, { kind, decision, comment: comment.trim() });
      await dialog.alert({ tone: decision === 'APPROVE' ? 'success' : 'info', title: decision === 'APPROVE' ? 'Promotion approved' : 'Promotion rejected', message: `${res.data.message} The organizer has been notified.` });
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
          {requests.map(({ kind, field, at, icon: Icon, title }) => (
            <div key={kind} className="tl-ap-promo-item">
              <h4>
                <Icon className="w-4 h-4" aria-hidden="true" /> {title}
                <Badge tone={TONE[event[field]]}>{LABEL[event[field]]}</Badge>
              </h4>
              {event[at] && <p className="tl-ap-meta">Requested {new Date(event[at]).toLocaleString()}</p>}
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
                {event[field] !== 'APPROVED' && (
                  <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => decide(kind, 'APPROVE')} disabled={Boolean(busy)}>
                    <CheckCircle2 className="w-4 h-4" /> {busy === `${kind}-APPROVE` ? 'Approving…' : 'Approve'}
                  </button>
                )}
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
