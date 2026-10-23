import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Armchair, CalendarDays, CheckCircle2, ChevronRight, Clock, ExternalLink, Eye,
  Layers, MapPin, MessageSquareWarning, Pencil, RefreshCw, Send, ShieldCheck, Ticket, XCircle,
} from 'lucide-react';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';
import { categoryName } from '../components/home/homeData';
import { googleMapsUrl } from '../utils/maps';
import SetupStepper from '../components/dash/SetupStepper';
import { useDialog } from '../components/ui/DialogProvider';
import PromotionPanel from '../components/promotion/PromotionPanel';
import ReviewThread, { slotLabel } from '../components/review/ReviewThread';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;
const SUBMITTABLE = ['DRAFT', 'PRELAUNCH_ANALYSIS', 'REJECTED'];

/** One readiness line: done / missing, with a fix link. */
const CheckRow = ({ ok, title, text, fix }) => (
  <li className={`tl-rv-check${ok ? ' is-ok' : ' is-missing'}`}>
    {ok ? <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> : <XCircle className="w-5 h-5" aria-hidden="true" />}
    <div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
    {fix}
  </li>
);

/**
 * Step 5 of event setup: preview everything attendees will see, check it is complete, and send it to
 * TicketLedger admins for approval. Also shows the review outcome (pending, approved, or the admin's
 * comment on a rejection) and lets a rejected event be resubmitted.
 */
export default function EventSubmit() {
  const dialog = useDialog();
  const { id } = useParams();
  const [params] = useSearchParams();
  const setup = params.get('setup') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState('');
  const promotionRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/events/${id}/submission`);
      setData(res.data.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this event.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // "Promote" from the dashboard opens this page at the promotion panel
  const loaded = Boolean(data);
  // A prebooked date approved as a reservation: its last step is a final approval with tickets and seating
  const reservedDate = Boolean(data?.event.prebookDraftId && data?.event.reservedAt);
  useEffect(() => {
    if (loaded && window.location.hash === '#promote') document.getElementById('promote')?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  const setVisible = async (visible) => {
    setSending(true);
    setError('');
    try {
      const res = await api.patch(`/prebook/events/${id}/visibility`, { hidden: !visible });
      setNotice(res.data.message);
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not change the visibility.');
    } finally {
      setSending(false);
    }
  };

  // Answer the admin's question; accepting moves the event to the suggested slot (checked again by the API)
  const sendReply = async (acceptSuggestion) => {
    if (reply.trim().length < 2) {
      setError('Write a reply for the admin.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await api.post(`/events/${id}/review-reply`, { message: reply.trim(), acceptSuggestion });
      setReply('');
      setNotice(res.data.message);
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const withdraw = async () => {
    const ok = await dialog.confirm({
      tone: 'warning',
      title: 'Withdraw from review?',
      message: 'It comes off the admins’ list so you can make changes. Your slot stays held. Send it again when it’s ready.',
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it in review',
    });
    if (!ok) return;
    setSending(true);
    setError('');
    try {
      const res = await api.post(`/events/${id}/review-withdraw`);
      setNotice(res.data.message);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not withdraw it.');
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    setSending(true);
    setError('');
    try {
      // A promotion ticked in the panel but not sent yet goes to the admins with the event
      const promotion = promotionRef.current;
      const withPromotion = Boolean(promotion?.hasPending());
      if (withPromotion && !(await promotion.sendPending())) return;
      const res = await api.post(`/events/${id}/submit`);
      setNotice(res.data.message);
      dialog.alert({ tone: 'success', title: reservedDate ? 'Sent for final approval' : 'Sent for approval', message: `A TicketLedger admin will review your ${reservedDate ? 'tickets, prices and seating' : 'event'}${withPromotion ? ' and your promotion request' : ''}. You’ll get an email with the decision.` });
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the event for approval.');
    } finally {
      setSending(false);
    }
  };

  if (error && !data) {
    return (
      <div className="tl-wz-card" style={{ maxWidth: 640, margin: '48px auto', textAlign: 'center' }}>
        <AlertCircle className="w-7 h-7" style={{ margin: '0 auto 12px', color: 'var(--st-rose)' }} />
        <h2>Can’t open this event</h2>
        <p style={{ margin: '8px 0 20px', color: 'var(--st-muted)' }}>{error}</p>
        <Link to="/organizer/dashboard" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
      </div>
    );
  }
  if (!data) {
    return <div className="tl-dash-state"><RefreshCw className="w-8 h-8 tl-dash-spin" style={{ color: 'var(--st-green)' }} aria-label="Loading" /></div>;
  }

  const { event, seating, canSubmit, canLaunch, waitingForOrganizer } = data;
  const launch = event.launchStatus;
  const askedLast = [...(event.reviewMessages || [])].reverse().find((m) => m.kind === 'CHANGES_REQUESTED');
  const status = event.status;
  const visual = getEventVisual(event, 0);
  const time = formatEventTime(event.time);
  const capacity = event.tiers.reduce((n, t) => n + t.totalQuantity, 0);
  const inSetup = setup || SUBMITTABLE.includes(status);
  const ready = event.tiers.length > 0 && (seating.published || seating.seats > 0);

  return (
    <div>
      <nav className="tl-wz-crumbs" aria-label="Breadcrumb">
        <Link to="/organizer/dashboard">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{event.name}</span>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-current="page">Review &amp; submit</span>
      </nav>

      <header className="tl-wz-head">
        <div>
          <h1 className="tl-wz-title">Review &amp; submit</h1>
          <p className="tl-wz-step-text">
            {inSetup ? 'Step 5 of 5 · ' : ''}
            {reservedDate ? 'Check your reserved date with its tickets and seating, then send it for final approval.' : 'Check how your event looks, then send it to TicketLedger for approval.'}
          </p>
        </div>
        {inSetup && <SetupStepper current={4} />}
      </header>

      {notice && <div className="tl-rv-banner is-ok" role="status"><CheckCircle2 className="w-5 h-5" aria-hidden="true" />{notice}</div>}
      {error && <div className="tl-wz-alert" role="alert"><AlertCircle className="w-4 h-4" />{error}</div>}

      {/* The admin asked something: reply (and accept a suggested slot) before they decide */}
      {waitingForOrganizer && (
        <div className="tl-rv-banner is-wait" role="alert">
          <MessageSquareWarning className="w-5 h-5" aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>TicketLedger needs your reply</strong>
            {askedLast?.message && <p className="tl-rv-comment">“{askedLast.message}”</p>}
            {event.suggestedStartsAt && (
              <p><strong>Suggested instead:</strong> {slotLabel(event.suggestedStartsAt, event.suggestedEndsAt)} (PKT) at {event.venue}, {event.city}.</p>
            )}
            <p>Nothing is decided yet and your slot is still held. Edit anything that needs changing, then reply.</p>
            <div className="tl-rt-reply">
              <label htmlFor="rv-reply" className="sr-only">Your reply</label>
              <textarea id="rv-reply" value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Yes, the new date works for us. We’ve also updated the banner." />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {event.suggestedStartsAt && (
                  <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => sendReply(true)} disabled={sending}>
                    <CalendarDays className="w-4 h-4" /> Accept suggested date &amp; reply
                  </button>
                )}
                <button type="button" className={`tl-wz-btn${event.suggestedStartsAt ? '' : ' tl-wz-btn--green'}`} onClick={() => sendReply(false)} disabled={sending}>
                  <Send className="w-4 h-4" /> {sending ? 'Sending…' : event.suggestedStartsAt ? 'Reply, keep my date' : 'Send reply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review outcome */}
      {status === 'PENDING_APPROVAL' && !waitingForOrganizer && (
        <div className="tl-rv-banner is-wait" role="status">
          <Clock className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Waiting for admin approval</strong>
            <p>Sent {event.submittedAt ? new Date(event.submittedAt).toLocaleString() : ''}. You’ll get an email when it’s approved or if changes are needed.</p>
          </div>
        </div>
      )}
      {status === 'REJECTED' && (
        <div className="tl-rv-banner is-bad" role="alert">
          <MessageSquareWarning className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Changes requested by TicketLedger</strong>
            <p className="tl-rv-comment">“{event.reviewComment}”</p>
            <p>Update the event, then send it for approval again below.</p>
          </div>
        </div>
      )}
      {reservedDate && ['NONE', 'PENDING'].includes(launch) && (
        <div className="tl-rv-banner is-wait" role="status">
          {launch === 'PENDING' ? <Clock className="w-5 h-5" aria-hidden="true" /> : <ShieldCheck className="w-5 h-5" aria-hidden="true" />}
          <div>
            <strong>{launch === 'PENDING' ? 'Reserved · waiting for final approval' : 'Reserved · hidden from the public'}</strong>
            <p>
              {launch === 'PENDING'
                ? `Sent ${event.launchSubmittedAt ? new Date(event.launchSubmittedAt).toLocaleString() : ''}. It goes public and on sale once an admin approves your tickets, prices and seating.`
                : ready
                  ? 'Tickets and seating are ready. Send them for final approval; the date goes on sale once it’s approved.'
                  : 'Add ticket tiers and save a seating plan, then send it for final approval.'}
            </p>
          </div>
        </div>
      )}
      {reservedDate && launch === 'APPROVED' && event.isHidden && (
        <div className="tl-rv-banner is-wait" role="status">
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Approved · hidden by you</strong>
            <p>Show it publicly whenever you’re ready.</p>
          </div>
        </div>
      )}
      {['PUBLISHED', 'PAUSED'].includes(status) && !(reservedDate && (launch !== 'APPROVED' || event.isHidden)) && (
        <div className="tl-rv-banner is-ok" role="status">
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          <div>
            <strong>Approved{status === 'PUBLISHED' ? ' and on sale' : ''}</strong>
            {event.reviewComment && <p className="tl-rv-comment">Admin note: “{event.reviewComment}”</p>}
          </div>
          <Link to={`/events/${event.id}`} className="tl-wz-btn">View event page <ExternalLink className="w-4 h-4" /></Link>
        </div>
      )}

      <div className="tl-wz-body">
        <div className="tl-wz-main">
          {/* Event preview: what attendees will see */}
          <section className="tl-wz-card tl-rv-preview" aria-labelledby="rv-title">
            <div className="tl-rv-hero">
              <img src={visual.bannerImage} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              <div className="tl-rv-hero-text">
                <p className="tl-rv-kicker">{categoryName(event.type, event.categoryLabel)} · {event.city}</p>
                <h2 id="rv-title">{event.name}</h2>
                <p className="tl-rv-meta">
                  <span><CalendarDays className="w-4 h-4" aria-hidden="true" /> {formatEventDate(event.date)}{time && ` · ${time}`}</span>
                  <a href={googleMapsUrl(event)} target="_blank" rel="noreferrer" className="tl-rv-maplink" title="Open in Google Maps">
                    <MapPin className="w-4 h-4" aria-hidden="true" /> {event.venue}, {event.city}{event.latitude != null ? ' · pinned' : ''}
                  </a>
                </p>
              </div>
            </div>
            <div className="tl-rv-section">
              <h3>About the event</h3>
              <p className="tl-rv-desc">{event.description}</p>
            </div>
            <div className="tl-rv-section">
              <h3>Tickets</h3>
              <ul className="tl-rv-tiers">
                {event.tiers.map((t) => (
                  <li key={t.id}>
                    <span><Ticket className="w-4 h-4" aria-hidden="true" /> {t.name}</span>
                    <span>{t.totalQuantity.toLocaleString()} tickets</span>
                    <strong>{pkr(t.price)}</strong>
                  </li>
                ))}
              </ul>
              <p className="tl-rv-total"><Layers className="w-4 h-4" aria-hidden="true" /> {event.tiers.length} tier{event.tiers.length === 1 ? '' : 's'} · {capacity.toLocaleString()} tickets in total</p>
            </div>
            <div className="tl-rv-section">
              <h3>Seating</h3>
              <p className="tl-rv-desc">
                {seating.published
                  ? `Seating plan saved (version ${seating.version}): ${seating.sections} section${seating.sections === 1 ? '' : 's'}, ${seating.seats.toLocaleString()} seats and places.`
                  : seating.seats > 0
                    ? `${seating.seats.toLocaleString()} seats from the seat grid.`
                    : 'No seating plan saved yet.'}
              </p>
            </div>
            <div className="tl-rv-preview-actions">
              <a href={`/events/${event.id}`} target="_blank" rel="noreferrer" className="tl-wz-btn">
                <Eye className="w-4 h-4" /> Open full event page preview
              </a>
            </div>
          </section>

          {event.reviewMessages?.length > 0 && (
            <section className="tl-wz-card" aria-labelledby="rv-history">
              <h2 id="rv-history" style={{ fontSize: 20, marginBottom: 10 }}>Review history</h2>
              <ReviewThread messages={event.reviewMessages} viewer="ORGANIZER" />
            </section>
          )}

          <div id="promote">
            <PromotionPanel ref={promotionRef} event={event} onChanged={load} />
          </div>
        </div>

        <aside className="tl-wz-card tl-rv-side" aria-labelledby="rv-ready">
          <h2 id="rv-ready" style={{ fontSize: 22 }}>Ready to send?</h2>
          <ul className="tl-rv-checks">
            <CheckRow
              ok
              title="Event details & images"
              text={`${formatEventDate(event.date)} · ${event.venue}`}
              fix={SUBMITTABLE.includes(status) && <Link to={`/organizer/events/${event.id}/edit`} aria-label="Edit details"><Pencil className="w-4 h-4" /></Link>}
            />
            <CheckRow
              ok={event.tiers.length > 0}
              title="Tickets & pricing"
              text={`${event.tiers.length} tier${event.tiers.length === 1 ? '' : 's'}, from ${pkr(event.tiers[0]?.price)}`}
              fix={SUBMITTABLE.includes(status) && <Link to={`/demand-forecast?eventId=${event.id}`} aria-label="Adjust prices"><Pencil className="w-4 h-4" /></Link>}
            />
            <CheckRow
              ok={seating.published || seating.seats > 0}
              title="Seating plan"
              text={seating.published || seating.seats > 0 ? `${seating.seats.toLocaleString()} seats ready` : 'Save a seating plan so attendees can pick seats.'}
              fix={<Link to={`/organizer/events/${event.id}/venue${setup ? '?setup=1' : ''}`} aria-label="Edit seating"><Armchair className="w-4 h-4" /></Link>}
            />
          </ul>

          {SUBMITTABLE.includes(status) ? (
            <>
              <button type="button" className="tl-wz-btn tl-wz-btn--green tl-rv-send" onClick={submit} disabled={!canSubmit || sending}>
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : status === 'REJECTED' ? 'Send to admin again' : 'Send to admin for approval'}
              </button>
              <p className="tl-rv-fine">An admin checks your event before it goes on sale. You’ll get an email with the decision and any comments.</p>
            </>
          ) : reservedDate && launch === 'NONE' ? (
            <>
              <button type="button" className="tl-wz-btn tl-wz-btn--green tl-rv-send" onClick={submit} disabled={!canLaunch || sending}>
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send for final approval'}
              </button>
              <p className="tl-rv-fine">Your date is reserved. An admin now checks the tickets, prices and seating before it goes public and on sale.</p>
            </>
          ) : reservedDate && launch === 'PENDING' ? (
            <>
              <p className="tl-rv-fine"><Clock className="w-4 h-4" aria-hidden="true" /> Sent for final approval. Tickets, prices and seating are locked while the admin reviews them.</p>
              <button type="button" className="tl-wz-btn" style={{ marginTop: 10 }} onClick={withdraw} disabled={sending}>Withdraw to make changes</button>
            </>
          ) : reservedDate && launch === 'APPROVED' && ['PUBLISHED', 'PAUSED'].includes(status) ? (
            <>
              {event.isHidden ? (
                <button type="button" className="tl-wz-btn tl-wz-btn--green tl-rv-send" onClick={() => setVisible(true)} disabled={!ready || sending}>
                  <Eye className="w-4 h-4" /> {sending ? 'Saving…' : 'Show publicly'}
                </button>
              ) : (
                <button type="button" className="tl-wz-btn tl-rv-send" onClick={() => setVisible(false)} disabled={sending}>
                  <Eye className="w-4 h-4" /> {sending ? 'Saving…' : 'Hide from public'}
                </button>
              )}
              <p className="tl-rv-fine">Final approval given. Hiding keeps the reservation and any sold tickets.</p>
            </>
          ) : status === 'PENDING_APPROVAL' && !waitingForOrganizer ? (
            <>
              <p className="tl-rv-fine"><Clock className="w-4 h-4" aria-hidden="true" /> Sent. The event is locked while the admin reviews it, so they approve exactly what you sent.</p>
              <button type="button" className="tl-wz-btn" style={{ marginTop: 10 }} onClick={withdraw} disabled={sending}>Withdraw to make changes</button>
            </>
          ) : null}

          {inSetup && (
            <Link to={`/organizer/events/${event.id}/venue${setup ? '?setup=1' : ''}`} className="tl-wz-btn" style={{ marginTop: 10 }}>
              <ArrowLeft className="w-4 h-4" /> Back: Seating plan
            </Link>
          )}
          <Link to="/organizer/dashboard" className="tl-wz-btn" style={{ marginTop: 10 }}>
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </aside>
      </div>
    </div>
  );
}
