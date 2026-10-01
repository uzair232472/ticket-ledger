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

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

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

    const isFrozen = user.status === 'SUSPENDED';
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
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" /> Super Admin Defense
              </span>
              <span className="text-[10px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-[#008459]" /> scikit-learn ML Engine
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">
              AI Anti-Scalper & Bot Defense Watchlist
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Real-time telemetry surveillance analyzing checkout velocities, click frequencies, rapid seat sniping attempts, and automated scalper bots across all Pakistani sporting and concert events.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchWatchlist}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-bold text-slate-700 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Feed</span>
            </button>
          </div>
        </div>
      </div>

      {/* Global Success / Alert Banner */}
      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5 font-medium shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>{actionSuccess}</div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5 font-medium shadow-sm">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex justify-between items-center text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Total Sessions Evaluated</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-[#212b36]">{stats.totalEvaluated}</div>
          <div className="text-[11px] text-slate-400 font-medium">Real-time ML telemetry logs</div>
        </div>

        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex justify-between items-center text-rose-700 text-xs font-bold uppercase tracking-wider">
            <span>Critical Scalper Bots</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-rose-600">{stats.criticalBots}</div>
          <div className="text-[11px] text-rose-600/80 font-medium">Sub-second / rapid sniping bots</div>
        </div>

        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex justify-between items-center text-amber-700 text-xs font-bold uppercase tracking-wider">
            <span>Suspicious Sessions</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-amber-600">{stats.suspicious}</div>
          <div className="text-[11px] text-amber-600/80 font-medium">Anomaly flags or elevated risk score</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-3xl bg-white border border-slate-200/90 shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedFilter('ALL')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition border ${selectedFilter === 'ALL'
              ? 'bg-[#008459] text-white border-[#008459] shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
              }`}
          >
            All Flagged ({watchlist.length})
          </button>
          <button
            onClick={() => setSelectedFilter('CRITICAL_BOT')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition flex items-center gap-1.5 border ${selectedFilter === 'CRITICAL_BOT'
              ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
              : 'bg-white text-rose-700 hover:bg-rose-50 border-rose-200'
              }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Critical Bots ({stats.criticalBots})</span>
          </button>
          <button
            onClick={() => setSelectedFilter('SUSPICIOUS')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition flex items-center gap-1.5 border ${selectedFilter === 'SUSPICIOUS'
              ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
              : 'bg-white text-amber-700 hover:bg-amber-50 border-amber-200'
              }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Suspicious ({stats.suspicious})</span>
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search session ID, email, or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-full bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
          />
        </div>
      </div>

      {/* Watchlist Table */}
      <div className="rounded-3xl bg-white border border-slate-200/90 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 text-[11px] uppercase tracking-wider font-bold">
              <tr>
                <th className="py-3.5 px-4">Session / Target User</th>
                <th className="py-3.5 px-4">AI Fraud Score</th>
                <th className="py-3.5 px-4">Risk Classification</th>
                <th className="py-3.5 px-4">Telemetry Anomaly Factors</th>
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4 text-right">Admin Defense Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-16 text-center text-slate-500">
                    <div className="w-8 h-8 border-2 border-[#008459] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    Loading AI security watchlist...
                  </td>
                </tr>
              ) : filteredWatchlist.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-16 text-center text-slate-500 font-medium">
                    No sessions matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredWatchlist.map((item) => {
                  const isCritical = item.riskLevel === 'CRITICAL_BOT';
                  const isSuspicious = item.riskLevel === 'SUSPICIOUS';
                  const isUserFrozen = item.user?.status === 'SUSPENDED';

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      {/* Target User / Session */}
                      <td className="py-4 px-4 space-y-0.5">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{item.user?.name || 'Anonymous Guest'}</span>
                          {item.user && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${isUserFrozen
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}>
                              {item.user.status}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {item.user?.email || item.sessionId}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Session: {item.sessionId}
                        </div>
                      </td>

                      {/* Fraud Score Bar */}
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-mono font-bold">
                            <span className={isCritical ? 'text-rose-600' : isSuspicious ? 'text-amber-600' : 'text-[#008459]'}>
                              {item.fraudScore.toFixed(1)} / 100
                            </span>
                          </div>
                          <div className="w-28 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isCritical ? 'bg-rose-500' : isSuspicious ? 'bg-amber-500' : 'bg-[#008459]'
                                }`}
                              style={{ width: `${Math.min(item.fraudScore, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Risk Level Badge */}
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isCritical
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : isSuspicious
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}>
                          {isCritical ? <Bot className="w-3 h-3 text-rose-600" /> : <AlertTriangle className="w-3 h-3 text-amber-600" />}
                          <span>{item.riskLevel}</span>
                        </span>
                      </td>

                      {/* Anomaly Factors */}
                      <td className="py-4 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.anomalyFactors.length === 0 ? (
                            <span className="text-[11px] text-slate-400 font-medium">Normal human pattern</span>
                          ) : (
                            item.anomalyFactors.map((af, i) => (
                              <span
                                key={i}
                                className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-mono font-semibold"
                              >
                                {af}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="py-4 px-4 text-slate-500 text-[11px] whitespace-nowrap">
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
                            className={`py-1.5 px-3.5 rounded-full text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm border ${isUserFrozen
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                              : 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200'
                              }`}
                          >
                            {actionLoadingId === item.user.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : isUserFrozen ? (
                              <>
                                <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Reactivate User</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5 text-rose-600" />
                                <span>Suspend Account</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Guest Session</span>
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
  );
}
