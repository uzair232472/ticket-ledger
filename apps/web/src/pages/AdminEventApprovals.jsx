import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CalendarDays, CheckCircle2, Clock, Eye, MapPin, RefreshCw, Ticket, XCircle } from 'lucide-react';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';
import { categoryName } from '../components/home/homeData';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, Badge } from '../components/dash/Studio';
import { useDialog } from '../components/ui/DialogProvider';
import PromotionReviewCard from '../components/promotion/PromotionReviewCard';
import ScheduleChangeCard from '../components/lifecycle/ScheduleChangeCard';
import RefundsAdmin from '../components/lifecycle/RefundsAdmin';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const TABS = [
  { value: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { value: 'REJECTED', label: 'Changes requested' },
  { value: 'PUBLISHED', label: 'Approved' },
  { value: 'PROMOTIONS', label: 'Promotion requests' },
  { value: 'CHANGES', label: 'Date changes' },
  { value: 'REFUNDS', label: 'Refunds' },
];
const CHANGE_STATES = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];
// ?tab=promotions | changes | refunds (links in admin emails)
const TAB_PARAM = { promotions: 'PROMOTIONS', changes: 'CHANGES', refunds: 'REFUNDS' };
const PROMO_STATES = [
  { value: 'REQUESTED', label: 'Waiting' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** One submitted event: preview link, details, comment box and approve / reject. */
function ReviewCard({ event, onReviewed }) {
  const dialog = useDialog();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = event.status === 'PENDING_APPROVAL';
  // A prebooked date: approving confirms a venue reservation rather than putting tickets on sale
  const prebook = Boolean(event.prebookDraftId);
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
      await dialog.alert({ tone: decision === 'APPROVE' ? 'success' : 'info', title: decision === 'APPROVE' ? (prebook ? 'Reservation confirmed' : 'Event approved') : 'Returned to the organizer', message: `${res.data.message} The organizer has been emailed.` });
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
            {pending ? 'Waiting' : event.status === 'REJECTED' ? 'Changes requested' : prebook ? 'Reserved' : 'Approved'}
          </Badge>
          {prebook && <Badge tone="green">Reservation request</Badge>}
          {event.isHidden && !pending && <Badge tone="amber">Hidden by organizer</Badge>}
          <span className="tl-ap-meta">{categoryName(event.type, event.categoryLabel)}</span>
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
                <CheckCircle2 className="w-4 h-4" /> {busy === 'APPROVE' ? 'Approving…' : prebook ? 'Approve & confirm reservation' : 'Approve & publish'}
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
  const [tab, setTab] = useState(() => TAB_PARAM[new URLSearchParams(window.location.search).get('tab')] || 'PENDING_APPROVAL');
  const [promoState, setPromoState] = useState('REQUESTED');
  const [changeState, setChangeState] = useState('PENDING');
  const [changes, setChanges] = useState([]);
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Review counts come from the approvals list; the other badges from their own lists
      const reviewTab = ['PENDING_APPROVAL', 'REJECTED', 'PUBLISHED'].includes(tab);
      const [res, promo, change] = await Promise.all([
        reviewTab ? api.get(`/admin/event-reviews?status=${tab}`) : null,
        api.get(`/admin/promotions?status=${tab === 'PROMOTIONS' ? promoState : 'REQUESTED'}`),
        api.get(`/admin/schedule-changes?status=${tab === 'CHANGES' ? changeState : 'PENDING'}`),
      ]);
      if (reviewTab) setEvents(res.data.data.events);
      if (tab === 'PROMOTIONS') setEvents(promo.data.data.events);
      setChanges(change.data.data.changes);
      setCounts((prev) => ({ ...(res ? res.data.data.counts || {} : prev), PROMOTIONS: promo.data.data.waiting, CHANGES: change.data.data.waiting }));
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load events for review.');
    } finally {
      setLoading(false);
    }
  }, [tab, promoState, changeState]);

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

      {tab === 'PROMOTIONS' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
          <select className="tl-st-filter" value={promoState} onChange={(e) => setPromoState(e.target.value)} aria-label="Request state">
            {PROMO_STATES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
          <p style={{ color: 'var(--st-muted)', fontSize: 13.5, maxWidth: 640 }}>
            Organizers ask for their event to be listed first, or to fill the home page hero with their promo video. Approved promotions show only while the event is on sale.
          </p>
        </div>
      )}

      {tab === 'CHANGES' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
          <select className="tl-st-filter" value={changeState} onChange={(e) => setChangeState(e.target.value)} aria-label="Change state">
            {CHANGE_STATES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
          <p style={{ color: 'var(--st-muted)', fontSize: 13.5, maxWidth: 640 }}>
            Organizers moving an event that already has ticket holders. Approving moves it, emails every holder, and opens a refund window for anyone who can’t make the new date. Small same-day changes go live without review.
          </p>
        </div>
      )}

      {notice && <Notice tone="good" icon={CheckCircle2}>{notice}</Notice>}
      {error && <Notice tone="bad" icon={XCircle}>{error}</Notice>}

      {tab === 'REFUNDS' ? (
        <RefundsAdmin onCounts={(c) => setCounts((prev) => (prev.REFUNDS === (c.FAILED || 0) ? prev : { ...prev, REFUNDS: c.FAILED || 0 }))} />
      ) : tab === 'CHANGES' ? (
        loading ? (
          <p style={{ color: 'var(--st-muted)' }}>Loading…</p>
        ) : changes.length === 0 ? (
          <div className="tl-wz-card" style={{ textAlign: 'center' }}>
            <CheckCircle2 className="w-7 h-7" style={{ margin: '0 auto 10px', color: 'var(--st-green)' }} />
            <h2 style={{ fontSize: 22 }}>{changeState === 'PENDING' ? 'No date changes waiting' : 'Nothing here yet'}</h2>
          </div>
        ) : (
          <div className="tl-ap-list">
            {changes.map((c) => (
              <ScheduleChangeCard
                key={c.id}
                change={c}
                onReviewed={(msg) => {
                  setNotice(msg);
                  load();
                }}
              />
            ))}
          </div>
        )
      ) : loading ? (
        <p style={{ color: 'var(--st-muted)' }}>Loading…</p>
      ) : events.length === 0 ? (
        <div className="tl-wz-card" style={{ textAlign: 'center' }}>
          <CheckCircle2 className="w-7 h-7" style={{ margin: '0 auto 10px', color: 'var(--st-green)' }} />
          <h2 style={{ fontSize: 22 }}>{tab === 'PENDING_APPROVAL' || (tab === 'PROMOTIONS' && promoState === 'REQUESTED') ? 'Nothing waiting for approval' : 'No events here yet'}</h2>
        </div>
      ) : (
        <div className="tl-ap-list">
          {events.map((ev) => tab === 'PROMOTIONS' ? (
            <PromotionReviewCard
              key={ev.id}
              event={ev}
              onReviewed={(msg) => {
                setNotice(msg);
                load();
              }}
            />
          ) : (
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
