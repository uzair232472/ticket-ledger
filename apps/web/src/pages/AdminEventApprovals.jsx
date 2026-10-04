import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Clock, Eye, MapPin, RefreshCw, Ticket, XCircle } from 'lucide-react';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';
import { categoryName } from '../components/home/homeData';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, Badge } from '../components/dash/Studio';
import { useDialog } from '../components/ui/DialogProvider';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const TABS = [
  { value: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { value: 'REJECTED', label: 'Changes requested' },
  { value: 'PUBLISHED', label: 'Approved' },
];

/** One submitted event: preview link, details, comment box and approve / reject. */
function ReviewCard({ event, onReviewed }) {
  const dialog = useDialog();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = event.status === 'PENDING_APPROVAL';
  const time = formatEventTime(event.time);

  const decide = async (decision) => {
    if (decision === 'REJECT' && comment.trim().length < 5) {
      setError('Add a comment so the organizer knows what to change.');
      return;
    }
    setBusy(decision);
    setError('');
    try {
      const res = await api.post(`/admin/event-reviews/${event.id}`, { decision, comment: comment.trim() });
      await dialog.alert({ tone: decision === 'APPROVE' ? 'success' : 'info', title: decision === 'APPROVE' ? 'Event approved' : 'Returned to the organizer', message: `${res.data.message} The organizer has been emailed.` });
      onReviewed(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the review.');
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
          <Badge tone={pending ? 'amber' : event.status === 'REJECTED' ? 'rose' : 'green'}>
            {pending ? 'Waiting' : event.status === 'REJECTED' ? 'Changes requested' : 'Approved'}
          </Badge>
          <span className="tl-ap-meta">{categoryName(event.type)}</span>
        </div>
        <h3>{event.name}</h3>
        <p className="tl-ap-meta">
          <span><Building2 className="w-4 h-4" aria-hidden="true" /> {event.company?.companyName}</span>
          <span><CalendarDays className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</span>
          <span><MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}, {event.city}</span>
          <span><Ticket className="w-4 h-4" aria-hidden="true" /> {event._count?.seats?.toLocaleString() || 0} seats</span>
        </p>
        <div className="tl-ap-tiers">
          {event.tiers.map((t) => <span key={t.id}>{t.name} · {pkr(t.price)} · {t.totalQuantity}</span>)}
        </div>
        <p className="tl-ap-meta">
          <span><Clock className="w-4 h-4" aria-hidden="true" />
            {pending
              ? `Submitted ${event.submittedAt ? new Date(event.submittedAt).toLocaleString() : ''}`
              : `Reviewed ${event.reviewedAt ? new Date(event.reviewedAt).toLocaleString() : ''}${event.reviewedBy ? ` by ${event.reviewedBy}` : ''}`}
          </span>
        </p>
        {!pending && event.reviewComment && <p className="tl-rv-comment">“{event.reviewComment}”</p>}

        <div className="tl-ap-actions">
          <a href={`/events/${event.id}`} target="_blank" rel="noreferrer" className="tl-wz-btn">
            <Eye className="w-4 h-4" /> Preview event page
          </a>
        </div>

        {pending && (
          <div className="tl-ap-form">
            <label htmlFor={`ap-comment-${event.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
              Comment for the organizer <span style={{ fontWeight: 400, color: 'var(--st-muted)' }}>(required to reject, optional to approve)</span>
            </label>
            <textarea
              id={`ap-comment-${event.id}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Please add the full venue address and a clearer banner image."
            />
            {error && <p role="alert" style={{ color: 'var(--st-rose)', fontSize: 13.5 }}>{error}</p>}
            <div className="tl-ap-actions">
              <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => decide('APPROVE')} disabled={Boolean(busy)}>
                <CheckCircle2 className="w-4 h-4" /> {busy === 'APPROVE' ? 'Approving…' : 'Approve & publish'}
              </button>
              <button type="button" className="tl-wz-btn tl-ap-btn-reject" onClick={() => decide('REJECT')} disabled={Boolean(busy)}>
                <XCircle className="w-4 h-4" /> {busy === 'REJECT' ? 'Sending…' : 'Reject with comment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Super Admin: events organizers have sent for approval. Approving puts an event on sale; rejecting
 * returns it with a comment. The organizer is emailed either way.
 */
export default function AdminEventApprovals() {
  const [tab, setTab] = useState('PENDING_APPROVAL');
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/event-reviews?status=${tab}`);
      setEvents(res.data.data.events);
      setCounts(res.data.data.counts || {});
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load events for review.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <StudioHead
        crumbs={['Admin console', 'Event approvals']}
        title="Event approvals"
        intro="Events organizers have sent for approval. Approve to put an event on sale, or return it with a comment. The organizer gets an email either way."
        actions={
          <button type="button" className="tl-wz-btn" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4${loading ? ' tl-dash-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <div className="tl-ap-tabs" role="group" aria-label="Review state">
        {TABS.map((t) => (
          <button key={t.value} type="button" className="tl-ap-tab" aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
            {counts[t.value] > 0 && <b>{counts[t.value]}</b>}
          </button>
        ))}
      </div>

      {notice && <Notice tone="good" icon={CheckCircle2}>{notice}</Notice>}
      {error && <Notice tone="bad" icon={XCircle}>{error}</Notice>}

      {loading ? (
        <p style={{ color: 'var(--st-muted)' }}>Loading…</p>
      ) : events.length === 0 ? (
        <div className="tl-wz-card" style={{ textAlign: 'center' }}>
          <CheckCircle2 className="w-7 h-7" style={{ margin: '0 auto 10px', color: 'var(--st-green)' }} />
          <h2 style={{ fontSize: 22 }}>{tab === 'PENDING_APPROVAL' ? 'Nothing waiting for approval' : 'No events here yet'}</h2>
        </div>
      ) : (
        <div className="tl-ap-list">
          {events.map((ev) => (
            <ReviewCard
              key={ev.id}
              event={ev}
              onReviewed={(msg) => {
                setNotice(msg);
                load();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
