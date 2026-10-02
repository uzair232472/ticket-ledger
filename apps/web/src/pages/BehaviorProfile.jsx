import React, { useState, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api, { trackClientBehavior } from '../utils/api';
import {
  Activity,
  Eye,
  Armchair,
  ShoppingCart,
  Clock,
  CreditCard,
  Ticket,
  ArrowRightLeft,
  ShieldCheck,
  Shield,
  BarChart3,
  Tag,
  AlertTriangle,
  User,
  RefreshCw,
  Send,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Wallet,
} from 'lucide-react';

// Readable label, default detail line, icon and tone for each tracked action
const ACTIONS = {
  event_view: ['Event viewed', 'Event page viewed', Eye],
  category_view: ['Category viewed', 'Browsed a category', Layers],
  seat_selected: ['Seat selected', 'Selected seats in a section', Armchair],
  seat_locked: ['Seats held', 'Seats held for checkout', Clock],
  checkout_started: ['Checkout started', 'Started checkout process', ShoppingCart],
  checkout_abandoned: ['Checkout abandoned', 'Left checkout before paying', Clock, 'warn'],
  payment_completed: ['Payment completed', 'Payment confirmed', CreditCard],
  payment_failed: ['Payment failed', 'Payment did not go through', AlertTriangle, 'bad'],
  ticket_purchased: ['Ticket purchased', 'Ticket issued to the account', Ticket],
  ticket_transferred: ['Ticket transferred', 'Ticket sent to another fan', ArrowRightLeft],
  resale_viewed: ['Resale viewed', 'Browsed fan resale', Eye],
  resale_attempted: ['Resale listed', 'Listed a ticket for resale', Tag],
  gate_checked_in: ['Checked in at gate', 'Ticket scanned at the gate', ShieldCheck],
  wallet_connected: ['Wallet connected', 'Connected a crypto wallet', Wallet],
  login: ['Signed in', 'Started a session', User],
};
const actionInfo = (action) => {
  const [label, detail, icon, tone] = ACTIONS[action] || [action.replace(/_/g, ' '), 'Recorded activity', Activity];
  return { label, detail, icon, tone };
};

const FILTERS = [
  { id: 'ALL', label: 'All activity', test: () => true },
  { id: 'VIEWS', label: 'Views', test: (a) => a.includes('view') },
  { id: 'SEATS', label: 'Seats', test: (a) => a.includes('seat') },
  { id: 'CHECKOUT', label: 'Checkout', test: (a) => a.includes('checkout') },
  { id: 'PAYMENTS', label: 'Payments', test: (a) => a.includes('payment') || a.includes('ticket_purchased') },
  { id: 'OTHER', label: 'Gate & transfers', test: (a) => a.includes('gate') || a.includes('transfer') || a.includes('resale') },
];

const formatTimeAgo = (dateStr) => {
  const diffSec = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
};

function ScoreCard({ icon: Icon, blue, title, text, badge, badgeTone, score, danger, foot }) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <section className="tl-bh-score">
      <div className="tl-bh-score-head">
        <span className={`tl-bh-score-icon${blue ? ' is-blue' : ''}`} aria-hidden="true"><Icon className="w-5 h-5" /></span>
        <h2>{title}</h2>
        <span className={`tl-bd tl-bd--${badgeTone}`}>{badge}</span>
        <p>{text}</p>
      </div>
      <p className="tl-bh-score-value">{v} <span>/ 100</span></p>
      <div className={`tl-bh-bar${danger ? ' is-rose' : ''}`} role="img" aria-label={`${title}: ${v} out of 100`}><span style={{ width: `${Math.max(2, v)}%` }} /></div>
      {foot && <p className="tl-bh-score-foot"><span>{foot}</span></p>}
    </section>
  );
}

export default function BehaviorProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterId, setFilterId] = useState('ALL');
  const [expandedId, setExpandedId] = useState(null);
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  // Test tool: log an action into the tracking pipeline
  const [simulatingAction, setSimulatingAction] = useState(false);
  const [selectedSimAction, setSelectedSimAction] = useState('event_view');

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await api.get('/behavior/profile');
      if (res.data.success) setProfile(res.data.data);
    } catch (err) {
      console.error('Failed to fetch behavioral profile:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSimulate = async () => {
    try {
      setSimulatingAction(true);
      await trackClientBehavior(selectedSimAction, null, { source: 'Behavior Profile Simulator', timestamp: new Date().toISOString() });
      await fetchProfile();
    } catch (err) {
      console.error(err);
    } finally {
      setSimulatingAction(false);
    }
  };

  const filter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const timeline = (profile?.timeline || []).filter((item) => filter.test(item.action));
  const pages = Math.max(1, Math.ceil(timeline.length / perPage));
  const current = Math.min(page, pages);
  const start = (current - 1) * perPage;
  const rows = timeline.slice(start, start + perPage);

  const intent = profile?.scores?.purchaseIntent || {};
  const risk = profile?.scores?.fraudRisk || {};
  const stats = profile?.stats || {};
  const counters = [
    ['Page views', stats.eventsViewed, Eye],
    ['Seat selections', stats.seatsSelected, Armchair],
    ['Checkout starts', stats.checkoutsStarted, ShoppingCart],
    ['Abandoned carts', stats.abandonedCheckouts, Clock],
    ['Purchases', stats.ticketsPurchased, CreditCard],
    ['Transfers', stats.transfersSent, ArrowRightLeft],
    ['Resales', stats.resalesAttempted, Tag],
    ['Gate check-ins', stats.gateCheckIns, ShieldCheck],
  ];

  const setFilter = (id) => {
    setFilterId(id);
    setPage(1);
    setExpandedId(null);
  };

  return (
    <div>
      <nav className="tl-bh-crumbs" aria-label="Breadcrumb">
        <Link to="/admin/dashboard">Admin console</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-current="page">Behavior profile</span>
      </nav>
      <header className="tl-bh-head">
        <div>
          <h1>Behavior profile</h1>
          <p>View behavioral signals and activity timeline for this customer or session.</p>
        </div>
        <button type="button" className="tl-st-btn tl-st-btn--light" onClick={fetchProfile} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh
        </button>
      </header>

      {loading && !profile ? (
        <div className="tl-dash-state"><RefreshCw className="w-7 h-7 tl-dash-spin" /><p>Loading the behavior profile…</p></div>
      ) : (
        <>
          <div className="tl-bh-scores">
            <ScoreCard
              icon={BarChart3}
              title="Purchase intent score"
              text="Likelihood to complete a purchase based on behavior signals."
              badge={`${(intent.tier || 'High').toString().toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} intent`}
              badgeTone={intent.tier === 'HIGH' || !intent.tier ? 'green' : 'amber'}
              score={intent.score ?? 0}
              foot={intent.description}
            />
            <ScoreCard
              icon={Shield}
              blue
              title="Abuse / bot risk score"
              text="Risk of automated or abusive behavior based on activity patterns."
              badge={`${(risk.level || 'Low').toString().toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} risk`}
              badgeTone={risk.level === 'LOW' || !risk.level ? 'green' : 'rose'}
              score={risk.score ?? 0}
              danger={(risk.score ?? 0) > 50}
              foot={risk.description}
            />
          </div>

          <div className="tl-bh-counters">
            {counters.map(([label, value, Icon]) => (
              <div key={label} className="tl-bh-counter">
                <Icon className="w-6 h-6" aria-hidden="true" />
                <span>{label}</span>
                <strong>{value ? value.toLocaleString() : '—'}</strong>
              </div>
            ))}
          </div>

          <div className="tl-bh-tracking">
            <b>Activity tracking active</b>
            <span>Capturing and analyzing behavioral signals in real time.</span>
            <div className="tl-bh-sim">
              <select value={selectedSimAction} onChange={(e) => setSelectedSimAction(e.target.value)} aria-label="Action to log">
                {Object.keys(ACTIONS).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <button type="button" className="tl-st-btn tl-st-btn--light tl-st-btn--xs" onClick={handleSimulate} disabled={simulatingAction}>
                {simulatingAction ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />} Log test action
              </button>
            </div>
          </div>

          <section className="tl-bh-timeline" aria-labelledby="tl-bh-timeline-title">
            <div className="tl-bh-timeline-head">
              <div>
                <h2 id="tl-bh-timeline-title">Chronological activity timeline</h2>
                <p>Most recent activity first · {timeline.length} {timeline.length === 1 ? 'activity' : 'activities'}</p>
              </div>
              <div className="tl-bh-filters">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={f.id === filterId} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
                <button type="button" onClick={fetchProfile}><RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh</button>
              </div>
            </div>

            {timeline.length === 0 ? (
              <p className="tl-empty-row">No activity in this view. Actions are logged automatically as people browse.</p>
            ) : (
              <div className="tl-bh-table-wrap">
                <table className="tl-bh-table">
                  <thead>
                    <tr><th>#</th><th>Activity</th><th>Event / details</th><th>Status</th><th className="is-center">Details</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((item, i) => {
                      const info = actionInfo(item.action);
                      const Icon = info.icon;
                      const hasMeta = item.metadata && Object.keys(item.metadata).length > 0;
                      const open = expandedId === item.id;
                      return (
                        <Fragment key={item.id}>
                          <tr>
                            <td>{start + i + 1}</td>
                            <td>
                              <span className="tl-bh-act">
                                <i className={info.tone ? `is-${info.tone}` : ''} aria-hidden="true" />
                                <Icon className="w-5 h-5" aria-hidden="true" />
                                {info.label}
                              </span>
                            </td>
                            <td className="tl-bh-detail">
                              <strong>{item.eventTitle || 'TicketLedger'}</strong>
                              <span>{info.detail} · {formatTimeAgo(item.createdAt)}</span>
                            </td>
                            <td>
                              <span className={`tl-bh-status${info.tone ? ` is-${info.tone}` : ''}`}>Recorded</span>
                            </td>
                            <td className="is-center">
                              <button
                                type="button"
                                className="tl-bh-toggle"
                                onClick={() => setExpandedId(open ? null : item.id)}
                                disabled={!hasMeta}
                                aria-expanded={open}
                                aria-label={hasMeta ? `${open ? 'Hide' : 'Show'} details for activity ${start + i + 1}` : 'No details'}
                              >
                                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="tl-bh-meta">
                              <td />
                              <td colSpan={4}>
                                <pre>{`Session: ${item.sessionId}\n${JSON.stringify(item.metadata, null, 2)}`}</pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {timeline.length > 0 && (
              <div className="tl-bh-pager">
                <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} aria-label="Activities per page">
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} activities per page</option>)}
                </select>
                <div className="tl-bh-pager-right">
                  <span>Showing {start + 1} – {Math.min(start + perPage, timeline.length)} of {timeline.length}</span>
                  <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1}>
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span>Page {current}</span>
                  <button type="button" className="is-next" onClick={() => setPage(current + 1)} disabled={current === pages}>
                    Next {perPage} <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
