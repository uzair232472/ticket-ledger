import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, StatCard, Panel, Badge, Avatar } from '../components/dash/Studio';
import { AbandonmentInsightPanel, InsightBoundary } from '../components/ml/InsightPanels';
import { useDialog } from '../components/ui/DialogProvider';
import api from '../utils/api';
import { can } from '../lib/permissions';
import {
  Users,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Send,
  CheckCircle,
  RefreshCw,
  Clock,
  MapPin,
  Tag,
  Zap,
  Info,
  Check,
  User,
  ClipboardList,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Automatic reminders (organizations only): after a checkout lapses unpaid, wait N hours, then remind the customer
 * once (optionally with a personal code). Shows how many reminded customers bought tickets afterwards.
 */
function AutoRecovery() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api.get('/org/recovery').then((r) => { setData(r.data.data); setForm(r.data.data.settings); }).catch(() => setData(false));
  useEffect(() => { load(); }, []);
  if (data === false || !form) return null;
  const save = async (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    try {
      const r = await api.put('/org/recovery', next);
      setData(r.data.data);
      setForm(r.data.data.settings);
      setMsg({ tone: 'good', text: r.data.message });
    } catch (e) {
      setMsg({ tone: 'bad', text: e.response?.data?.message || 'Could not save.' });
      load();
    }
  };
  const s = data.last30Days;
  return (
    <Panel icon={Zap} title="Automatic reminders" badge={form.recoveryEnabled ? 'On' : 'Off'} badgeTone={form.recoveryEnabled ? 'green' : 'grey'}
      sub={`When a checkout lapses unpaid, the customer gets one reminder (at most one per event every ${data.limits.cooldownDays} days, never after they bought).`}>
      {msg && <Notice tone={msg.tone} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={form.recoveryEnabled} onChange={(e) => save({ recoveryEnabled: e.target.checked })} /> Send automatically
        </label>
        <label className="grid gap-1 text-xs"><span className="font-bold">Wait (hours)</span>
          <input className="tl-dash-input" type="number" min={1} max={data.limits.windowHours - 1} value={form.recoveryDelayHours} onChange={(e) => setForm({ ...form, recoveryDelayHours: Number(e.target.value) })} onBlur={() => save({})} style={{ width: 90 }} />
        </label>
        <label className="grid gap-1 text-xs"><span className="font-bold">Personal discount (%)</span>
          <input className="tl-dash-input" type="number" min={0} max={data.limits.maxPercent} value={form.recoveryDiscountPercent} onChange={(e) => setForm({ ...form, recoveryDiscountPercent: Number(e.target.value) })} onBlur={() => save({})} style={{ width: 90 }} />
        </label>
        <label className="grid gap-1 text-xs"><span className="font-bold">Code valid (hours)</span>
          <input className="tl-dash-input" type="number" min={1} max={168} disabled={!form.recoveryDiscountPercent} value={form.recoveryValidHours} onChange={(e) => setForm({ ...form, recoveryValidHours: Number(e.target.value) })} onBlur={() => save({})} style={{ width: 90 }} />
        </label>
      </div>
      <p className="text-sm mt-3">Last 30 days: <b>{s.sent}</b> reminders ({s.automatic} automatic, {s.manual} by hand) · <b>{s.recovered}</b> customers bought afterwards ({s.rate}%) · {s.codesUsed} codes used</p>
    </Panel>
  );
}

const REASONS = {
  PAYMENT_FRICTION: { tone: 'rose', label: 'Payment friction' },
  HIGH_TICKET_PRICE: { tone: 'amber', label: 'Price sensitivity' },
  SEAT_LOCK_TIMEOUT: { tone: 'blue', label: 'Seat lock expired (10m)' },
  COMPARISON_SHOPPING: { tone: 'blue', label: 'Comparison shopping (4+ views)' },
};
const reasonOf = (r) => REASONS[r] || { tone: 'grey', label: 'Browser hesitation' };
const intentOf = (score) => (score >= 75 ? { tone: 'green', text: 'High intent' } : score >= 50 ? { tone: 'amber', text: 'Moderate' } : { tone: 'grey', text: 'Low intent' });

/** View → seat → checkout → abandoned, with the furthest step reached highlighted. */
function Journey({ item }) {
  const steps = [
    ['1. View', item.hasViewed],
    ['2. Seat', item.hasSelectedSeat],
    ['3. Checkout', item.hasStartedCheckout],
  ];
  const furthest = steps.reduce((idx, [, reached], i) => (reached ? i : idx), -1);
  return (
    <div className="tl-journey" aria-label="Journey">
      {steps.map(([label, reached], i) => (
        <React.Fragment key={label}>
          {i > 0 && <i aria-hidden="true">→</i>}
          <span className={i === furthest ? 'is-current' : reached ? 'is-done' : ''}>{label}</span>
        </React.Fragment>
      ))}
      <i aria-hidden="true">→</i>
      <span className={item.hasAbandonedCheckout ? 'is-dropped' : ''}>4. Abandoned</span>
    </div>
  );
}

export default function AbandonedIntentDashboard() {
  const dialog = useDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();

  // Filters
  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(searchParams.get('eventId') || '');
  const [minScore, setMinScore] = useState(searchParams.get('minScore') || '');
  const [selectedReason, setSelectedReason] = useState(searchParams.get('reason') || 'ALL');

  // Data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Reminders
  const [sentReminders, setSentReminders] = useState({});
  const [sendingUserId, setSendingUserId] = useState(null);
  const [batchSending, setBatchSending] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);
  // The offer each reminder carries: a personal single-use code (made per person), an existing code, or none
  const [offer, setOffer] = useState({ kind: 'personal', percent: 10, code: '' });
  const offerBody = () => (offer.kind === 'personal' ? { discountPercent: Number(offer.percent) || 10 } : offer.kind === 'code' ? { discountCode: offer.code.trim() } : {});
  const offerLabel = () => (offer.kind === 'personal' ? `a personal ${Number(offer.percent) || 10}% code (single use, valid 48 hours)` : offer.kind === 'code' ? `the code “${offer.code.trim()}”` : 'no discount');
  const offerProblem = () => (offer.kind === 'code' && !offer.code.trim() ? 'Enter the discount code to send, or choose another offer.' : offer.kind === 'personal' && !(Number(offer.percent) >= 1 && Number(offer.percent) <= 90) ? 'The personal discount must be 1–90%.' : null);

  // 1. Events for the filter
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events?limit=50`);
        const json = await res.json();
        if (json.success && json.data.events) setEventsList(json.data.events);
      } catch (err) {
        console.error('Failed to load events list:', err);
      }
    };
    fetchEvents();
  }, []);

  // 2. Abandoned prospects
  const fetchDashboardData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedEventId) params.append('eventId', selectedEventId);
      if (minScore) params.append('minScore', minScore);
      if (selectedReason && selectedReason !== 'ALL') params.append('reason', selectedReason);

      const res = await fetch(`${API_URL}/api/analytics/abandoned?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok && json.success) setData(json.data);
      else setError(json.message || 'Failed to load abandoned checkouts');
    } catch (err) {
      setError(err.message || 'Network error loading abandoned checkouts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboardData();
  }, [selectedEventId, minScore, selectedReason, token]);

  const setFilter = (key, value, empty) => {
    setSearchParams((prev) => {
      if (value && value !== empty) prev.set(key, value);
      else prev.delete(key);
      return prev;
    });
  };

  // 3. One reminder
  const handleSendReminder = async (prospect) => {
    if (!prospect.user.id) {
      setError('Guests have no account or email, so they cannot get a reminder.');
      return;
    }
    if (offerProblem()) {
      setError(offerProblem());
      return;
    }
    setSendingUserId(prospect.user.id);
    setActionSuccessMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/analytics/abandoned/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserId: prospect.user.id, eventId: prospect.event.id, ...offerBody() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSentReminders((prev) => ({ ...prev, [`${prospect.user.id}_${prospect.event.id}`]: true }));
        setActionSuccessMsg(`Recovery reminder sent to ${prospect.user.name}${json.discountCode ? ` with code ${json.discountCode.code}` : ''}.`);
      } else {
        setError(json.message || 'Failed to send recovery reminder');
      }
    } catch (err) {
      setError(err.message || 'Network error sending reminder');
    } finally {
      setSendingUserId(null);
    }
  };

  // 4. Reminders to everyone listed
  const handleBatchSendReminders = async () => {
    if (!data?.abandonedUsers || data.abandonedUsers.length === 0) return;
    const registeredUsers = data.abandonedUsers.filter((u) => u.user.id);
    if (registeredUsers.length === 0) {
      setError('No registered users in this list to send reminders to.');
      return;
    }
    if (offerProblem()) {
      setError(offerProblem());
      return;
    }
    if (!(await dialog.confirm({ title: 'Send recovery reminders?', message: `Reminders with ${offerLabel()} go to ${registeredUsers.length} ${registeredUsers.length === 1 ? 'person' : 'people'}.`, confirmLabel: 'Send reminders', tone: 'info' }))) return;

    setBatchSending(true);
    setActionSuccessMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/analytics/abandoned/batch-reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventId: selectedEventId || undefined, ...offerBody() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setActionSuccessMsg(json.message || `Sent ${json.dispatchedCount} recovery reminders.`);
        const updated = { ...sentReminders };
        registeredUsers.forEach((u) => { updated[`${u.user.id}_${u.event.id}`] = true; });
        setSentReminders(updated);
      } else {
        setError(json.message || 'Failed to send reminders');
      }
    } catch (err) {
      setError(err.message || 'Network error sending reminders');
    } finally {
      setBatchSending(false);
    }
  };

  const summary = data?.summary || {};
  const rows = data?.abandonedUsers || [];

  return (
    <div>
      <StudioHead
        crumbs={['Insights', 'Recovery']}
        title="Abandoned checkouts"
        intro="People who viewed an event, picked a seat or started checkout, then left before paying. Send them a reminder with a coupon."
      />

      {actionSuccessMsg && <Notice tone="good" icon={CheckCircle} onDismiss={() => setActionSuccessMsg(null)}>{actionSuccessMsg}</Notice>}
      {error && <Notice tone="bad" icon={AlertTriangle} onDismiss={() => setError(null)}>{error}</Notice>}

      <div className="tl-sc-grid">
        <StatCard
          icon={Users}
          tone="ink"
          label="Abandoned users"
          value={summary.totalAbandonedUsers ?? 0}
          unit={`(${summary.registeredDropouts ?? 0} registered)`}
          note="Users who reached seat selection or checkout but didn't buy"
        />
        <StatCard
          icon={BarChart3}
          tone="green"
          label="Recoverable revenue"
          value={`PKR ${(summary.recoverableRevenuePkr ?? 0).toLocaleString()}`}
          note="Total cart value left in abandoned checkouts"
        />
        <StatCard
          icon={TrendingUp}
          tone="ink"
          label="Avg intent score"
          value={summary.avgIntentScore ?? 0}
          unit="/100"
          note="Fixed rule: event views, seat choice and checkout steps (no AI model)"
        />
        <StatCard
          icon={AlertTriangle}
          tone="amber"
          label="Top dropout reason"
          value={<span style={{ fontSize: 'clamp(18px, 1.5vw, 22px)', letterSpacing: '-0.01em' }}>{summary.topReason ? summary.topReason.replace(/_/g, ' ') : 'None detected'}</span>}
          note="Most common friction point across abandoned sessions"
        />
      </div>

      {/* Step 6: per-event totals; the experimental model is display-only and changes no reminder */}
      {selectedEventId && <InsightBoundary><div style={{ marginBottom: 20 }}><AbandonmentInsightPanel eventId={selectedEventId} /></div></InsightBoundary>}

      {/* Automatic reminders (organization members who contact attendees) */}
      {user?.role !== 'SUPER_ADMIN' && can(user, 'attendee.contact') && <div style={{ marginBottom: 20 }}><AutoRecovery /></div>}

      {/* Recovery actions */}
      <div className="tl-ab-actions">
        <div className="tl-ab-actions-intro">
          <span className="tl-recovery-icon" style={{ background: '#d8f0dc', color: 'var(--st-green)' }}><Send className="w-5 h-5" /></span>
          <span><strong>Recovery actions</strong><span>Send everyone listed below a reminder. A personal code works once, for that person only.</span></span>
        </div>
        <div className="tl-ab-actions-right">
          <label className="tl-coupon">
            <Tag className="w-4 h-4" aria-hidden="true" /> Offer
            <select value={offer.kind} onChange={(e) => setOffer({ ...offer, kind: e.target.value })} aria-label="Offer in the reminder">
              <option value="personal">Personal code</option>
              <option value="code">Existing code</option>
              <option value="none">No discount</option>
            </select>
          </label>
          {offer.kind === 'personal' && (
            <label className="tl-coupon">
              <input type="number" min={1} max={90} value={offer.percent} onChange={(e) => setOffer({ ...offer, percent: e.target.value })} aria-label="Personal discount percent" style={{ width: 56 }} /> % off
            </label>
          )}
          {offer.kind === 'code' && (
            <label className="tl-coupon">
              <input type="text" placeholder="CODE" value={offer.code} onChange={(e) => setOffer({ ...offer, code: e.target.value.toUpperCase() })} aria-label="Discount code" />
            </label>
          )}
          <button type="button" className="tl-st-btn tl-st-btn--green" onClick={handleBatchSendReminders} disabled={batchSending || !summary.registeredDropouts}>
            {batchSending ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />} Send reminders
          </button>
          <button type="button" className="tl-st-icon-btn" onClick={fetchDashboardData} aria-label="Refresh" disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'tl-dash-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Directory */}
      <Panel
        flush
        icon={ClipboardList}
        title="Abandoned prospect directory"
        action={
          <>
            <div className="tl-ab-filters">
              <label className="tl-ss tl-ss--sm">
                <select
                  value={selectedEventId}
                  onChange={(e) => { setSelectedEventId(e.target.value); setFilter('eventId', e.target.value, ''); }}
                  aria-label="Event"
                >
                  <option value="">All events</option>
                  {eventsList.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} ({ev.city})</option>)}
                </select>
              </label>
              <label className="tl-ss tl-ss--sm">
                <select
                  value={selectedReason}
                  onChange={(e) => { setSelectedReason(e.target.value); setFilter('reason', e.target.value, 'ALL'); }}
                  aria-label="Abandonment reason"
                >
                  <option value="ALL">All abandonment reasons</option>
                  <option value="PAYMENT_FRICTION">Payment friction</option>
                  <option value="HIGH_TICKET_PRICE">High ticket price</option>
                  <option value="SEAT_LOCK_TIMEOUT">Seat lock timeout</option>
                  <option value="COMPARISON_SHOPPING">Comparison shopping</option>
                  <option value="BROWSER_HESITATION">Browser hesitation</option>
                </select>
              </label>
              <label className="tl-ss tl-ss--sm">
                <select
                  value={minScore}
                  onChange={(e) => { setMinScore(e.target.value); setFilter('minScore', e.target.value, ''); }}
                  aria-label="Minimum intent score"
                >
                  <option value="">Any intent score</option>
                  <option value="50">Score ≥ 50 (moderate+)</option>
                  <option value="70">Score ≥ 70 (high intent)</option>
                  <option value="80">Score ≥ 80 (very high)</option>
                </select>
              </label>
            </div>
            <span className="tl-ab-count">Showing <strong>{rows.length}</strong> abandoned {rows.length === 1 ? 'prospect' : 'prospects'}</span>
          </>
        }
      >
        {loading ? (
          <div className="tl-dash-state"><RefreshCw className="w-7 h-7 tl-dash-spin" /><p>Loading abandoned checkouts…</p></div>
        ) : rows.length === 0 ? (
          <p className="tl-empty-row">No abandoned checkouts match these filters.</p>
        ) : (
          <div className="tl-stb-wrap">
            <table className="tl-stb">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Event</th>
                  <th>Journey &amp; last activity</th>
                  <th className="is-center">Intent score</th>
                  <th>Likely reason &amp; suggestion</th>
                  <th className="is-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const reason = reasonOf(item.likelyReason);
                  const intent = intentOf(item.intentScore);
                  const isSent = sentReminders[`${item.user.id}_${item.event.id}`];
                  const isSending = sendingUserId === item.user.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="tl-who">
                          {item.user.isRegistered ? <Avatar icon={User} /> : <Avatar guest icon={User} />}
                          <div style={{ minWidth: 0 }}>
                            <div className="tl-who-name">{item.user.name}</div>
                            <div className="tl-who-mail">{item.user.email || `Session ${item.sessionId?.substring(0, 10)}…`}</div>
                            <div className="tl-who-tags">
                              <Badge tone={item.user.isRegistered ? 'green' : 'grey'}>{item.user.isRegistered ? 'Registered user' : 'Guest'}</Badge>
                              {item.user.city && <span>{item.user.city}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="tl-ab-event">
                        <strong>{item.event.name}</strong>
                        <span><MapPin className="w-3 h-3" aria-hidden="true" />{item.event.venue || item.event.city}</span>
                        <em>Cart: PKR {item.cartValue.toLocaleString()}</em>
                      </td>
                      <td>
                        <Journey item={item} />
                        <div className="tl-last">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          Last: <b>{item.lastAction}</b> · {new Date(item.lastActionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="is-center">
                        <span className="tl-intent">
                          <strong>{item.intentScore}</strong>
                          <Badge tone={intent.tone}>{intent.text}</Badge>
                        </span>
                      </td>
                      <td className="tl-reason">
                        <Badge tone={reason.tone}>{reason.label}</Badge>
                        <p>{item.reasonDetail}</p>
                        <em><Zap className="w-3.5 h-3.5" aria-hidden="true" />Suggest: {item.recommendedAction.replace(/_/g, ' ').toLowerCase()}</em>
                      </td>
                      <td className="is-right">
                        {isSent ? (
                          <span className="tl-st-btn tl-st-btn--xs tl-st-btn--done"><Check className="w-4 h-4" /> Sent</span>
                        ) : item.user.isRegistered ? (
                          <button
                            type="button"
                            onClick={() => handleSendReminder(item)}
                            disabled={isSending}
                            title={`Send an in-app and email reminder with ${offerLabel()}`}
                            className="tl-st-btn tl-st-btn--xs tl-st-btn--green"
                          >
                            {isSending ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />} Send reminder
                          </button>
                        ) : (
                          <span className="tl-guest">Guest session</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="tl-note-strip">
        <Info className="w-4 h-4" aria-hidden="true" />
        <p>
          <strong>How recovery works.</strong> TicketLedger records signals such as event views, seat picks, seat locks,
          checkout starts and checkout drop-offs. When someone locks a seat or starts checkout but doesn't pay, those
          signals are combined into a likely reason and an intent score. You can then send them an in-app and email
          reminder with a single-use coupon.
        </p>
      </div>
    </div>
  );
}
