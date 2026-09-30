import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  UserX,
  TrendingUp,
  AlertTriangle,
  Mail,
  Send,
  CheckCircle,
  RefreshCw,
  Clock,
  Calendar,
  MapPin,
  Filter,
  DollarSign,
  Tag,
  Zap,
  ShoppingBag,
  ExternalLink,
  Info,
  Check
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AbandonedIntentDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, token } = useAuth();

  // Filters state
  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(searchParams.get('eventId') || '');
  const [minScore, setMinScore] = useState(searchParams.get('minScore') || '');
  const [selectedReason, setSelectedReason] = useState(searchParams.get('reason') || 'ALL');

  // Data state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Reminders state
  const [sentReminders, setSentReminders] = useState({});
  const [sendingUserId, setSendingUserId] = useState(null);
  const [batchSending, setBatchSending] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState(null);
  const [discountCode, setDiscountCode] = useState('RECOVER10');

  // 1. Fetch available events for filtering
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events?limit=50`);
        const json = await res.json();
        if (json.success && json.data.events) {
          setEventsList(json.data.events);
        }
      } catch (err) {
        console.error('Failed to load events list:', err);
      }
    };
    fetchEvents();
  }, []);

  // 2. Fetch Abandoned Intent Dashboard Data
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

      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setError(json.message || 'Failed to load abandoned intent dashboard');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching abandoned intent dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [selectedEventId, minScore, selectedReason, token]);

  // 3. Dispatch Single Abandoned Cart Reminder
  const handleSendReminder = async (prospect) => {
    if (!prospect.user.id) {
      alert('Cannot send automated direct reminder to unregistered guest (No user account or email).');
      return;
    }

    setSendingUserId(prospect.user.id);
    setActionSuccessMsg(null);

    try {
      const res = await fetch(`${API_URL}/api/analytics/abandoned/send-reminder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetUserId: prospect.user.id,
          eventId: prospect.event.id,
          discountCode,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSentReminders((prev) => ({
          ...prev,
          [`${prospect.user.id}_${prospect.event.id}`]: true,
        }));
        setActionSuccessMsg(`Recovery reminder sent to ${prospect.user.name}!`);
      } else {
        alert(json.message || 'Failed to send recovery reminder');
      }
    } catch (err) {
      alert(err.message || 'Network error sending reminder');
    } finally {
      setSendingUserId(null);
    }
  };

  // 4. Batch Dispatch Reminders to all displayed users
  const handleBatchSendReminders = async () => {
    if (!data?.abandonedUsers || data.abandonedUsers.length === 0) return;

    const registeredUsers = data.abandonedUsers.filter((u) => u.user.id);
    if (registeredUsers.length === 0) {
      alert('No registered users found in the current filtered list to send reminders to.');
      return;
    }

    if (!confirm(`Are you sure you want to dispatch recovery reminders with coupon "${discountCode}" to ${registeredUsers.length} abandoned users?`)) {
      return;
    }

    setBatchSending(true);
    setActionSuccessMsg(null);

    try {
      const res = await fetch(`${API_URL}/api/analytics/abandoned/batch-reminders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: selectedEventId || undefined,
          discountCode,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionSuccessMsg(json.message || `Successfully sent ${json.dispatchedCount} recovery reminders!`);
        // Mark all registered as sent
        const updated = { ...sentReminders };
        registeredUsers.forEach((u) => {
          updated[`${u.user.id}_${u.event.id}`] = true;
        });
        setSentReminders(updated);
      } else {
        alert(json.message || 'Failed to dispatch batch reminders');
      }
    } catch (err) {
      alert(err.message || 'Network error sending batch reminders');
    } finally {
      setBatchSending(false);
    }
  };

  const getReasonBadge = (reason) => {
    switch (reason) {
      case 'PAYMENT_FRICTION':
        return {
          bg: 'bg-rose-50 border-rose-200 text-rose-800',
          label: 'Payment Gateway Friction',
        };
      case 'HIGH_TICKET_PRICE':
        return {
          bg: 'bg-amber-50 border-amber-200 text-amber-800',
          label: 'Price Sensitivity / High Total',
        };
      case 'SEAT_LOCK_TIMEOUT':
        return {
          bg: 'bg-blue-50 border-blue-200 text-blue-800',
          label: 'Seat Lock Expired (10m)',
        };
      case 'COMPARISON_SHOPPING':
        return {
          bg: 'bg-purple-50 border-purple-200 text-purple-800',
          label: 'Comparison Shopping (4+ Views)',
        };
      default:
        return {
          bg: 'bg-slate-100 border-slate-200 text-slate-700',
          label: 'Browser Hesitation / Drop-off',
        };
    }
  };

  const getIntentBadge = (score) => {
    if (score >= 75) {
      return {
        bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        text: 'HIGH INTENT',
      };
    }
    if (score >= 50) {
      return {
        bg: 'bg-amber-50 text-amber-800 border-amber-200',
        text: 'MODERATE',
      };
    }
    return {
      bg: 'bg-slate-100 text-slate-600 border-slate-200',
      text: 'LOW INTENT',
    };
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold shadow-sm">
              <UserX className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#212b36] flex items-center gap-2">
                Abandoned Intent & Cart Recovery
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                  Recovery Engine
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Track attendees who engaged (viewed event, selected seat, started checkout) but dropped off before paying.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-3.5 py-1.5 text-xs text-slate-600 shadow-sm">
            <Tag className="w-3.5 h-3.5 text-[#008459]" />
            <span className="text-slate-500 font-bold">Coupon:</span>
            <input
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
              className="bg-white border border-slate-300 rounded-md px-2 py-0.5 text-xs text-slate-900 font-mono font-bold uppercase w-24 text-center focus:outline-none focus:ring-1 focus:ring-[#008459]"
            />
          </div>

          <button
            onClick={handleBatchSendReminders}
            disabled={batchSending || !data?.summary?.registeredDropouts}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold bg-[#008459] hover:bg-[#00704c] disabled:opacity-50 text-white shadow-sm transition"
          >
            {batchSending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            Batch Send Reminders
          </button>

          <button
            onClick={fetchDashboardData}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#008459]' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {actionSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-800 text-xs font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button
            onClick={() => setActionSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between shadow-sm">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
            <Filter className="w-3.5 h-3.5 text-[#008459]" />
            <span>Filter By:</span>
          </div>

          {/* Event Filter */}
          <select
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              setSearchParams((prev) => {
                if (e.target.value) prev.set('eventId', e.target.value);
                else prev.delete('eventId');
                return prev;
              });
            }}
            className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-full px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 font-semibold shadow-sm"
          >
            <option value="">All Events (Cross-Event View)</option>
            {eventsList.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.city})
              </option>
            ))}
          </select>

          {/* Likely Reason Filter */}
          <select
            value={selectedReason}
            onChange={(e) => {
              setSelectedReason(e.target.value);
              setSearchParams((prev) => {
                if (e.target.value !== 'ALL') prev.set('reason', e.target.value);
                else prev.delete('reason');
                return prev;
              });
            }}
            className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-full px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 font-semibold shadow-sm"
          >
            <option value="ALL">All Abandonment Reasons</option>
            <option value="PAYMENT_FRICTION">Payment Friction</option>
            <option value="HIGH_TICKET_PRICE">High Ticket Price</option>
            <option value="SEAT_LOCK_TIMEOUT">Seat Lock Timeout</option>
            <option value="COMPARISON_SHOPPING">Comparison Shopping</option>
            <option value="BROWSER_HESITATION">Browser Hesitation</option>
          </select>

          {/* Minimum Intent Score */}
          <select
            value={minScore}
            onChange={(e) => {
              setMinScore(e.target.value);
              setSearchParams((prev) => {
                if (e.target.value) prev.set('minScore', e.target.value);
                else prev.delete('minScore');
                return prev;
              });
            }}
            className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-full px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 font-semibold shadow-sm"
          >
            <option value="">Any Intent Score</option>
            <option value="50">Score &ge; 50 (Moderate+)</option>
            <option value="70">Score &ge; 70 (High Intent Only)</option>
            <option value="80">Score &ge; 80 (Very High Intent)</option>
          </select>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="text-slate-900 font-extrabold">{data?.abandonedUsers?.length || 0}</span> abandoned prospects
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Abandoned */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">
              Abandoned Users
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <UserX className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#212b36]">
              {data?.summary?.totalAbandonedUsers ?? 0}
            </span>
            <span className="text-xs text-slate-400 font-medium">
              ({data?.summary?.registeredDropouts ?? 0} registered)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            Users who reached seat selection/checkout but didn't buy
          </p>
        </div>

        {/* Recoverable Revenue */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-bold uppercase tracking-wider">
              Recoverable Revenue
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#008459] font-mono">
              PKR {(data?.summary?.recoverableRevenuePkr ?? 0).toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            Total cart value left in abandoned checkout flows
          </p>
        </div>

        {/* Avg Intent Score */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-xs font-bold uppercase tracking-wider">
              Avg Intent Score
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#212b36]">
              {data?.summary?.avgIntentScore ?? 0}
              <span className="text-sm font-normal text-slate-400">/100</span>
            </span>
            <span className="text-[10px] font-bold text-indigo-700 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200">
              ML Score
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            Based on clickstream, seat locks & checkout velocity
          </p>
        </div>

        {/* Top Drop-off Reason */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-xs font-bold uppercase tracking-wider">
              Top Dropout Reason
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <span className="text-base font-extrabold text-amber-700">
              {data?.summary?.topReason?.replace(/_/g, ' ') || 'NONE DETECTED'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            Primary friction point reported across abandoned sessions
          </p>
        </div>
      </div>

      {/* Main Abandoned Prospects Table */}
      <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm space-y-4">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </span>
            <h2 className="text-base font-extrabold text-[#212b36]">
              Abandoned Prospect Directory
            </h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Real-time telemetry updated continuously
          </span>
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-8 h-8 animate-spin text-[#008459]" />
            <p className="text-xs font-medium text-slate-500 mt-2">Loading abandoned prospects and telemetry...</p>
          </div>
        ) : error ? (
          <div className="p-16 text-center text-rose-600 flex flex-col items-center justify-center gap-2">
            <AlertTriangle className="w-8 h-8" />
            <p className="text-xs font-medium">{error}</p>
          </div>
        ) : !data?.abandonedUsers || data.abandonedUsers.length === 0 ? (
          <div className="p-16 text-center text-slate-500">
            <UserX className="w-8 h-8 mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-bold text-[#212b36]">No Abandoned Users Found</p>
            <p className="text-xs text-slate-400 mt-1">
              Either all users who started checkout completed their orders, or the selected filter criteria yielded 0 matches.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[11px] text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-6 py-3.5">User</th>
                  <th className="px-4 py-3.5">Event</th>
                  <th className="px-4 py-3.5">Funnel Flow & Last Action</th>
                  <th className="px-4 py-3.5 text-center">Intent Score</th>
                  <th className="px-4 py-3.5">Likely Reason & Suggestion</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.abandonedUsers.map((item) => {
                  const reasonBadge = getReasonBadge(item.likelyReason);
                  const intentBadge = getIntentBadge(item.intentScore);
                  const reminderSentKey = `${item.user.id}_${item.event.id}`;
                  const isSent = sentReminders[reminderSentKey];
                  const isSending = sendingUserId === item.user.id;

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 transition duration-150"
                    >
                      {/* User Column */}
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">
                          {item.user.name}
                        </div>
                        {item.user.email ? (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>{item.user.email}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Sess: {item.sessionId?.substring(0, 10)}...
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-1.5">
                          {item.user.isRegistered ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                              REGISTERED USER
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                              GUEST ATTENDEE
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500">
                            {item.user.city}
                          </span>
                        </div>
                      </td>

                      {/* Event Column */}
                      <td className="px-4 py-4">
                        <div className="font-bold text-slate-900">
                          {item.event.name}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>{item.event.venue || item.event.city}</span>
                        </div>
                        <div className="text-[11px] text-[#008459] font-mono font-bold mt-1">
                          Cart: PKR {item.cartValue.toLocaleString()}
                        </div>
                      </td>

                      {/* Funnel Flow & Last Action */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              item.hasViewed
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                          >
                            1. VIEW
                          </span>
                          <span className="text-slate-400">&rarr;</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              item.hasSelectedSeat
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                          >
                            2. SEAT
                          </span>
                          <span className="text-slate-400">&rarr;</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              item.hasStartedCheckout
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                          >
                            3. CHECKOUT
                          </span>
                          <span className="text-slate-400">&rarr;</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              item.hasAbandonedCheckout
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}
                          >
                            4. ABANDONED
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1.5 font-medium">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>Last: <span className="font-mono text-slate-800 font-bold">{item.lastAction}</span></span>
                          <span className="text-slate-400">•</span>
                          <span>{new Date(item.lastActionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </td>

                      {/* Intent Score */}
                      <td className="px-4 py-4 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className="text-base font-extrabold text-[#212b36]">
                            {item.intentScore}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full border mt-0.5 ${intentBadge.bg}`}
                          >
                            {intentBadge.text}
                          </span>
                        </div>
                      </td>

                      {/* Likely Reason */}
                      <td className="px-4 py-4 max-w-xs">
                        <span
                          className={`inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full border mb-1 ${reasonBadge.bg}`}
                        >
                          {reasonBadge.label}
                        </span>
                        <p className="text-[11px] text-slate-600 font-medium">
                          {item.reasonDetail}
                        </p>
                        <div className="text-[11px] text-[#008459] mt-1 font-bold flex items-center gap-1">
                          <Zap className="w-3 h-3 text-[#008459] flex-shrink-0" />
                          <span>Suggest: {item.recommendedAction.replace(/_/g, ' ')}</span>
                        </div>
                      </td>

                      {/* Send Reminder Action Button */}
                      <td className="px-6 py-4 text-right">
                        {isSent ? (
                          <div className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Reminder Sent</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleSendReminder(item)}
                            disabled={isSending || !item.user.isRegistered}
                            title={
                              item.user.isRegistered
                                ? `Send In-App & Email recovery alert with coupon ${discountCode}`
                                : 'Guest attendees cannot receive direct email reminders'
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-100 hover:bg-[#008459] hover:text-white text-slate-700 border border-slate-200 hover:border-[#008459] disabled:opacity-40 transition shadow-sm"
                          >
                            {isSending ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            Send Reminder
                          </button>
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

      {/* Helper Documentation Note */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-5 flex items-start gap-3 text-xs text-slate-600 shadow-sm">
        <Info className="w-4 h-4 text-[#008459] flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-extrabold text-[#212b36]">How Abandoned Intent Works:</span>{' '}
          TicketLedger captures real-time client clickstream signals (`event_view`, `seat_selected`, `seat_locked`, `checkout_started`, `checkout_abandoned`). When an attendee initiates a seat lock or checkout flow but does not finalize their order, their session is aggregated with heuristic diagnosis (price threshold, seat hold timeout, comparison loop) and an ML intent score. Organizers can trigger targeted In-App and Email recovery notifications with single-use promotional discounts.
        </div>
      </div>
    </div>
  );
}
