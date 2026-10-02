import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, ApStat, UnderlineTabs, RecordCard, Badge, ScoreBar } from '../components/dash/Studio';
import {
  Bot,
  AlertTriangle,
  RefreshCw,
  Search,
  Activity,
  CheckCircle2,
  Lock,
  Unlock,
  Clock,
  Info,
  User,
  Mail,
  Fingerprint,
  ShieldCheck,
} from 'lucide-react';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

const RISK = {
  CRITICAL_BOT: ['rose', Bot, 'Critical bot'],
  SUSPICIOUS: ['amber', AlertTriangle, 'Suspicious'],
};
const riskOf = (level) => RISK[level] || ['green', ShieldCheck, 'Low risk'];

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
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: 'Flagged on Super Admin AI Bot & Fraud Defense Watchlist' }),
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

  const filteredWatchlist = watchlist.filter((item) => {
    const matchesFilter = selectedFilter === 'ALL' || item.riskLevel === selectedFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      item.sessionId?.toLowerCase().includes(q) ||
      item.user?.name?.toLowerCase().includes(q) ||
      item.user?.email?.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const tabs = [
    { value: 'ALL', label: 'All flagged', count: watchlist.length },
    { value: 'CRITICAL_BOT', label: 'Critical bots', count: stats.criticalBots },
    { value: 'SUSPICIOUS', label: 'Suspicious', count: stats.suspicious },
  ];

  return (
    <div>
      <div className="tl-ap-head-row">
        <StudioHead
          crumbs={['Admin console', 'Fraud watchlist']}
          title="Fraud watchlist"
          intro="Checkout speed, click frequency, rapid seat sniping and scalper bots across every event, scored by the machine-learning model."
        />
        <button type="button" className="tl-st-icon-btn" onClick={fetchWatchlist} aria-label="Refresh watchlist">
          <RefreshCw className={`w-5 h-5 ${loading ? 'tl-dash-spin' : ''}`} />
        </button>
      </div>

      <div className="tl-ap-stats">
        <ApStat icon={Activity} tone="green" label="Sessions evaluated" value={stats.totalEvaluated} pill="Real-time ML telemetry" pillIcon={Activity} />
        <ApStat icon={Bot} tone="rose" label="Critical scalper bots" value={stats.criticalBots} pill="Rapid seat sniping" pillIcon={Bot} />
        <ApStat icon={AlertTriangle} tone="amber" label="Suspicious sessions" value={stats.suspicious} pill="Elevated risk score" pillIcon={AlertTriangle} />
      </div>

      {actionSuccess && <Notice tone="good" icon={CheckCircle2} onDismiss={() => setActionSuccess('')}>{actionSuccess}</Notice>}
      {error && <Notice tone="bad" icon={AlertTriangle} onDismiss={() => setError('')}>{error}</Notice>}

      <section className="tl-ap-section" aria-labelledby="tl-fw-sessions">
        <h2 id="tl-fw-sessions">Flagged sessions</h2>
        <p className="tl-ap-section-sub">{filteredWatchlist.length} shown</p>
        <div className="tl-ap-toolbar">
          <UnderlineTabs label="Filter by risk" options={tabs} value={selectedFilter} onChange={setSelectedFilter} />
          <label className="tl-dash-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <input className="tl-dash-input" type="search" placeholder="Search session ID, email or name" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Search flagged sessions" />
          </label>
        </div>
        <p className="tl-ap-info"><Info className="w-5 h-5" aria-hidden="true" />Review each flagged session and suspend accounts that are confirmed bots or scalpers.</p>

        {loading ? (
          <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading the fraud watchlist…</p></div>
        ) : filteredWatchlist.length === 0 ? (
          <p className="tl-ap-empty">No sessions match this filter.</p>
        ) : (
          <div className="tl-ap-list">
            {filteredWatchlist.map((item) => {
              const [tone, RiskIcon, riskLabel] = riskOf(item.riskLevel);
              const isFrozen = item.user?.status === 'SUSPENDED';
              const busy = item.user && actionLoadingId === item.user.id;
              return (
                <RecordCard
                  key={item.id}
                  icon={item.riskLevel === 'CRITICAL_BOT' ? Bot : User}
                  title={item.user?.name || 'Anonymous guest'}
                  sub={item.user?.email || `Session ${item.sessionId}`}
                  status={<Badge tone={tone} icon={RiskIcon}>{riskLabel}</Badge>}
                  columns={[
                    {
                      label: 'Fraud score',
                      content: (
                        <p className="tl-rc-line" style={{ alignItems: 'center' }}>
                          <strong style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.fraudScore.toFixed(1)}/100</strong>
                          <ScoreBar value={item.fraudScore} tone={item.riskLevel === 'CRITICAL_BOT' ? 'rose' : item.riskLevel === 'SUSPICIOUS' ? 'amber' : 'green'} />
                        </p>
                      ),
                    },
                    {
                      label: 'Anomaly factors',
                      content: item.anomalyFactors.length === 0 ? (
                        <p className="tl-rc-line">Normal human pattern</p>
                      ) : (
                        <div className="tl-rc-chips">{item.anomalyFactors.map((af) => <Badge key={af} tone="rose">{af}</Badge>)}</div>
                      ),
                    },
                    {
                      label: 'Session',
                      content: (
                        <>
                          <p className="tl-rc-line"><Fingerprint className="w-4 h-4" aria-hidden="true" /><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{item.sessionId}</span></p>
                          <p className="tl-rc-line"><Clock className="w-4 h-4" aria-hidden="true" />{new Date(item.timestamp).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</p>
                          {item.user && <p className="tl-rc-line"><Mail className="w-4 h-4" aria-hidden="true" />Account: {item.user.status.toLowerCase()}</p>}
                        </>
                      ),
                    },
                  ]}
                  actions={
                    item.user ? (
                      <button
                        type="button"
                        className={`tl-rc-btn ${isFrozen ? 'tl-rc-btn--approve' : 'tl-rc-btn--reject'}`}
                        onClick={() => handleToggleFreezeUser(item.user)}
                        disabled={busy}
                      >
                        {busy ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : isFrozen ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                        {isFrozen ? 'Reactivate' : 'Suspend'}
                      </button>
                    ) : (
                      <span className="tl-guest" style={{ textAlign: 'center' }}>Guest session, no account to suspend</span>
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
