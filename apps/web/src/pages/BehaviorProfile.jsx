import React, { useState, useEffect } from 'react';
import api, { trackClientBehavior } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Activity,
  Eye,
  CheckSquare,
  ShoppingCart,
  Clock,
  CreditCard,
  Ticket,
  ArrowRightLeft,
  ShieldCheck,
  Zap,
  TrendingUp,
  AlertTriangle,
  Bot,
  User,
  Filter,
  RefreshCw,
  Send,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';

const ACTION_ICONS = {
  event_view: <Eye className="w-4 h-4 text-emerald-400" />,
  category_view: <Layers className="w-4 h-4 text-teal-400" />,
  seat_selected: <CheckSquare className="w-4 h-4 text-emerald-300" />,
  seat_locked: <Clock className="w-4 h-4 text-amber-400" />,
  checkout_started: <ShoppingCart className="w-4 h-4 text-blue-400" />,
  checkout_abandoned: <Clock className="w-4 h-4 text-rose-400" />,
  payment_completed: <CreditCard className="w-4 h-4 text-emerald-400" />,
  payment_failed: <AlertTriangle className="w-4 h-4 text-rose-400" />,
  ticket_purchased: <Ticket className="w-4 h-4 text-emerald-300" />,
  ticket_transferred: <ArrowRightLeft className="w-4 h-4 text-blue-400" />,
  resale_viewed: <Eye className="w-4 h-4 text-teal-400" />,
  resale_attempted: <TrendingUp className="w-4 h-4 text-amber-400" />,
  gate_checked_in: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  wallet_connected: <Sparkles className="w-4 h-4 text-purple-400" />,
  login: <User className="w-4 h-4 text-slate-300" />,
};

const ACTION_BADGES = {
  event_view: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  category_view: 'bg-teal-950/60 text-teal-300 border-teal-800/60',
  seat_selected: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  seat_locked: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  checkout_started: 'bg-blue-950/60 text-blue-300 border-blue-800/60',
  checkout_abandoned: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
  payment_completed: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  payment_failed: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
  ticket_purchased: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  ticket_transferred: 'bg-blue-950/60 text-blue-300 border-blue-800/60',
  resale_viewed: 'bg-teal-950/60 text-teal-300 border-teal-800/60',
  resale_attempted: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  gate_checked_in: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  wallet_connected: 'bg-purple-950/60 text-purple-300 border-purple-800/60',
  login: 'bg-slate-800 text-slate-300 border-slate-700',
};

const formatTimeAgo = (dateStr) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
};

export default function BehaviorProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('ALL');
  const [expandedTimelineId, setExpandedTimelineId] = useState(null);

  // Quick Action Simulator
  const [simulatingAction, setSimulatingAction] = useState(false);
  const [selectedSimAction, setSelectedSimAction] = useState('event_view');

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await api.get('/behavior/profile');
      if (res.data.success) {
        setProfile(res.data.data);
      }
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
      await trackClientBehavior(selectedSimAction, null, {
        source: 'Behavior Profile Simulator',
        timestamp: new Date().toISOString(),
      });
      await fetchProfile();
    } catch (err) {
      console.error(err);
    } finally {
      setSimulatingAction(false);
    }
  };

  const filteredTimeline = (profile?.timeline || []).filter((item) => {
    if (filterAction === 'ALL') return true;
    if (filterAction === 'VIEWS') return item.action.includes('view');
    if (filterAction === 'CHECKOUTS') return item.action.includes('checkout') || item.action.includes('seat');
    if (filterAction === 'PURCHASES') return item.action.includes('payment') || item.action.includes('ticket');
    if (filterAction === 'GATE_TRANSFER') return item.action.includes('gate') || item.action.includes('transfer') || item.action.includes('resale');
    return item.action === filterAction;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-slate-950 font-bold shadow-lg shadow-emerald-600/20">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-white tracking-tight">User Behavioral Profile</h1>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold">
                  Module 13 ML Telemetry
                </span>
              </div>
              <p className="text-sm text-slate-400">
                Action-level behavioral tracking, session conversion provenance, and machine learning diagnostic metrics
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProfile}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>
      </div>

      {loading && !profile ? (
        <div className="py-24 text-center text-slate-500">
          <RefreshCw className="w-10 h-10 animate-spin mx-auto mb-3 text-emerald-500" />
          <p className="text-sm">Synthesizing behavioral session profile...</p>
        </div>
      ) : (
        <>
          {/* AI Diagnostic Score Gauges */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Purchase Intent Gauge */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 border border-emerald-500/30 shadow-2xl relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                    Gradient Boosting Intent Model
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">Purchase Intent Score</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Evaluates session views, dwell time, and checkout interactions to estimate likelihood of booking.
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <TrendingUp className="w-6 h-6" />
                </div>
              </div>

              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-4xl font-black text-white">
                  {profile?.scores?.purchaseIntent?.score ?? 75}
                </span>
                <span className="text-xs font-mono text-slate-400">/ 100</span>
                <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full border ${
                  profile?.scores?.purchaseIntent?.tier === 'HIGH'
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                    : 'bg-amber-950/60 text-amber-400 border-amber-800'
                }`}>
                  {profile?.scores?.purchaseIntent?.tier || 'HIGH'} INTENT
                </span>
              </div>

              {/* Progress bar */}
              <div className="mt-3 w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-teal-400 to-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(5, profile?.scores?.purchaseIntent?.score ?? 75))}%` }}
                ></div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                <span>{profile?.scores?.purchaseIntent?.description || 'Highly Engaged Attendee'}</span>
                <span>Active Telemetry Engine</span>
              </div>
            </div>

            {/* AI Anti-Scalping Fraud Score Gauge */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-2xl relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-teal-400 font-bold">
                    Random Forest Fraud Classifier
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">AI Scalper / Bot Risk Score</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Continuous analysis of checkout velocity, click frequency, and automated seat hoarding patterns.
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400">
                  <Bot className="w-6 h-6" />
                </div>
              </div>

              <div className="mt-6 flex items-baseline gap-3">
                <span className="text-4xl font-black text-white">
                  {profile?.scores?.fraudRisk?.score ?? 12}
                </span>
                <span className="text-xs font-mono text-slate-400">/ 100</span>
                <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full border ${
                  profile?.scores?.fraudRisk?.level === 'LOW'
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                    : 'bg-rose-950/60 text-rose-400 border-rose-800'
                }`}>
                  {profile?.scores?.fraudRisk?.level || 'LOW'} RISK
                </span>
              </div>

              {/* Progress bar */}
              <div className="mt-3 w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (profile?.scores?.fraudRisk?.score ?? 12) > 50
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                      : 'bg-gradient-to-r from-teal-500 to-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(5, profile?.scores?.fraudRisk?.score ?? 12))}%` }}
                ></div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                <span>{profile?.scores?.fraudRisk?.description || 'Verified Human Behavior'}</span>
                <span>Protected by TicketLedger AI</span>
              </div>
            </div>
          </div>

          {/* 8 Required KPI Behavioral Action Counters */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span>Behavioral Action Summary (Lifetime)</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: 'Events Viewed', value: profile?.stats?.eventsViewed ?? 0, icon: Eye, color: 'text-emerald-400' },
                { label: 'Seats Selected', value: profile?.stats?.seatsSelected ?? 0, icon: CheckSquare, color: 'text-teal-400' },
                { label: 'Checkouts Started', value: profile?.stats?.checkoutsStarted ?? 0, icon: ShoppingCart, color: 'text-blue-400' },
                { label: 'Checkouts Abandoned', value: profile?.stats?.abandonedCheckouts ?? 0, icon: Clock, color: 'text-rose-400' },
                { label: 'Payments Completed', value: profile?.stats?.paymentsCompleted ?? 0, icon: CreditCard, color: 'text-emerald-400' },
                { label: 'Tickets Purchased', value: profile?.stats?.ticketsPurchased ?? 0, icon: Ticket, color: 'text-emerald-300' },
                { label: 'Transfers & Resales', value: (profile?.stats?.transfersSent ?? 0) + (profile?.stats?.resalesAttempted ?? 0), icon: ArrowRightLeft, color: 'text-amber-400' },
                { label: 'Gate Check-Ins', value: profile?.stats?.gateCheckIns ?? 0, icon: ShieldCheck, color: 'text-purple-400' },
              ].map((kpi, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 truncate">{kpi.label}</span>
                    <kpi.icon className={`w-3.5 h-3.5 shrink-0 ${kpi.color}`} />
                  </div>
                  <div className="text-2xl font-black text-white mt-2">
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Simulator Bar */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> Client Telemetry Test Tool
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Dispatch any behavioral action into the tracking pipeline to test timeline updates
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={selectedSimAction}
                onChange={(e) => setSelectedSimAction(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                <option value="event_view">event_view</option>
                <option value="category_view">category_view</option>
                <option value="seat_selected">seat_selected</option>
                <option value="seat_locked">seat_locked</option>
                <option value="checkout_started">checkout_started</option>
                <option value="checkout_abandoned">checkout_abandoned</option>
                <option value="payment_completed">payment_completed</option>
                <option value="payment_failed">payment_failed</option>
                <option value="ticket_purchased">ticket_purchased</option>
                <option value="ticket_transferred">ticket_transferred</option>
                <option value="resale_viewed">resale_viewed</option>
                <option value="resale_attempted">resale_attempted</option>
                <option value="gate_checked_in">gate_checked_in</option>
                <option value="wallet_connected">wallet_connected</option>
                <option value="login">login</option>
              </select>

              <button
                onClick={handleSimulate}
                disabled={simulatingAction}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold transition disabled:opacity-50"
              >
                {simulatingAction ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                <span>Log Action</span>
              </button>
            </div>
          </div>

          {/* Action Timeline */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Chronological Action Timeline</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {filteredTimeline.length} events
                </span>
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {[
                  { id: 'ALL', label: 'All Actions' },
                  { id: 'VIEWS', label: 'Views' },
                  { id: 'CHECKOUTS', label: 'Seats & Checkouts' },
                  { id: 'PURCHASES', label: 'Purchases' },
                  { id: 'GATE_TRANSFER', label: 'Gates & Transfers' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFilterAction(tab.id)}
                    className={`px-3 py-1 rounded-lg font-medium transition ${
                      filterAction === tab.id
                        ? 'bg-emerald-600 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredTimeline.length === 0 ? (
              <div className="py-16 text-center bg-slate-900/50 rounded-2xl border border-slate-800">
                <Activity className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-white">No actions in this view</h4>
                <p className="text-xs text-slate-400 mt-1">Actions are logged automatically during navigation.</p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {filteredTimeline.map((item) => {
                  const isExpanded = expandedTimelineId === item.id;
                  const badgeClass = ACTION_BADGES[item.action] || 'bg-slate-800 text-slate-300 border-slate-700';

                  return (
                    <div
                      key={item.id}
                      className="relative p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition"
                    >
                      {/* Timeline dot */}
                      <div className="absolute -left-[29px] top-5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-950"></div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 shrink-0">
                            {ACTION_ICONS[item.action] || <Activity className="w-4 h-4 text-slate-400" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs uppercase font-mono px-2 py-0.5 rounded-md border font-bold ${badgeClass}`}>
                                {item.action.replace(/_/g, ' ')}
                              </span>
                              {item.eventTitle && (
                                <span className="text-xs font-semibold text-white">
                                  {item.eventTitle}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              Session: {item.sessionId}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 font-mono">
                            {formatTimeAgo(item.createdAt)}
                          </span>
                          {item.metadata && Object.keys(item.metadata).length > 0 && (
                            <button
                              onClick={() => setExpandedTimelineId(isExpanded ? null : item.id)}
                              className="text-slate-400 hover:text-white p-1 rounded transition"
                              title="Toggle metadata payload"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Metadata JSON Drawer */}
                      {isExpanded && item.metadata && (
                        <div className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                          <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
