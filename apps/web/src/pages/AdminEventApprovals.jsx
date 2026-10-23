import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarClock, Check, CheckCircle2, Eye, HelpCircle, Info, Mail, RefreshCw, XCircle } from 'lucide-react';
import api from '../utils/api';
import { formatEventTime } from '../utils/eventTime';
import { categoryName } from '../components/home/homeData';
import { Notice, notifyPendingChanged } from '../components/dash/DashShell';
import { useDialog } from '../components/ui/DialogProvider';
import PromotionReviewCard from '../components/promotion/PromotionReviewCard';
import ScheduleChangeCard from '../components/lifecycle/ScheduleChangeCard';
import RefundsAdmin from '../components/lifecycle/RefundsAdmin';
import ReviewThread from '../components/review/ReviewThread';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const day = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }) : '');

// Where a request stands. Promotions and date changes have no "waiting for organizer" state.
const STATUSES = [
  { value: 'REVIEW', label: 'Needs review' },
  { value: 'WAITING', label: 'Waiting for organizer' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];
// What the request is about. The first four are events from the same review list, filtered by kind.
const TYPES = [
  { value: 'ALL', label: 'All' },
  { value: 'NEW', label: 'New events' },
  { value: 'RESERVATION', label: 'Reservation requests' },
  { value: 'FINAL', label: 'Final approvals' },
  { value: 'PROMOTIONS', label: 'Promotions' },
  { value: 'CHANGES', label: 'Date changes' },
  { value: 'REFUNDS', label: 'Refunds' },
];
const EVENT_TYPES = ['ALL', 'NEW', 'RESERVATION', 'FINAL'];
// API status per type and status tab
const EVENT_STATUS = { REVIEW: 'PENDING_APPROVAL', WAITING: 'WAITING_ORGANIZER', APPROVED: 'PUBLISHED', REJECTED: 'REJECTED' };
const PROMO_STATUS = { REVIEW: 'REQUESTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
const CHANGE_STATUS = { REVIEW: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
// ?tab=promotions | changes | refunds (links in admin emails)
const TAB_PARAM = { promotions: 'PROMOTIONS', changes: 'CHANGES', refunds: 'REFUNDS' };

/** Which kind of event request this is: a new ticketed event, a prebooked date's reservation, or its final approval. */
const kindOf = (event) => {
  if (!event.prebookDraftId) return 'NEW';
  return event.stage === 'LAUNCH' || ['PENDING', 'APPROVED', 'CHANGES_REQUESTED'].includes(event.launchStatus) ? 'FINAL' : 'RESERVATION';
};
const KIND_TAG = { NEW: 'New event', RESERVATION: 'Reservation request', FINAL: 'Final approval' };
const STAGE_INFO = {
  NEW: { title: 'Ticketed event', text: 'Approving publishes the event and opens ticket sales.' },
  RESERVATION: { title: 'Reservation stage', text: 'Ticket and seating details will be reviewed after the organizer submits them.' },
  FINAL: { title: 'Final approval', text: 'The date is already reserved. Approving shows it publicly and opens ticket sales.' },
};

/** One submitted event: its details on the left, the admin's decision on the right. */
function ReviewCard({ event, onReviewed }) {
  const dialog = useDialog();
  const [choice, setChoice] = useState('APPROVE');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Optional other slot to suggest with a question (PKT date + time, like the event form)
  const [suggest, setSuggest] = useState(false);
  const [slot, setSlot] = useState({ date: '', time: '19:00', endDate: '', endTime: '22:00' });
  // Under review: the first approval, or a reserved prebooked date's final approval (stage LAUNCH)
  const pending = Boolean(event.stage);
  const launch = event.stage === 'LAUNCH';
  const waitingOnOrganizer = event.reviewRequest === 'CHANGES_REQUESTED' || event.launchStatus === 'CHANGES_REQUESTED';
  const kind = kindOf(event);
  const prebook = kind !== 'NEW';
  const time = formatEventTime(event.time);
  const needsMessage = choice !== 'APPROVE';

  const status = waitingOnOrganizer
    ? { tone: 'amber', label: 'Waiting for organizer' }
    : pending
      ? { tone: 'amber', label: 'Waiting for approval' }
      : event.status === 'REJECTED'
        ? { tone: 'rose', label: 'Rejected' }
        : { tone: 'green', label: prebook && kind === 'RESERVATION' ? 'Reserved' : 'Approved' };

  const options = [
    { value: 'APPROVE', label: 'Approve', text: launch ? 'Show this date publicly and open ticket sales.' : prebook ? 'Confirm the requested reservation.' : 'Publish the event and open ticket sales.' },
    { value: 'REQUEST_CHANGES', label: 'Request changes', text: 'Ask a question or suggest a different date.' },
    ...(launch ? [] : [{ value: 'REJECT', label: 'Reject', text: 'Decline the request with a reason.', danger: true }]),
  ];
  const submitLabel = {
    APPROVE: launch ? 'Give final approval' : prebook ? 'Approve reservation' : 'Approve & publish',
    REQUEST_CHANGES: suggest ? 'Suggest this date & ask' : 'Send question',
    REJECT: 'Reject request',
  }[choice];
  const submitNote = {
    APPROVE: launch ? 'Makes the date public and opens ticket sales.' : prebook ? 'Confirms the venue and time for this request.' : 'Puts the event on sale.',
    REQUEST_CHANGES: 'The request stays pending and its slot stays held until the organizer replies.',
    REJECT: 'Releases the venue slot. The organizer can change the request and send it again.',
  }[choice];

  const decide = async () => {
    if (needsMessage && comment.trim().length < 5) {
      setError(choice === 'REJECT' ? 'Add a reason so the organizer knows what to change.' : 'Write your question or what should change.');
      return;
    }
    const withSlot = choice === 'REQUEST_CHANGES' && suggest;
    if (withSlot && (!slot.date || !slot.time || !slot.endDate || !slot.endTime)) {
      setError('Fill in the suggested start and end, or untick “Suggest another date”.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/admin/event-reviews/${event.id}`, { decision: choice, comment: comment.trim(), suggested: withSlot ? slot : null });
      const title = choice === 'APPROVE' ? (launch ? 'Final approval given' : prebook ? 'Reservation confirmed' : 'Event approved') : choice === 'REJECT' ? 'Returned to the organizer' : 'Question sent';
      await dialog.alert({ tone: choice === 'APPROVE' ? 'success' : 'info', title, message: `${res.data.message} The organizer has been emailed.` });
      onReviewed(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the review.');
    } finally {
      setBusy(false);
    }
  };

  const info = STAGE_INFO[kind];

  return (
    <div className="tl-eva-row">
      <article className="tl-eva-card">
        <div className="tl-eva-tags">
          <span className={`tl-eva-tag is-${status.tone}`}>{status.label}</span>
          <span className="tl-eva-tag is-outline">{KIND_TAG[kind]}</span>
          {event.isHidden && !pending && <span className="tl-eva-tag is-amber">Hidden by organizer</span>}
        </div>
        <h2>{event.name}</h2>
        <p className="tl-eva-cat">{categoryName(event.type, event.categoryLabel)}</p>
        <p className="tl-eva-company"><Building2 className="w-5 h-5" aria-hidden="true" /> {event.company?.companyName}</p>

        <hr />
        <h3>Event details</h3>
        <dl className="tl-eva-facts">
          <div><dt>Requested date</dt><dd>{day(event.startsAt || event.date)}</dd></div>
          <div><dt>Start time</dt><dd>{time || '—'}</dd></div>
          <div><dt>Location</dt><dd>{event.city}<small>{event.venue}</small></dd></div>
          <div><dt>Seats</dt><dd>{(event._count?.seats || 0).toLocaleString()}</dd></div>
          {event.tiers?.length > 0 && (
            <div className="is-wide">
              <dt>Tickets</dt>
              <dd className="tl-ap-tiers">{event.tiers.map((t) => <span key={t.id}>{t.name} · {pkr(t.price)} · {t.totalQuantity}</span>)}</dd>
            </div>
          )}
        </dl>

        <hr />
        <dl className="tl-eva-facts">
          <div className="is-wide">
            <dt>{pending ? 'Submitted' : 'Reviewed'}</dt>
            <dd className="is-soft">
              {pending ? day(event.submittedAt) : `${day(event.reviewedAt)}${event.reviewedBy ? ` by ${event.reviewedBy}` : ''}`}
            </dd>
          </div>
        </dl>
        <a href={`/events/${event.id}`} target="_blank" rel="noreferrer" className="tl-eva-preview">
          <Eye className="w-5 h-5" aria-hidden="true" /> Preview event page
        </a>

        <div className="tl-eva-info">
          <Info className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>{info.title}</strong>
            <p>{info.text}</p>
          </div>
        </div>

        {event.reviewMessages?.length > 0 && (
          <details className="tl-eva-history" open={waitingOnOrganizer}>
            <summary>Review history ({event.reviewMessages.length})</summary>
            <ReviewThread messages={event.reviewMessages} viewer="ADMIN" />
          </details>
        )}
      </article>

      <aside className="tl-eva-card tl-eva-decide" aria-label={`Decision for ${event.name}`}>
        {pending ? (
          <>
            <h2>Your decision</h2>
            <p className="tl-eva-sub">Choose how to respond to this request.</p>
            {waitingOnOrganizer && <p className="tl-eva-wait">You asked the organizer something and they haven’t replied yet. You can still decide now.</p>}

            <div className="tl-eva-options" role="radiogroup" aria-label="Decision">
              {options.map((o) => (
                <label key={o.value} className={`tl-eva-option${choice === o.value ? ' is-on' : ''}${o.danger ? ' is-danger' : ''}`}>
                  <input type="radio" name={`decision-${event.id}`} value={o.value} checked={choice === o.value} onChange={() => { setChoice(o.value); setError(''); }} />
                  <span className="tl-eva-radio" aria-hidden="true" />
                  <span>
                    <strong>{o.label}</strong>
                    <small>{o.text}</small>
                  </span>
                </label>
              ))}
            </div>

            {choice === 'REQUEST_CHANGES' && (
              <>
                <label className="tl-eva-check">
                  <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />
                  <CalendarClock className="w-4 h-4" aria-hidden="true" /> Suggest another date and time (same venue)
                </label>
                {suggest && (
                  <div className="tl-rt-suggest">
                    <label>Start date<input type="date" value={slot.date} onChange={(e) => setSlot((s) => ({ ...s, date: e.target.value, endDate: !s.endDate || s.endDate === s.date ? e.target.value : s.endDate }))} /></label>
                    <label>Start time (PKT)<input type="time" value={slot.time} onChange={(e) => setSlot((s) => ({ ...s, time: e.target.value }))} /></label>
                    <label>End date<input type="date" value={slot.endDate} min={slot.date || undefined} onChange={(e) => setSlot((s) => ({ ...s, endDate: e.target.value }))} /></label>
                    <label>End time (PKT)<input type="time" value={slot.endTime} onChange={(e) => setSlot((s) => ({ ...s, endTime: e.target.value }))} /></label>
                  </div>
                )}
              </>
            )}

            <label htmlFor={`ap-comment-${event.id}`} className="tl-eva-label">
              Message to organizer <span>({needsMessage ? 'required' : 'optional'})</span>
            </label>
            <textarea
              id={`ap-comment-${event.id}`}
              className="tl-eva-textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              placeholder={choice === 'REJECT' ? 'Why is this request declined?' : choice === 'REQUEST_CHANGES' ? 'What should the organizer answer or change?' : 'Add a note for the organizer…'}
              aria-invalid={Boolean(error)}
            />
            <p className="tl-eva-mail"><Mail className="w-4 h-4" aria-hidden="true" /> The organizer will receive an email.</p>
            {error && <p role="alert" className="tl-eva-error">{error}</p>}

            <button type="button" className={`tl-eva-submit${choice === 'REJECT' ? ' is-danger' : ''}`} onClick={decide} disabled={busy}>
              {choice === 'REJECT' ? <XCircle className="w-5 h-5" /> : choice === 'REQUEST_CHANGES' ? <HelpCircle className="w-5 h-5" /> : <Check className="w-5 h-5" />}
              {busy ? 'Saving…' : submitLabel}
            </button>
            <p className="tl-eva-note">{submitNote}</p>
          </>
        ) : (
          <>
            <h2>Decision</h2>
            <p className="tl-eva-sub">
              {event.status === 'REJECTED' ? 'This request was rejected.' : prebook && kind === 'RESERVATION' ? 'This reservation was confirmed.' : 'This request was approved.'}
            </p>
            <dl className="tl-eva-facts">
              <div className="is-wide"><dt>Reviewed</dt><dd className="is-soft">{day(event.reviewedAt) || '—'}</dd></div>
              {event.reviewedBy && <div className="is-wide"><dt>By</dt><dd className="is-soft">{event.reviewedBy}</dd></div>}
            </dl>
            {event.reviewComment && <p className="tl-rv-comment">“{event.reviewComment}”</p>}
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * Super Admin: requests waiting for a decision. Events (new ticketed events, prebooked dates' reservations and
 * their final approval with tickets and seating), promotions, date changes and refunds, filtered by state and
 * request type. The organizer is emailed at every step.
 */
export default function AdminEventApprovals() {
  const [type, setType] = useState(() => TAB_PARAM[new URLSearchParams(window.location.search).get('tab')] || 'ALL');
  const [status, setStatus] = useState('REVIEW');
  const [changes, setChanges] = useState([]);
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isEvents = EVENT_TYPES.includes(type);
  // Promotions and date changes have no "waiting for organizer"
  const statuses = isEvents ? STATUSES : STATUSES.filter((s) => s.value !== 'WAITING');
  const activeStatus = statuses.some((s) => s.value === status) ? status : 'REVIEW';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, promo, change] = await Promise.all([
        isEvents ? api.get(`/admin/event-reviews?status=${EVENT_STATUS[activeStatus]}`) : null,
        api.get(`/admin/promotions?status=${type === 'PROMOTIONS' ? PROMO_STATUS[activeStatus] : 'REQUESTED'}`),
        api.get(`/admin/schedule-changes?status=${type === 'CHANGES' ? CHANGE_STATUS[activeStatus] : 'PENDING'}`),
      ]);
      if (isEvents) setEvents(res.data.data.events);
      if (type === 'PROMOTIONS') setEvents(promo.data.data.events);
      setChanges(change.data.data.changes);
      setCounts((prev) => ({ ...prev, ...(res ? res.data.data.counts || {} : {}), PROMOTIONS: promo.data.data.waiting, CHANGES: change.data.data.waiting }));
      notifyPendingChanged(); // the nav badge follows this page's numbers
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load requests for review.');
    } finally {
      setLoading(false);
    }
  }, [type, activeStatus, isEvents]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => (isEvents && type !== 'ALL' ? events.filter((ev) => kindOf(ev) === type) : events), [events, type, isEvents]);

  // Counts on the status tabs, for the chosen request type
  const tabCount = (value) => {
    if (isEvents) return { REVIEW: counts.PENDING_APPROVAL, WAITING: counts.WAITING_ORGANIZER, REJECTED: counts.REJECTED }[value] || 0;
    if (value !== 'REVIEW') return 0;
    return { PROMOTIONS: counts.PROMOTIONS, CHANGES: counts.CHANGES }[type] || 0;
  };
  const waiting = isEvents ? counts.PENDING_APPROVAL || 0 : type === 'REFUNDS' ? counts.REFUNDS || 0 : tabCount('REVIEW');
  const waitingText = type === 'REFUNDS'
    ? `${waiting} failed refund${waiting === 1 ? '' : 's'}`
    : `${waiting} request${waiting === 1 ? ' needs' : 's need'} review`;
  const typeLabel = (t) => {
    const n = { PROMOTIONS: counts.PROMOTIONS, CHANGES: counts.CHANGES, REFUNDS: counts.REFUNDS }[t.value];
    return n ? `${t.label} (${n})` : t.label;
  };
  const reviewed = (msg) => {
    setNotice(msg);
    load();
  };

  return (
    <div className="tl-eva">
      <header className="tl-eva-head">
        <div>
          <p className="tl-eva-crumbs"><span>Admin console</span><span>Event approvals</span></p>
          <h1>Event approvals</h1>
          <p className="tl-eva-intro">Review the event details, then choose a decision.</p>
        </div>
        <button type="button" className="tl-eva-refresh" onClick={load} disabled={loading}>
          <RefreshCw className={`w-5 h-5${loading ? ' tl-dash-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="tl-eva-bar">
        {type !== 'REFUNDS' ? (
          <div className="tl-eva-tabs" role="group" aria-label="Review state">
            {statuses.map((s) => (
              <button key={s.value} type="button" className="tl-eva-tab" aria-pressed={activeStatus === s.value} onClick={() => setStatus(s.value)}>
                {s.label}
                {tabCount(s.value) > 0 && <b>{tabCount(s.value)}</b>}
              </button>
            ))}
          </div>
        ) : <span />}
        <div className="tl-eva-bar-end">
          <span className="tl-eva-waiting" aria-live="polite">{waitingText}</span>
          <label className="tl-eva-type">
            <span>Request type:</span>
            <select value={type} onChange={(e) => { setType(e.target.value); setNotice(''); }}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{typeLabel(t)}</option>)}
            </select>
          </label>
        </div>
      </div>

      {type === 'PROMOTIONS' && <p className="tl-eva-hint">Organizers ask for their event to be listed first, or to fill the home page hero with their promo video. Approved promotions show only while the event is on sale.</p>}
      {type === 'CHANGES' && <p className="tl-eva-hint">Organizers moving an approved event to a new date, time or venue. Approving moves it; if tickets are sold it emails every holder and opens a refund window for anyone who can’t make the new date.</p>}

      {notice && <Notice tone="good" icon={CheckCircle2}>{notice}</Notice>}
      {error && <Notice tone="bad" icon={XCircle}>{error}</Notice>}

      {type === 'REFUNDS' ? (
        <RefundsAdmin onCounts={(c) => setCounts((prev) => (prev.REFUNDS === (c.FAILED || 0) ? prev : { ...prev, REFUNDS: c.FAILED || 0 }))} />
      ) : loading ? (
        <p className="tl-eva-hint">Loading…</p>
      ) : (type === 'CHANGES' ? changes : shown).length === 0 ? (
        <div className="tl-eva-empty">
          <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
          <h2>{activeStatus === 'REVIEW' ? 'Nothing waiting for review' : 'Nothing here yet'}</h2>
          {isEvents && type !== 'ALL' && events.length > 0 && <p>Other request types have {events.length} here. Set Request type to All to see them.</p>}
        </div>
      ) : type === 'CHANGES' ? (
        <div className="tl-ap-list">
          {changes.map((c) => <ScheduleChangeCard key={c.id} change={c} onReviewed={reviewed} />)}
        </div>
      ) : (
        <div className="tl-eva-list">
          {shown.map((ev) => (type === 'PROMOTIONS'
            ? <PromotionReviewCard key={ev.id} event={ev} onReviewed={reviewed} />
            : <ReviewCard key={ev.id} event={ev} onReviewed={reviewed} />))}
        </div>
      )}
    </div>
  );
}
