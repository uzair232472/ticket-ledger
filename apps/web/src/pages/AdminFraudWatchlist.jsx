import React, { useState, useEffect, useMemo } from 'react';
import { confirmedFetch } from '../lib/typedConfirm';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { PageHero, AovFooter } from './AdminOverview';
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Info,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  User,
} from 'lucide-react';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const PAGE_SIZE = 8;

// Risk pill: tone, icon, label
const RISK = {
  CRITICAL_BOT: ['bad', Bot, 'Critical bot'],
  SUSPICIOUS: ['warn', AlertTriangle, 'Suspicious'],
};
const riskOf = (level) => RISK[level] || ['good', ShieldCheck, 'Low risk'];

/** Page numbers with gaps: 1 2 3 … 9 */
function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (page <= 3) [2, 3].forEach((p) => p <= pages && set.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2].forEach((p) => p >= 1 && set.add(p));
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? ['gap', p] : [p]));
}

/**
 * Fraud watchlist: checkout sessions flagged by the rule-based checks, in the same layout as Approvals.
 * Suspend or reactivate the account behind a session.
 */
export default function AdminFraudWatchlist() {
  const { token } = useAuth();
  const [watchlist, setWatchlist] = useState([]);
  const [stats, setStats] = useState({ totalEvaluated: 0, criticalBots: 0, suspicious: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('ALL'); // ALL, CRITICAL_BOT, SUSPICIOUS
  const [page, setPage] = useState(1);

  const fetchWatchlist = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/ml/fraud-watchlist`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch watchlist');
      setWatchlist(data.data?.watchlist || []);
      setStats(data.data?.stats || { totalEvaluated: 0, criticalBots: 0, suspicious: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchWatchlist();
  }, [token]);

  const handleToggleFreezeUser = async (user) => {
    if (!user) return;
    setActionLoadingId(user.id);
    setActionSuccess('');
    setError('');
    const isFrozen = user.status === 'SUSPENDED';
    const endpoint = isFrozen ? `${API_BASE}/ml/unfreeze-user/${user.id}` : `${API_BASE}/ml/freeze-user/${user.id}`;
    try {
      const res = await confirmedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: 'Frozen by a super admin from the fraud watchlist (rule-based checks)' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Action failed');
      setActionSuccess(data.message);
      fetchWatchlist();
      setTimeout(() => setActionSuccess(''), 6000);
    } catch (err) {
      setError(`Action error: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filtered = useMemo(() => watchlist.filter((item) => {
    const matchesFilter = selectedFilter === 'ALL' || item.riskLevel === selectedFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q
      || item.sessionId?.toLowerCase().includes(q)
      || item.user?.name?.toLowerCase().includes(q)
      || item.user?.email?.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  }), [watchlist, selectedFilter, searchQuery]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [selectedFilter, searchQuery]);

  const tabs = [
    { value: 'ALL', label: 'All flagged', count: watchlist.length },
    { value: 'CRITICAL_BOT', label: 'Critical bots', count: stats.criticalBots },
    { value: 'SUSPICIOUS', label: 'Suspicious', count: stats.suspicious },
  ];
  const when = (d) => {
    const x = new Date(d);
    return [x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })];
  };

  return (
    <div className="tl-aov tl-aov-sec tl-apv tl-fw">
      <PageHero
        icon={ShieldAlert}
        title="Fraud Watchlist"
        intro="Checkout speed, click frequency, rapid seat sniping and scalper bots across every event, from the rule-based checks."
        aside={(
          <div className="tl-apv-summary" role="group" aria-label="Watchlist summary">
            <div><Activity className="is-good" aria-hidden="true" /><strong>{stats.totalEvaluated}</strong><span>Evaluated</span></div>
            <div><Bot className="is-bad" aria-hidden="true" /><strong>{stats.criticalBots}</strong><span>Critical bots</span></div>
            <div><AlertTriangle className="is-warn" aria-hidden="true" /><strong>{stats.suspicious}</strong><span>Suspicious</span></div>
            <button type="button" className="tl-aov-iconbtn" onClick={fetchWatchlist} aria-label="Refresh watchlist" title="Refresh watchlist">
              <RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} />
            </button>
          </div>
        )}
      />

      {actionSuccess && <Notice tone="good" icon={CheckCircle2} onDismiss={() => setActionSuccess('')}>{actionSuccess}</Notice>}
      {error && <Notice tone="bad" icon={AlertTriangle} onDismiss={() => setError('')}>{error}</Notice>}

      <div className="tl-apv-bar">
        <div className="tl-apv-filters" role="group" aria-label="Filter by risk">
          {tabs.map((t) => (
            <button key={t.value} type="button" className={`tl-apv-filter${selectedFilter === t.value ? ' is-active' : ''}`} aria-pressed={selectedFilter === t.value} onClick={() => setSelectedFilter(t.value)}>
              {t.label} <span>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="tl-apv-tools">
          <label className="tl-apv-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Search flagged sessions</span>
            <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search session ID, email or name…" />
          </label>
        </div>
      </div>

      <section className="tl-apv-table" aria-label="Flagged sessions">
        <div className="tl-apv-row tl-apv-row--head" aria-hidden="true">
          <span>Account</span>
          <span>Fraud score</span>
          <span>Anomaly factors</span>
          <span>Detected</span>
          <span>Risk</span>
          <span className="is-right">Actions</span>
        </div>

        {loading && watchlist.length === 0 ? (
          <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading the fraud watchlist…</p></div>
        ) : rows.length === 0 ? (
          <div className="tl-dash-state"><ShieldCheck className="w-7 h-7" /><p>No sessions match this filter.</p></div>
        ) : rows.map((item) => {
          const [tone, RiskIcon, riskLabel] = riskOf(item.riskLevel);
          const isFrozen = item.user?.status === 'SUSPENDED';
          const busy = item.user && actionLoadingId === item.user.id;
          const [day, time] = when(item.timestamp);
          const score = Number(item.fraudScore) || 0;
          const factors = item.anomalyFactors || [];
          return (
            <article key={item.id} className="tl-apv-row">
              <div className="tl-apv-co">
                <span className={`tl-fw-tile is-${tone}`} aria-hidden="true">{item.riskLevel === 'CRITICAL_BOT' ? <Bot /> : <User />}</span>
                <div>
                  <h3>{item.user?.name || 'Anonymous guest'}</h3>
                  <p>{item.user?.email || 'No account'}</p>
                  <span className="tl-apv-tag tl-fw-session" title={item.sessionId}><Fingerprint className="w-3 h-3" aria-hidden="true" /> {item.sessionId}</span>
                </div>
              </div>

              <div className="tl-fw-score" data-tone={tone}>
                <strong>{score.toFixed(1)}<small>/100</small></strong>
                <span className="tl-fw-meter"><span style={{ width: `${Math.min(100, score)}%` }} /></span>
              </div>

              <div className="tl-fw-factors">
                {factors.length === 0 ? <span className="tl-fw-normal">Normal human pattern</span> : (
                  <>
                    {factors.slice(0, 2).map((f) => <span key={f} className="tl-fw-chip">{f}</span>)}
                    {factors.length > 2 && <span className="tl-fw-chip is-more" title={factors.slice(2).join(', ')}>+{factors.length - 2}</span>}
                  </>
                )}
              </div>

              <div className="tl-apv-when">
                <CalendarDays className="w-5 h-5" aria-hidden="true" />
                <div><strong>{day}</strong><span>{time}</span></div>
              </div>

              <div className="tl-apv-state">
                <span className="tl-apv-status" data-tone={tone}><span className="tl-apv-status-dot" aria-hidden="true"><RiskIcon strokeWidth={3} /></span>{riskLabel}</span>
                {item.user && <small className="tl-fw-acct">Account {item.user.status.toLowerCase()}</small>}
              </div>

              <div className="tl-apv-actions">
                {item.user ? (
                  <button
                    type="button"
                    className={`tl-apv-btn ${isFrozen ? 'is-primary' : 'is-danger'}`}
                    onClick={() => handleToggleFreezeUser(item.user)}
                    disabled={busy}
                  >
                    {busy ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : isFrozen ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    {isFrozen ? 'Reactivate' : 'Suspend'}
                  </button>
                ) : (
                  <span className="tl-fw-guest"><Info className="w-4 h-4" aria-hidden="true" /> Guest, no account</span>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {filtered.length > 0 && (
        <nav className="tl-apv-pager" aria-label="Pages">
          <p>Showing <strong>{(current - 1) * PAGE_SIZE + 1} – {Math.min(filtered.length, current * PAGE_SIZE)}</strong> of <strong>{filtered.length}</strong> sessions</p>
          <div>
            <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            {pageList(current, pages).map((p, i) => (p === 'gap'
              ? <span key={`g${i}`} aria-hidden="true">…</span>
              : <button key={p} type="button" className={p === current ? 'is-active' : undefined} aria-current={p === current ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>))}
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </nav>
      )}

    </div>
  );
}
