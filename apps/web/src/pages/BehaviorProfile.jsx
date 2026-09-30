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
  event_view: <Eye className="w-4 h-4 text-[#008459]" />,
  category_view: <Layers className="w-4 h-4 text-teal-600" />,
  seat_selected: <CheckSquare className="w-4 h-4 text-[#008459]" />,
  seat_locked: <Clock className="w-4 h-4 text-amber-600" />,
  checkout_started: <ShoppingCart className="w-4 h-4 text-blue-600" />,
  checkout_abandoned: <Clock className="w-4 h-4 text-rose-600" />,
  payment_completed: <CreditCard className="w-4 h-4 text-[#008459]" />,
  payment_failed: <AlertTriangle className="w-4 h-4 text-rose-600" />,
  ticket_purchased: <Ticket className="w-4 h-4 text-[#008459]" />,
  ticket_transferred: <ArrowRightLeft className="w-4 h-4 text-blue-600" />,
  resale_viewed: <Eye className="w-4 h-4 text-teal-600" />,
  resale_attempted: <TrendingUp className="w-4 h-4 text-amber-600" />,
  gate_checked_in: <ShieldCheck className="w-4 h-4 text-[#008459]" />,
  wallet_connected: <Sparkles className="w-4 h-4 text-purple-600" />,
  login: <User className="w-4 h-4 text-slate-600" />,
};

const ACTION_BADGES = {
  event_view: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  category_view: 'bg-teal-50 text-teal-800 border-teal-200',
  seat_selected: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  seat_locked: 'bg-amber-50 text-amber-800 border-amber-200',
  checkout_started: 'bg-blue-50 text-blue-800 border-blue-200',
  checkout_abandoned: 'bg-rose-50 text-rose-800 border-rose-200',
  payment_completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  payment_failed: 'bg-rose-50 text-rose-800 border-rose-200',
  ticket_purchased: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  ticket_transferred: 'bg-blue-50 text-blue-800 border-blue-200',
  resale_viewed: 'bg-teal-50 text-teal-800 border-teal-200',
  resale_attempted: 'bg-amber-50 text-amber-800 border-amber-200',
  gate_checked_in: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  wallet_connected: 'bg-purple-50 text-purple-800 border-purple-200',
  login: 'bg-slate-100 text-slate-700 border-slate-200',
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
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#e6f4ea] text-[#008459] flex items-center justify-center font-bold shadow-sm">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">User Behavioral Profile</h1>
                <span className="text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  ML Telemetry Engine
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Action-level behavioral tracking, session conversion provenance, and machine learning diagnostic metrics
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchProfile}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#008459]' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>
      </div>

      {loading && !profile ? (
        <div className="py-24 text-center text-slate-500 bg-white rounded-3xl border border-slate-200/90 shadow-sm">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#008459]" />
          <p className="text-xs font-medium">Synthesizing behavioral session profile...</p>
        </div>
      ) : (
        <>
          {/* AI Diagnostic Score Gauges */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Purchase Intent Gauge */}
            <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-sm relative overflow-hidden space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    Gradient Boosting Intent Model
                  </span>
                  <h3 className="text-base font-extrabold text-[#212b36] mt-2">Purchase Intent Score</h3>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    Evaluates session views, dwell time, and checkout interactions to estimate likelihood of booking.
                  </p>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-[#008459] flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>

              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-4xl font-extrabold text-[#212b36]">
                  {profile?.scores?.purchaseIntent?.score ?? 75}
                </span>
                <span className="text-xs font-mono text-slate-400">/ 100</span>
                <span className={`text-[10px] font-bold uppercase px-3 py-1 rounded-full border ${
                  profile?.scores?.purchaseIntent?.tier === 'HIGH'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  {profile?.scores?.purchaseIntent?.tier || 'HIGH'} INTENT
                </span>
              </div>

              {/* Progress bar */}
              <div className="mt-2 w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#008459] h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(5, profile?.scores?.purchaseIntent?.score ?? 75))}%` }}
                ></div>
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>{profile?.scores?.purchaseIntent?.description || 'Highly Engaged Attendee'}</span>
                <span>Active Telemetry Engine</span>
              </div>
            </div>

            {/* AI Anti-Scalping Fraud Score Gauge */}
            <div className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-sm relative overflow-hidden space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">
                    Random Forest Fraud Classifier
                  </span>
                  <h3 className="text-base font-extrabold text-[#212b36] mt-2">AI Scalper / Bot Risk Score</h3>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    Continuous analysis of checkout velocity, click frequency, and automated seat hoarding patterns.
                  </p>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
              </div>

              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-4xl font-extrabold text-[#212b36]">
                  {profile?.scores?.fraudRisk?.score ?? 12}
                </span>
                <span className="text-xs font-mono text-slate-400">/ 100</span>
                <span className={`text-[10px] font-bold uppercase px-3 py-1 rounded-full border ${
                  profile?.scores?.fraudRisk?.level === 'LOW'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}>
                  {profile?.scores?.fraudRisk?.level || 'LOW'} RISK
                </span>
              </div>

              {/* Progress bar */}
              <div className="mt-2 w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (profile?.scores?.fraudRisk?.score ?? 12) > 50
                      ? 'bg-rose-500'
                      : 'bg-[#008459]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(5, profile?.scores?.fraudRisk?.score ?? 12))}%` }}
                ></div>
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>{profile?.scores?.fraudRisk?.description || 'Verified Human Behavior'}</span>
                <span>Protected by TicketLedger AI</span>
              </div>
            </div>
          </div>

          {/* 8 Required KPI Behavioral Action Counters */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#008459]" />
              <span>Behavioral Action Summary (Lifetime)</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: 'Events Viewed', value: profile?.stats?.eventsViewed ?? 0, icon: Eye, color: 'text-[#008459]' },
                { label: 'Seats Selected', value: profile?.stats?.seatsSelected ?? 0, icon: CheckSquare, color: 'text-teal-600' },
                { label: 'Checkouts Started', value: profile?.stats?.checkoutsStarted ?? 0, icon: ShoppingCart, color: 'text-blue-600' },
                { label: 'Abandoned Carts', value: profile?.stats?.abandonedCheckouts ?? 0, icon: Clock, color: 'text-rose-600' },
                { label: 'Payments Done', value: profile?.stats?.paymentsCompleted ?? 0, icon: CreditCard, color: 'text-[#008459]' },
                { label: 'Tickets Bought', value: profile?.stats?.ticketsPurchased ?? 0, icon: Ticket, color: 'text-[#008459]' },
                { label: 'Transfers/Resales', value: (profile?.stats?.transfersSent ?? 0) + (profile?.stats?.resalesAttempted ?? 0), icon: ArrowRightLeft, color: 'text-amber-600' },
                { label: 'Gate Check-Ins', value: profile?.stats?.gateCheckIns ?? 0, icon: ShieldCheck, color: 'text-purple-600' },
              ].map((kpi, idx) => (
                <div key={idx} className="p-4 rounded-3xl bg-white border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 truncate">{kpi.label}</span>
                    <kpi.icon className={`w-3.5 h-3.5 shrink-0 ${kpi.color}`} />
                  </div>
                  <div className="text-2xl font-extrabold text-[#212b36]">
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Simulator Bar */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200/90 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-[#008459] flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> Client Telemetry Test Tool
              </div>
              <div className="text-xs text-slate-500 mt-0.5 font-medium">
                Dispatch any behavioral action into the tracking pipeline to test timeline updates
              </div>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <select
                value={selectedSimAction}
                onChange={(e) => setSelectedSimAction(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 font-semibold"
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
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#008459] hover:bg-[#00704c] text-white text-xs font-bold transition disabled:opacity-50 shadow-sm"
              >
                {simulatingAction ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                <span>Log Action</span>
              </button>
            </div>
          </div>

          {/* Action Timeline */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-[#212b36]">Chronological Action Timeline</h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono font-bold">
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
                    className={`px-3.5 py-1.5 rounded-full font-bold transition border ${
                      filterAction === tab.id
                        ? 'bg-[#008459] text-white border-[#008459] shadow-sm'
                        : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredTimeline.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-3xl border border-slate-200/90 shadow-sm">
                <Activity className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-[#212b36]">No actions in this view</h4>
                <p className="text-xs text-slate-400 mt-1">Actions are logged automatically during navigation.</p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {filteredTimeline.map((item) => {
                  const isExpanded = expandedTimelineId === item.id;
                  const badgeClass = ACTION_BADGES[item.action] || 'bg-slate-100 text-slate-700 border-slate-200';

                  return (
                    <div
                      key={item.id}
                      className="relative p-4 rounded-3xl bg-white border border-slate-200/90 hover:border-slate-300 transition shadow-sm"
                    >
                      {/* Timeline dot */}
                      <div className="absolute -left-[27px] top-5 w-3 h-3 rounded-full bg-[#008459] border-2 border-white shadow-sm"></div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 shrink-0">
                            {ACTION_ICONS[item.action] || <Activity className="w-4 h-4 text-slate-500" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full border font-bold ${badgeClass}`}>
                                {item.action.replace(/_/g, ' ')}
                              </span>
                              {item.eventTitle && (
                                <span className="text-xs font-bold text-[#212b36]">
                                  {item.eventTitle}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                              Session: {item.sessionId}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 font-mono font-medium">
                            {formatTimeAgo(item.createdAt)}
                          </span>
                          {item.metadata && Object.keys(item.metadata).length > 0 && (
                            <button
                              onClick={() => setExpandedTimelineId(isExpanded ? null : item.id)}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded transition"
                              title="Toggle metadata payload"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Metadata JSON Drawer */}
                      {isExpanded && item.metadata && (
                        <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 overflow-x-auto">
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
