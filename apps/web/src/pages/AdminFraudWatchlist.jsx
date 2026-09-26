import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  Bot,
  UserX,
  UserCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  Activity,
  CheckCircle2,
  Lock,
  Unlock,
  Zap,
  Clock,
  Eye,
  ArrowRight
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

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
      const res = await fetch(`${API_BASE}/ml/fraud-watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    if (token) {
      fetchWatchlist();
    }
  }, [token]);

  const handleToggleFreezeUser = async (user) => {
    if (!user) return;
    setActionLoadingId(user.id);
    setActionSuccess('');

    const isFrozen = user.status === 'FROZEN';
    const endpoint = isFrozen
      ? `${API_BASE}/ml/unfreeze-user/${user.id}`
      : `${API_BASE}/ml/freeze-user/${user.id}`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: 'Flagged on Super Admin AI Bot & Fraud Defense Watchlist',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Action failed');

      setActionSuccess(data.message);
      fetchWatchlist();
      setTimeout(() => setActionSuccess(''), 6000);
    } catch (err) {
      alert(`Action Error: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredWatchlist = watchlist.filter((item) => {
    const matchesFilter = selectedFilter === 'ALL' || item.riskLevel === selectedFilter;
    const matchesSearch =
      !searchQuery ||
      item.sessionId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.user?.email?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-rose-950/70 border border-rose-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-rose-400" /> Super Admin Defense
              </span>
              <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Bot className="w-3 h-3 text-cyan-400" /> scikit-learn ML Engine
              </span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight mt-1">
              AI Anti-Scalper & Bot Defense Watchlist
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Real-time telemetry surveillance analyzing checkout velocities, click frequencies, rapid seat sniping attempts, and automated scalper bots across all Pakistani sporting and concert events.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchWatchlist}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Feed</span>
            </button>
          </div>
        </div>

        {/* Global Success / Alert Banner */}
        {actionSuccess && (
          <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-700 text-emerald-300 text-xs flex items-center gap-2 shadow-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>{actionSuccess}</div>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <div className="flex justify-between items-center text-slate-400 text-xs">
              <span>Total Sessions Evaluated</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white">{stats.totalEvaluated}</div>
            <div className="text-[10px] text-slate-500">Real-time ML telemetry logs</div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-rose-900/50 space-y-1">
            <div className="flex justify-between items-center text-rose-400 text-xs font-semibold">
              <span>Critical Scalper Bots Intercepted</span>
              <Bot className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black text-rose-300">{stats.criticalBots}</div>
            <div className="text-[10px] text-rose-400/80">Sub-second / rapid sniping bots</div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-amber-900/40 space-y-1">
            <div className="flex justify-between items-center text-amber-400 text-xs font-semibold">
              <span>Suspicious Sessions Under Review</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-amber-300">{stats.suspicious}</div>
            <div className="text-[10px] text-amber-400/80">Anomaly flags or elevated risk score</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setSelectedFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedFilter === 'ALL'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Flagged ({watchlist.length})
            </button>
            <button
              onClick={() => setSelectedFilter('CRITICAL_BOT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                selectedFilter === 'CRITICAL_BOT'
                  ? 'bg-rose-900 text-rose-200 border border-rose-700'
                  : 'text-slate-400 hover:text-rose-400'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-rose-400" />
              <span>Critical Bots ({stats.criticalBots})</span>
            </button>
            <button
              onClick={() => setSelectedFilter('SUSPICIOUS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                selectedFilter === 'SUSPICIOUS'
                  ? 'bg-amber-900 text-amber-200 border border-amber-700'
                  : 'text-slate-400 hover:text-amber-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Suspicious ({stats.suspicious})</span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search session ID, email, or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition"
            />
          </div>
        </div>

        {/* Watchlist Table */}
        <div className="rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3.5 px-4">Session / Target User</th>
                  <th className="py-3.5 px-4">AI Fraud Score</th>
                  <th className="py-3.5 px-4">Risk Classification</th>
                  <th className="py-3.5 px-4">Telemetry Anomaly Factors</th>
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4 text-right">Admin Defense Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-slate-500">
                      <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      Loading AI security watchlist...
                    </td>
                  </tr>
                ) : filteredWatchlist.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-slate-500">
                      No sessions matching your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredWatchlist.map((item) => {
                    const isCritical = item.riskLevel === 'CRITICAL_BOT';
                    const isSuspicious = item.riskLevel === 'SUSPICIOUS';
                    const isUserFrozen = item.user?.status === 'FROZEN';

                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        {/* Target User / Session */}
                        <td className="py-4 px-4 space-y-0.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span>{item.user?.name || 'Anonymous Guest'}</span>
                            {item.user && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isUserFrozen
                                  ? 'bg-rose-950 text-rose-400 border border-rose-800'
                                  : 'bg-slate-800 text-slate-400'
                              }`}>
                                {item.user.status}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {item.user?.email || item.sessionId}
                          </div>
                          <div className="text-[9px] text-slate-500 font-mono">
                            Session: {item.sessionId}
                          </div>
                        </td>

                        {/* Fraud Score Bar */}
                        <td className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs font-mono font-bold">
                              <span className={isCritical ? 'text-rose-400' : isSuspicious ? 'text-amber-400' : 'text-emerald-400'}>
                                {item.fraudScore.toFixed(1)} / 100
                              </span>
                            </div>
                            <div className="w-28 h-2 rounded-full bg-slate-950 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isCritical ? 'bg-rose-500' : isSuspicious ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(item.fraudScore, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Risk Level Badge */}
                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                            isCritical
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : isSuspicious
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          }`}>
                            {isCritical ? <Bot className="w-3 h-3 text-rose-400" /> : <AlertTriangle className="w-3 h-3" />}
                            <span>{item.riskLevel}</span>
                          </span>
                        </td>

                        {/* Anomaly Factors */}
                        <td className="py-4 px-4">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {item.anomalyFactors.length === 0 ? (
                              <span className="text-[10px] text-slate-500 font-mono">Normal human pattern</span>
                            ) : (
                              item.anomalyFactors.map((af, i) => (
                                <span
                                  key={i}
                                  className="text-[9px] bg-slate-950 text-rose-300 border border-rose-900/60 px-2 py-0.5 rounded-md font-mono"
                                >
                                  {af}
                                </span>
                              ))
                            )}
                          </div>
                        </td>

                        {/* Timestamp */}
                        <td className="py-4 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleString('en-PK', {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })}
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-4 text-right">
                          {item.user ? (
                            <button
                              onClick={() => handleToggleFreezeUser(item.user)}
                              disabled={actionLoadingId === item.user.id}
                              className={`py-1.5 px-3 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm ${
                                isUserFrozen
                                  ? 'bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700'
                                  : 'bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-700'
                              }`}
                            >
                              {actionLoadingId === item.user.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : isUserFrozen ? (
                                <>
                                  <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Unfreeze User</span>
                                </>
                              ) : (
                                <>
                                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                                  <span>Freeze Account</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">Guest Session</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
