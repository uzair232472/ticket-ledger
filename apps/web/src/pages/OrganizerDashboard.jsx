import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StaffManager from '../components/StaffManager';
import {
  TrendingUp,
  DollarSign,
  Ticket,
  Users,
  Scan,
  AlertTriangle,
  Flame,
  UserX,
  RefreshCw,
  Calendar,
  MapPin,
  ChevronRight,
  ArrowUpRight,
  ShieldAlert,
  Zap,
  CheckCircle2,
  Clock,
  Sparkles,
  BarChart3,
  Pencil,
  LayoutGrid
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function OrganizerDashboard() {
  const { user, token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedEventId, setSelectedEventId] = useState(searchParams.get('eventId') || 'ALL');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Fetch Organizer Dashboard Metrics
  const fetchDashboard = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedEventId && selectedEventId !== 'ALL') {
        params.append('eventId', selectedEventId);
      }
      const res = await fetch(`${API_URL}/api/organizer/organizer-dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setDashboardData(json.data);
      } else {
        setError(json.message || 'Failed to load organizer dashboard');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching dashboard metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchDashboard();
    }
  }, [selectedEventId, token]);

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-400">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400 mb-2" />
        <p className="text-xs">Loading organizer intelligence dashboard...</p>
      </div>
    );
  }

  const metrics = dashboardData?.metrics || {};
  const liveGate = dashboardData?.liveGatePacing || {};
  const attendance = dashboardData?.attendancePrediction || {};
  const tierBreakdown = dashboardData?.tierBreakdown || [];
  const salesGraph = dashboardData?.salesGraph || [];
  const fraudFeed = dashboardData?.fraudFeed || [];
  const modulesPreview = dashboardData?.modulesPreview || {};

  return (
    <div className="space-y-8 pb-16 text-slate-800">
      {/* Top Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#16a34a] border border-emerald-200 flex items-center justify-center shadow-sm">
              <BarChart3 className="w-6 h-6 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
                  Organizer Analytics Hub
                </h1>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-[#16a34a] border border-emerald-200">
                  Module 19
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
                Real-time sales velocity, gate ingress pacing, attendance forecast, and fraud alert feeds.
              </p>
            </div>
          </div>
        </div>

        {/* Event Selector & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              setSearchParams(e.target.value !== 'ALL' ? { eventId: e.target.value } : {});
            }}
            className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-[#22c55e] font-semibold"
          >
            <option value="ALL">All Events (Aggregated)</option>
            {dashboardData?.events?.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.city})
              </option>
            ))}
          </select>

          {selectedEventId !== 'ALL' && (
            <Link
              to={`/organizer/events/${selectedEventId}/edit`}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm transition"
            >
              <Pencil className="w-3.5 h-3.5 text-[#16a34a]" />
              <span>Edit event</span>
            </Link>
          )}
          {selectedEventId !== 'ALL' && (
            <Link
              to={`/organizer/events/${selectedEventId}/venue`}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm transition"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-[#16a34a]" />
              <span>Venue &amp; seating</span>
            </Link>
          )}

          <button
            onClick={fetchDashboard}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#16a34a] ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Revenue */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Gross Revenue</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#16a34a] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
            PKR {(metrics.totalRevenuePkr || 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 flex justify-between pt-1">
            <span>Net: <strong className="text-slate-700">PKR {(metrics.netRevenuePkr || 0).toLocaleString()}</strong></span>
            <span className="text-slate-400">Fee (5%): PKR {(metrics.platformFeePkr || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Tickets Sold */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Tickets Sold</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Ticket className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
            {(metrics.totalTicketsSold || 0).toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-1">/ {metrics.totalCapacity || 0}</span>
          </div>
          <div className="text-[11px] text-indigo-700 font-semibold pt-1">
            {metrics.totalCapacity > 0
              ? `${Math.round((metrics.totalTicketsSold / metrics.totalCapacity) * 100)}% Occupancy Rate`
              : '0% Occupancy'}
          </div>
        </div>

        {/* Live Gate Scans / Turnout */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Live Gate Check-ins</span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Scan className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
            {liveGate.scanned || 0}
            <span className="text-xs font-normal text-slate-400 ml-1">
              ({liveGate.turnoutPercentage || 0}%)
            </span>
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold pt-1">
            {liveGate.remaining || 0} expected arrivals remaining
          </div>
        </div>

        {/* Attendance Prediction */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Predicted Turnout</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black text-purple-700 font-mono">
            {attendance.rate || 88.5}%
          </div>
          <div className="text-[11px] text-amber-700 font-semibold pt-1">
            No-Show Risk: {attendance.noShowRisk || 11.5}% buffer
          </div>
        </div>
      </div>

      {/* Row 2: Sales Graph & Live Gate Ingress Pacing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Graph (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#16a34a]" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Sales Velocity & Revenue Timeline
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {salesGraph.length} Days Tracked
            </span>
          </div>

          {salesGraph.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              No sales recorded yet for the selected event filter.
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              {salesGraph.map((item) => {
                const maxRev = Math.max(...salesGraph.map((s) => s.revenuePkr), 1);
                const barWidth = Math.round((item.revenuePkr / maxRev) * 100);
                return (
                  <div key={item.date} className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-700">
                      <span className="font-semibold text-slate-800">{item.date}</span>
                      <span className="font-mono text-[#16a34a] font-bold">
                        PKR {item.revenuePkr.toLocaleString()} ({item.ticketsSold} tickets)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-[#16a34a] h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(barWidth, 6)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Gate Entry Pacing Monitor */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Scan className="w-4 h-4 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Live Gate Ingress
              </h2>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold animate-pulse">
              LIVE
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>Turnout Progress</span>
                <span className="font-bold text-slate-900">{liveGate.turnoutPercentage || 0}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-[#16a34a] h-full rounded-full"
                  style={{ width: `${Math.min(liveGate.turnoutPercentage || 0, 100)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400">Valid Ingress</div>
                <div className="text-base font-bold text-[#16a34a] mt-0.5 font-mono">
                  {liveGate.scanned || 0}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-400">Duplicate Flags</div>
                <div className="text-base font-bold text-amber-600 mt-0.5 font-mono">
                  {liveGate.duplicateScans || 0}
                </div>
              </div>
            </div>

            {/* Attendance Forecast Sub-Card */}
            <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 text-purple-900 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>AI Attendance Model Prediction</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Expecting ~<strong className="text-slate-900">{attendance.predictedAttendees || 0}</strong> attendees out of {attendance.totalTicketsSold || 0} ticket holders ({(attendance.confidenceScore || 0.9) * 100}% confidence).
              </p>
              {attendance.factors?.length > 0 && (
                <div className="text-[10px] text-purple-700">
                  • {attendance.factors[0]}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Tickets Sold by Tier & Fraud Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tier Breakdown (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-[#16a34a]" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Tickets Sold by Tier Enclosure
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              {tierBreakdown.length} Enclosures
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-semibold text-[10px] text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Tier Name</th>
                  <th className="px-3 py-3">Price</th>
                  <th className="px-3 py-3">Sold / Total</th>
                  <th className="px-3 py-3">Fill %</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tierBreakdown.map((t) => (
                  <tr key={t.tierId} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {t.tierName}
                    </td>
                    <td className="px-3 py-3 font-mono text-[#16a34a] font-bold">
                      PKR {t.price.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-slate-600 font-mono">
                      {t.soldQuantity} / {t.totalQuantity}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-[#16a34a] h-full rounded-full"
                            style={{ width: `${t.percentageSold}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">{t.percentageSold}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                      PKR {t.tierRevenuePkr.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Fraud Feed */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Event Fraud Watch Feed
              </h2>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
              Anti-Scalp
            </span>
          </div>

          {fraudFeed.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-6 h-6 mx-auto text-[#16a34a] mb-2" />
              No bot or scalper threats flagged for this event.
            </div>
          ) : (
            <div className="space-y-3">
              {fraudFeed.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 truncate max-w-[140px]">
                      {item.userName}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-mono font-bold">
                      Risk {item.fraudScore}/100
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">{item.reason}</p>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4: AI Intelligence Modules Suite Direct Shortcuts */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          Connected AI Intelligence Suite
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Module 16: Intent Analytics */}
          <Link
            to={selectedEventId !== 'ALL' ? `/admin/purchase-intent?eventId=${selectedEventId}` : '/admin/purchase-intent'}
            className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition group block shadow-sm"
          >
            <div className="flex items-center justify-between text-indigo-600 mb-2">
              <Flame className="w-5 h-5" />
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Purchase Intent Analytics (M16)</h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Real-time funnel conversion graph (view &rarr; seat &rarr; checkout &rarr; payment), active watchers, and engagement scores.
            </p>
          </Link>

          {/* Module 17: Demand Forecast */}
          <Link
            to={selectedEventId !== 'ALL' ? `/admin/demand-forecast?eventId=${selectedEventId}` : '/admin/demand-forecast'}
            className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition group block shadow-sm"
          >
            <div className="flex items-center justify-between text-purple-600 mb-2">
              <TrendingUp className="w-5 h-5" />
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Pre-Launch Demand Forecast (M17)</h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Predicted 48-hour sales velocity, AI pricing diagnosis, and dynamic tier pricing optimization sliders.
            </p>
          </Link>

          {/* Module 18: Abandoned Intent */}
          <Link
            to={selectedEventId !== 'ALL' ? `/admin/abandoned-intents?eventId=${selectedEventId}` : '/admin/abandoned-intents'}
            className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition group block shadow-sm"
          >
            <div className="flex items-center justify-between text-rose-600 mb-2">
              <UserX className="w-5 h-5" />
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-slate-800 transition" />
            </div>
            <h3 className="text-xs font-bold text-slate-900">Abandoned Intent Recovery (M18)</h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Recover {modulesPreview.abandonedCarts || 0} drop-off attendees with 1-click In-App and Email discount coupon alerts.
            </p>
          </Link>
        </div>
      </div>

      {/* Gate staff invites and staff list for this company's events */}
      <StaffManager />
    </div>
  );
}
