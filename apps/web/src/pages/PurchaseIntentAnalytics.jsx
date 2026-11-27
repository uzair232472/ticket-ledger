import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, StudioSelect, StatCard, Panel, Badge, Avatar, ScoreBar } from '../components/dash/Studio';
import Pager, { pageOf } from '../components/dash/Pager';
import { InsightBoundary, IntentInsightPanel } from '../components/ml/InsightPanels';
import {
  Users,
  BarChart3,
  ShoppingCart,
  Filter,
  AlertTriangle,
  Send,
  CheckCircle,
  RefreshCw,
  CalendarDays,
  Mail,
  Check,
  User,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PAGE_SIZE = 5; // rows per page in both tables

const levelTone = (level = '') => (/high/i.test(level) ? 'green' : /moderate|medium/i.test(level) ? 'green' : 'grey');
const stageLabel = (stage = '') => stage.replace(/_/g, ' ').toLowerCase();
// "SEND_LIMITED_OFFER_REMINDER" -> "Limited offer reminder"
const actionLabel = (code = '') => {
  const text = String(code).replace(/^(SEND|DISPATCH|TRIGGER)_/, '').replace(/_/g, ' ').toLowerCase().trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

export default function PurchaseIntentAnalytics() {
  const { eventId: paramEventId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(paramEventId || '');
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0); // users likely to buy
  const [recoveryPage, setRecoveryPage] = useState(0); // cart recovery table

  // Reminder status per user ID
  const [sentReminders, setSentReminders] = useState({});
  const [sendingUserId, setSendingUserId] = useState(null);
  const [batchSending, setBatchSending] = useState(null); // 'HIGH_INTENT' | 'ABANDONED' | null
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);

  // 1. Events for the picker
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events?limit=20`);
        const json = await res.json();
        if (json.success && json.data.events.length > 0) {
          setEventsList(json.data.events);
          if (!selectedEventId) setSelectedEventId(json.data.events[0].id);
        }
      } catch (err) {
        console.error('Failed to load events list:', err);
      }
    };
    fetchEvents();
  }, []);

  // 2. Analytics for the selected event
  const fetchAnalytics = async (eventId) => {
    if (!eventId) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/analytics/intent/${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAnalytics(json.data);
        setPage(0);
        setRecoveryPage(0);
      } else {
        setError(json.message || 'Failed to fetch purchase intent analytics');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (selectedEventId) fetchAnalytics(selectedEventId);
  }, [selectedEventId]);

  const handleSelectEvent = (e) => {
    const newId = e.target.value;
    setSelectedEventId(newId);
    navigate(`/analytics/intent/${newId}`);
  };

  // 3. One reminder
  const handleSendReminder = async (targetUserId, reminderType = 'EVENT_REMINDER') => {
    if (!targetUserId) return;
    setSendingUserId(targetUserId);
    setActionSuccessMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/analytics/intent/${selectedEventId}/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserId, reminderType }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSentReminders((prev) => ({ ...prev, [targetUserId]: true }));
        setActionSuccessMsg('Reminder sent. The attendee gets an in-app notification and an email.');
        setTimeout(() => setActionSuccessMsg(null), 5000);
      } else {
        setError(json.message || 'Failed to send reminder');
      }
    } catch (err) {
      setError(`Error sending reminder: ${err.message}`);
    } finally {
      setSendingUserId(null);
    }
  };

  // 4. Batch reminders
  const handleBatchReminder = async (targetAudience) => {
    setBatchSending(targetAudience);
    setActionSuccessMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/analytics/intent/${selectedEventId}/batch-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetAudience }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setActionSuccessMsg(json.message);
        setTimeout(() => setActionSuccessMsg(null), 6000);
      } else {
        setError(json.message || 'Failed to send reminders');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setBatchSending(null);
    }
  };

  const summary = analytics?.summary || {};
  const funnel = analytics?.funnel || [];
  const likely = analytics?.usersLikelyToBuy || [];
  const abandoned = analytics?.abandonedUsers || [];
  const likelyPage = pageOf(likely, page, PAGE_SIZE);
  const pageRows = likelyPage.rows;
  const recoveryRows = pageOf(abandoned, recoveryPage, PAGE_SIZE);

  const reminderButton = (userId, type, tone = 'green') => {
    if (!userId) return <span className="tl-guest">Guest session</span>;
    const isSent = sentReminders[userId];
    const isSending = sendingUserId === userId;
    return (
      <button
        type="button"
        onClick={() => handleSendReminder(userId, type)}
        disabled={isSent || isSending}
        className={`tl-st-btn tl-st-btn--xs ${isSent ? 'tl-st-btn--done' : tone === 'amber' ? 'tl-st-btn--amber' : 'tl-st-btn--green'}`}
      >
        {isSent ? <><Check className="w-4 h-4" /> Sent</> : isSending ? <><RefreshCw className="w-4 h-4 tl-dash-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send reminder</>}
      </button>
    );
  };

  return (
    <div>
      <StudioHead
        crumbs={['Insights', 'Purchase intent']}
        title="Purchase intent"
        intro={
          analytics?.eventName ? (
            <>
              {analytics.eventName}{analytics.companyName ? `, hosted by ${analytics.companyName}` : ''}.
              <br />
              How visitors move from the event page to seat pick, checkout and payment.
            </>
          ) : 'How visitors move from the event page to seat pick, checkout and payment.'
        }
        controls={
          <StudioSelect icon={CalendarDays} value={selectedEventId} onChange={handleSelectEvent} label="Event" wide>
            {eventsList.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name} ({ev.city})</option>
            ))}
          </StudioSelect>
        }
        actions={
          <button type="button" className="tl-st-btn tl-st-btn--light" onClick={() => fetchAnalytics(selectedEventId)} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'tl-dash-spin' : ''}`} /> Refresh data
          </button>
        }
      />

      {actionSuccessMsg && <Notice tone="good" icon={CheckCircle} onDismiss={() => setActionSuccessMsg(null)}>{actionSuccessMsg}</Notice>}
      {error && <Notice tone="bad" icon={AlertTriangle} onDismiss={() => setError(null)}>{error}</Notice>}

      {loading && !analytics ? (
        <div className="tl-dash-state"><RefreshCw className="w-7 h-7 tl-dash-spin" /><p>Loading purchase intent and funnel data…</p></div>
      ) : (
        <>
          <div className="tl-sc-grid">
            <StatCard
              icon={Users}
              tone="ink"
              label="Event watchers"
              value={(summary.totalWatchers || 0).toLocaleString()}
              note={`People who opened the event page: ${summary.signedInWatchers ?? 0} signed in, ${summary.guestWatchers ?? 0} guest sessions`}
            />
            <StatCard
              icon={BarChart3}
              tone="green"
              label="Likely to buy (not bought yet)"
              value={summary.usersLikelyToBuyCount || 0}
              unit={`(Avg: ${summary.avgIntentScore || 0}/100)`}
              note={`Score 55+: ${summary.highIntentCount ?? 0} high (75+), ${summary.moderateIntentCount ?? 0} moderate (55–74). Buyers are not counted.`}
            />
            <StatCard
              icon={ShoppingCart}
              tone="amber"
              label="Abandoned checkouts"
              value={summary.abandonedCheckouts ?? 0}
              note={`Checkouts started but not paid, by ${summary.abandonedCheckoutPeople ?? 0} ${summary.abandonedCheckoutPeople === 1 ? 'person' : 'people'}. Still to recover (not bought later): ${summary.abandonedUsersCount || 0}`}
            />
            <StatCard
              icon={Filter}
              tone="blue"
              label="Funnel conversion"
              value={`${summary.overallConversionRate || 0}%`}
              note={`${summary.buyersCount ?? summary.ticketsIssuedCount ?? 0} of ${summary.totalWatchers || 0} watchers bought tickets`}
            />
          </div>

          {/* Step 6: totals from the background visit scoring; the experimental model is display-only */}
          <InsightBoundary><div style={{ marginTop: 16 }}><IntentInsightPanel eventId={selectedEventId} /></div></InsightBoundary>

          <div className="tl-pi-row tl-pi-row--single">
            <Panel
              icon={BarChart3}
              title="Event conversion funnel"
              sub="Counts PEOPLE, not attempts: each person is counted once at the furthest step they reached. A person who abandoned a checkout and paid later counts as paid."
              action={<span className="tl-total-pill">Total pipeline volume: <strong>{summary.totalWatchers || 0}</strong></span>}
            >
              <div className="tl-funnel">
                {funnel.map((step, idx) => (
                  <div key={step.key} className="tl-funnel-step">
                    <span className="tl-funnel-num">{idx + 1}</span>
                    <span className="tl-funnel-name">
                      {step.stage}
                      {idx > 0 && step.dropoff > 0 && <Badge tone="rose">−{step.dropoff} drop-off</Badge>}
                    </span>
                    <span className="tl-funnel-count">{step.count.toLocaleString()}</span>
                    <span className="tl-funnel-pct">{step.percent}%</span>
                    <span className="tl-funnel-bar" aria-hidden="true"><span style={{ width: `${Math.max(step.percent, 2)}%` }} /></span>
                  </div>
                ))}
                {funnel.length === 0 && <p className="tl-empty-row">No funnel activity yet.</p>}
              </div>
              {(summary.abandonedCheckouts || 0) > 0 && (
                <p className="tl-pn-sub" style={{ marginTop: 12 }}>
                  Attempts: {summary.abandonedCheckouts} checkout{summary.abandonedCheckouts === 1 ? ' was' : 's were'} started and not paid
                  (by {summary.abandonedCheckoutPeople} {summary.abandonedCheckoutPeople === 1 ? 'person' : 'people'}).
                  {(summary.abandonedUsersCount || 0) === 0 ? ' All of them bought later, so nobody needs a recovery reminder.' : ''}
                </p>
              )}
            </Panel>

          </div>

          {/* Users likely to buy */}
          <Panel
            flush
            icon={User}
            title="Users likely to buy"
            badge={`${likely.length} qualified`}
            sub={`People who have NOT bought yet with a rule score of 55+ (40 base, +15 for 3+ views, +20 seat chosen, +25 checkout started, −10 left a checkout). ${summary.buyersCount || 0} ${summary.buyersCount === 1 ? 'buyer is' : 'buyers are'} left out. No AI model is used.`}
            action={
              <button
                type="button"
                className="tl-st-btn tl-st-btn--green"
                onClick={() => handleBatchReminder('HIGH_INTENT')}
                disabled={Boolean(batchSending) || !likely.some((u) => u.userId)}
              >
                {batchSending === 'HIGH_INTENT' ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />}
                {batchSending === 'HIGH_INTENT' ? 'Sending…' : 'Send reminders to all high intent'}
              </button>
            }
          >
            {likely.length === 0 ? (
              <p className="tl-empty-row">No high-intent users detected yet. This updates as attendees browse.</p>
            ) : (
              <>
                <div className="tl-stb-wrap">
                  <table className="tl-stb">
                    <thead>
                      <tr>
                        <th>Attendee / prospect</th>
                        <th>Purchase intent score</th>
                        <th>Telemetry actions</th>
                        <th>Recommended action</th>
                        <th>Reminder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((p) => {
                        const offer = /offer|discount|limited/i.test(p.recommendedAction || '');
                        return (
                          <tr key={p.identifier}>
                            <td>
                              <div className="tl-who">
                                {p.isRegistered ? <Avatar name={p.userName} /> : <Avatar guest icon={User} />}
                                <div style={{ minWidth: 0 }}>
                                  <div className="tl-who-name">{p.userName}</div>
                                  <div className="tl-who-mail">{p.userEmail || p.identifier}</div>
                                  {p.isRegistered && <div className="tl-who-tags"><Badge tone="blue">Verified user</Badge></div>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="tl-score">
                                <ScoreBar value={p.intentScore} />
                                <strong>{p.intentScore}/100</strong>
                                <Badge tone={levelTone(p.intentLevel)}>{p.intentLevel}</Badge>
                              </span>
                            </td>
                            <td>
                              <div className="tl-telemetry">
                                <span>Views: <b>{p.views}</b></span>
                                <span>Seats selected: <b>{p.seatSelections}</b></span>
                                <span>Checkouts: <b>{p.checkoutStarts}</b>{p.abandonedCheckouts > 0 && <> (left <b>{p.abandonedCheckouts}</b>)</>}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`tl-action-chip${p.userId ? '' : ' is-muted'}`}>
                                {offer ? <Mail className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
                                {actionLabel(p.recommendedAction)}
                              </span>
                            </td>
                            <td>{reminderButton(p.userId, 'EVENT_REMINDER')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="tl-pi-pager"><Pager page={likelyPage.page} total={likely.length} onPage={setPage} label="Users likely to buy" size={PAGE_SIZE} /></div>
              </>
            )}
          </Panel>

          {/* Cart recovery */}
          <Panel
            flush
            className="tl-section-gap"
            icon={ShoppingCart}
            title="TicketLedger users & cart recovery"
            badge={`${abandoned.length} dropouts`}
            badgeTone="amber"
            sub="Attendees who selected seats or reached checkout but left without completing payment"
            action={
              <button
                type="button"
                className="tl-st-btn tl-st-btn--green"
                onClick={() => handleBatchReminder('ABANDONED')}
                disabled={Boolean(batchSending) || !abandoned.some((u) => u.userId)}
              >
                {batchSending === 'ABANDONED' ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />}
                {batchSending === 'ABANDONED' ? 'Sending…' : 'Send recovery reminders'}
              </button>
            }
          >
            {abandoned.length === 0 ? (
              <p className="tl-empty-row">
                {(summary.abandonedCheckouts || 0) > 0
                  ? `Nobody to recover: the ${summary.abandonedCheckoutPeople} ${summary.abandonedCheckoutPeople === 1 ? 'person' : 'people'} who left ${summary.abandonedCheckouts} checkout${summary.abandonedCheckouts === 1 ? '' : 's'} bought tickets later.`
                  : 'No abandoned checkouts recorded for this event.'}
              </p>
            ) : (
              <div className="tl-stb-wrap">
                <table className="tl-stb">
                  <thead>
                    <tr>
                      <th>Attendee</th>
                      <th>Abandonment stage</th>
                      <th>Purchase intent</th>
                      <th>Suggested follow-up (rules)</th>
                      <th className="is-right">Recovery action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recoveryRows.rows.map((a) => (
                      <tr key={a.identifier}>
                        <td>
                          <div className="tl-who-name">{a.userName}</div>
                          <div className="tl-who-mail">{a.userEmail || a.identifier}</div>
                        </td>
                        <td>
                          <span className="tl-stage-pill" title={stageLabel(a.abandonmentStage)}>
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                            {a.abandonmentStage}
                          </span>
                        </td>
                        <td><span className="tl-score"><strong>{a.intentScore}/100</strong></span></td>
                        <td>
                          <span className="tl-action-chip"><Mail className="w-4 h-4" />{actionLabel(a.recommendedRecoveryAction)}</span>
                        </td>
                        <td className="is-right">{reminderButton(a.userId, 'ABANDONED_CHECKOUT_REMINDER', 'amber')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {abandoned.length > 0 && <div className="tl-pi-pager"><Pager page={recoveryRows.page} total={abandoned.length} onPage={setRecoveryPage} label="Cart recovery" size={PAGE_SIZE} /></div>}
          </Panel>
        </>
      )}
    </div>
  );
}
