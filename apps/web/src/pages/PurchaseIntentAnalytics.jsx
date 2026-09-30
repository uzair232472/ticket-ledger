import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  TrendingUp,
  Users,
  Eye,
  ShoppingCart,
  AlertTriangle,
  Send,
  CheckCircle,
  RefreshCw,
  Flame,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Ticket,
  Calendar,
  MapPin,
  ChevronDown,
  Mail,
  Zap,
  Clock,
  Check
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function PurchaseIntentAnalytics() {
  const { eventId: paramEventId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(paramEventId || '');
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Reminder status tracker per user ID
  const [sentReminders, setSentReminders] = useState({});
  const [sendingUserId, setSendingUserId] = useState(null);
  const [batchSending, setBatchSending] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);

  // 1. Fetch Organizer Events to populate event dropdown
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events?limit=20`);
        const json = await res.json();
        if (json.success && json.data.events.length > 0) {
          setEventsList(json.data.events);
          if (!selectedEventId) {
            setSelectedEventId(json.data.events[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load events list:', err);
      }
    };
    fetchEvents();
  }, []);

  // 2. Fetch Analytics for Selected Event
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
    if (selectedEventId) {
      fetchAnalytics(selectedEventId);
    }
  }, [selectedEventId]);

  // Handle Event Dropdown change
  const handleSelectEvent = (e) => {
    const newId = e.target.value;
    setSelectedEventId(newId);
    navigate(`/analytics/intent/${newId}`);
  };

  // 3. Send Single Reminder
  const handleSendReminder = async (targetUserId, reminderType = 'EVENT_REMINDER') => {
    if (!targetUserId) return;
    setSendingUserId(targetUserId);
    setActionSuccessMsg(null);

    try {
      const res = await fetch(`${API_URL}/api/analytics/intent/${selectedEventId}/send-reminder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetUserId,
          reminderType,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSentReminders((prev) => ({ ...prev, [targetUserId]: true }));
        setActionSuccessMsg(`Reminder sent to attendee! In-app notification & alert dispatched.`);
        setTimeout(() => setActionSuccessMsg(null), 5000);
      } else {
        alert(json.message || 'Failed to send reminder');
      }
    } catch (err) {
      alert(`Error sending reminder: ${err.message}`);
    } finally {
      setSendingUserId(null);
    }
  };

  // 4. Send Batch Reminders
  const handleBatchReminder = async (targetAudience) => {
    setBatchSending(true);
    setActionSuccessMsg(null);

    try {
      const res = await fetch(`${API_URL}/api/analytics/intent/${selectedEventId}/batch-reminder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetAudience }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionSuccessMsg(json.message);
        setTimeout(() => setActionSuccessMsg(null), 6000);
      } else {
        alert(json.message || 'Failed to dispatch batch reminders');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setBatchSending(false);
    }
  };

  if (loading && !analytics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <RefreshCw className="w-8 h-8 text-[#008459] animate-spin" />
        <p className="text-slate-500 text-sm font-medium">Aggregating real-time purchase intent and funnel data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2 sm:px-4">
      {/* Top Banner / Event Switcher */}
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase px-3 py-1 rounded-full font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" /> AI Purchase Intent Analytics
            </span>
            <span className="text-[10px] px-3 py-1 rounded-full font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
              Organizer Intelligence
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
            {analytics?.eventName || 'Purchase Intent & Funnel Analytics'}
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-2 font-medium">
            {analytics?.city && (
              <span className="flex items-center gap-1 text-slate-600">
                <MapPin className="w-3.5 h-3.5 text-rose-500" /> {analytics.city} ({analytics.venue})
              </span>
            )}
            {analytics?.companyName && (
              <span className="flex items-center gap-1 text-slate-600">
                <Ticket className="w-3.5 h-3.5 text-[#008459]" /> Hosted by {analytics.companyName}
              </span>
            )}
          </div>
        </div>

        {/* Event Selector & Refresh */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <select
              value={selectedEventId}
              onChange={handleSelectEvent}
              className="bg-slate-50 border border-slate-200 text-slate-800 text-xs sm:text-sm rounded-full px-4 py-2.5 pr-9 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] appearance-none font-semibold cursor-pointer shadow-sm transition"
            >
              {eventsList.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} ({ev.city})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-3 pointer-events-none" />
          </div>

          <button
            onClick={() => fetchAnalytics(selectedEventId)}
            disabled={refreshing}
            className="p-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition shadow-sm"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#008459]' : ''}`} />
          </button>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5 font-medium shadow-sm">
          <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2.5 font-medium shadow-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Event Watchers */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Event Watchers</span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-[#008459] flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-[#212b36]">
            {analytics?.summary?.totalWatchers?.toLocaleString() || 0}
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Unique attendees viewing this event</p>
        </div>

        {/* Users Likely to Buy */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase tracking-wider">High Intent Prospects</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-[#008459] flex items-baseline gap-2">
            {analytics?.summary?.usersLikelyToBuyCount || 0}
            <span className="text-xs font-semibold text-slate-400">
              (Avg: {analytics?.summary?.avgIntentScore || 0}/100)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Attendees with high purchase intent (≥ 60)</p>
        </div>

        {/* Abandoned Checkouts */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-xs font-bold uppercase tracking-wider">Abandoned Carts</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-amber-600">
            {analytics?.summary?.abandonedUsersCount || 0}
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Seat/checkout drop-offs ripe for recovery</p>
        </div>

        {/* Overall Conversion Rate */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-purple-700">
            <span className="text-xs font-bold uppercase tracking-wider">Funnel Conversion</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-purple-600">
            {analytics?.summary?.overallConversionRate || 0}%
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            {analytics?.summary?.ticketsIssuedCount || 0} tickets issued from views
          </p>
        </div>
      </div>

      {/* Visual Conversion Funnel Graph */}
      <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-extrabold text-[#212b36] flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </span>
              Event Conversion Funnel
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              Live tracking from initial page view to verified NFT ticket issuance
            </p>
          </div>
          <div className="text-xs text-slate-600 bg-slate-100 px-3.5 py-1.5 rounded-full border border-slate-200 font-medium">
            Total Pipeline Volume: <span className="text-slate-900 font-bold">{analytics?.summary?.totalWatchers || 0}</span>
          </div>
        </div>

        {/* Funnel Stages Bars */}
        <div className="space-y-4">
          {analytics?.funnel?.map((step, idx) => {
            return (
              <div key={step.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-[10px] border border-slate-200">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-[#212b36]">{step.stage}</span>
                    {idx > 0 && step.dropoff > 0 && (
                      <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 font-medium">
                        -{step.dropoff} drop-off
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-600 font-bold">{step.count.toLocaleString()}</span>
                    <span className="font-mono text-[#008459] font-bold w-12 text-right">{step.percent}%</span>
                  </div>
                </div>

                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5">
                  <div
                    className="h-full rounded-full bg-[#008459] transition-all duration-700 ease-out"
                    style={{ width: `${Math.max(step.percent, 3)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Users Likely to Buy (High Intent) Table */}
      <div className="rounded-3xl bg-white border border-slate-200/90 overflow-hidden shadow-sm space-y-4">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
                <Flame className="w-4 h-4" />
              </span>
              <h2 className="text-base font-extrabold text-[#212b36]">Users Likely to Buy</h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                {analytics?.usersLikelyToBuy?.length || 0} Qualified
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Engaged attendees predicted by Scikit-learn model with high purchase probability
            </p>
          </div>

          <button
            onClick={() => handleBatchReminder('HIGH_INTENT')}
            disabled={batchSending || !analytics?.usersLikelyToBuy?.some((u) => u.userId)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#008459] hover:bg-[#00704c] text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {batchSending ? 'Sending Reminders...' : 'Send Reminders to All High Intent'}
          </button>
        </div>

        {analytics?.usersLikelyToBuy?.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs font-medium">
            No high-intent users detected yet. Telemetry will update as attendees browse.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold text-[11px] border-b border-slate-200/80">
                <tr>
                  <th className="px-6 py-3.5">Attendee / Prospect</th>
                  <th className="px-6 py-3.5">Purchase Intent Score</th>
                  <th className="px-6 py-3.5">Telemetry Actions</th>
                  <th className="px-6 py-3.5">AI Recommended Action</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics?.usersLikelyToBuy?.map((prospect) => {
                  const isSent = sentReminders[prospect.userId];
                  const isSending = sendingUserId === prospect.userId;

                  return (
                    <tr key={prospect.identifier} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">{prospect.userName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {prospect.userEmail || prospect.identifier}
                        </div>
                        {prospect.isRegistered && (
                          <span className="inline-block mt-1 text-[10px] text-teal-800 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200 font-medium">
                            Verified User
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-16 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-[#008459] rounded-full"
                              style={{ width: `${prospect.intentScore}%` }}
                            />
                          </div>
                          <span className="font-mono font-extrabold text-[#008459] text-sm">
                            {prospect.intentScore}/100
                          </span>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {prospect.intentLevel}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="space-y-0.5 text-[11px] text-slate-600">
                          <div>Views: <span className="font-mono font-bold text-slate-900">{prospect.views}</span></div>
                          <div>Seats Selected: <span className="font-mono font-bold text-slate-900">{prospect.seatSelections}</span></div>
                          <div>Checkouts: <span className="font-mono font-bold text-slate-900">{prospect.checkoutStarts}</span></div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 text-[11px]">
                          <Zap className="w-3 h-3 text-indigo-600" />
                          {prospect.recommendedAction}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        {prospect.userId ? (
                          <button
                            onClick={() => handleSendReminder(prospect.userId, 'EVENT_REMINDER')}
                            disabled={isSent || isSending}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition shadow-sm border ${
                              isSent
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 hover:bg-[#008459] text-slate-700 hover:text-white border-slate-200'
                            }`}
                          >
                            {isSent ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" /> Sent
                              </>
                            ) : isSending ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Dispatching...
                              </>
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5" /> Send Reminder
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Guest Session</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Abandoned Users Section */}
      <div className="rounded-3xl bg-white border border-slate-200/90 overflow-hidden shadow-sm space-y-4">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" />
              </span>
              <h2 className="text-base font-extrabold text-[#212b36]">Abandoned Users & Cart Recovery</h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 font-bold border border-amber-200">
                {analytics?.abandonedUsers?.length || 0} Dropouts
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Attendees who selected seats or reached checkout but abandoned without completing payment
            </p>
          </div>

          <button
            onClick={() => handleBatchReminder('ABANDONED')}
            disabled={batchSending || !analytics?.abandonedUsers?.some((u) => u.userId)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {batchSending ? 'Sending Recovery Offers...' : 'Send Recovery Reminder to All'}
          </button>
        </div>

        {analytics?.abandonedUsers?.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs font-medium">
            No abandoned checkouts recorded for this event.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold text-[11px] border-b border-slate-200/80">
                <tr>
                  <th className="px-6 py-3.5">Attendee</th>
                  <th className="px-6 py-3.5">Abandonment Stage</th>
                  <th className="px-6 py-3.5">Purchase Intent</th>
                  <th className="px-6 py-3.5">AI Recovery Strategy</th>
                  <th className="px-6 py-3.5 text-right">Recovery Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics?.abandonedUsers?.map((abandoned) => {
                  const isSent = sentReminders[abandoned.userId];
                  const isSending = sendingUserId === abandoned.userId;

                  return (
                    <tr key={abandoned.identifier} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">{abandoned.userName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {abandoned.userEmail || abandoned.identifier}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-[11px] bg-amber-50 text-amber-800 border border-amber-200">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          {abandoned.abandonmentStage}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-mono font-bold text-slate-800">
                          {abandoned.intentScore}/100
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 font-medium">
                          <Mail className="w-3 h-3 text-amber-600" />
                          {abandoned.recommendedRecoveryAction}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        {abandoned.userId ? (
                          <button
                            onClick={() => handleSendReminder(abandoned.userId, 'ABANDONED_CHECKOUT_REMINDER')}
                            disabled={isSent || isSending}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition shadow-sm border ${
                              isSent
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                            }`}
                          >
                            {isSent ? (
                              <>
                                <Check className="w-3.5 h-3.5" /> Sent
                              </>
                            ) : isSending ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending...
                              </>
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5" /> Send Reminder
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Guest Session</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
