import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Users,
  Building2,
  Calendar,
  CreditCard,
  Layers,
  AlertTriangle,
  Scan,
  FileText,
  Search,
  RefreshCw,
  Lock,
  Unlock,
  Ban,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Tag,
  DollarSign,
  Activity,
  Sparkles,
  Eye,
  Clock
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function SuperAdminDashboard() {
  const { user, token } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState('overview');

  // Metrics
  const [metrics, setMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // Tab Data State
  const [usersData, setUsersData] = useState({ users: [], total: 0 });
  const [companiesData, setCompaniesData] = useState({ companies: [], counts: {} });
  const [eventsData, setEventsData] = useState({ events: [], total: 0 });
  const [txData, setTxData] = useState({ transactions: [], total: 0 });
  const [blockchainLogs, setBlockchainLogs] = useState({ blockchainLogs: [], total: 0 });
  const [fraudAlerts, setFraudAlerts] = useState({ alerts: [], total: 0 });
  const [gateScans, setGateScans] = useState({ scans: [], total: 0 });
  const [auditLogs, setAuditLogs] = useState({ auditLogs: [], total: 0 });

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [loadingTab, setLoadingTab] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  // Status Change Modal State
  const [statusModal, setStatusModal] = useState({ open: false, user: null, targetStatus: '' });
  const [statusReason, setStatusReason] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // 1. Fetch Overview Metrics
  const fetchMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setMetrics(json.data);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchMetrics();
    }
  }, [token]);

  // 2. Fetch Active Tab Data
  const fetchTabData = async () => {
    setLoadingTab(true);
    try {
      if (activeTab === 'users') {
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        if (filterRole !== 'ALL') params.append('role', filterRole);
        if (filterStatus !== 'ALL') params.append('status', filterStatus);
        const res = await fetch(`${API_URL}/api/admin/users?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setUsersData(json.data);
      } else if (activeTab === 'approvals') {
        const res = await fetch(`${API_URL}/api/companies`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setCompaniesData(json.data);
      } else if (activeTab === 'events') {
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        const res = await fetch(`${API_URL}/api/admin/events?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setEventsData(json.data);
      } else if (activeTab === 'transactions') {
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        const res = await fetch(`${API_URL}/api/admin/transactions?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setTxData(json.data);
      } else if (activeTab === 'blockchain') {
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        const res = await fetch(`${API_URL}/api/admin/blockchain-logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setBlockchainLogs(json.data);
      } else if (activeTab === 'fraud') {
        const res = await fetch(`${API_URL}/api/admin/fraud-alerts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setFraudAlerts(json.data);
      } else if (activeTab === 'gate') {
        const res = await fetch(`${API_URL}/api/admin/gate-scans`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setGateScans(json.data);
      } else if (activeTab === 'audit') {
        const params = new URLSearchParams();
        if (searchTerm) params.append('search', searchTerm);
        const res = await fetch(`${API_URL}/api/admin/audit-logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) setAuditLogs(json.data);
      }
    } catch (err) {
      console.error('Failed to load tab data:', err);
    } finally {
      setLoadingTab(false);
    }
  };

  useEffect(() => {
    if (token && activeTab !== 'overview') {
      fetchTabData();
    }
  }, [activeTab, filterRole, filterStatus, token]);

  // Handle User Status Mutation (Freeze, Unfreeze, Blacklist)
  const handleUpdateStatusConfirm = async () => {
    if (!statusModal.user || !statusModal.targetStatus) return;

    setUpdatingStatus(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${statusModal.user.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: statusModal.targetStatus,
          reason: statusReason || `Administrative action by ${user.name}`,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setActionMsg(json.message);
        setStatusModal({ open: false, user: null, targetStatus: '' });
        setStatusReason('');
        fetchTabData();
        fetchMetrics();
      } else {
        alert(json.message || 'Failed to update user status');
      }
    } catch (err) {
      alert(err.message || 'Network error updating user status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Handle Company Approval/Rejection
  const handleCompanyDecision = async (companyId, newStatus) => {
    try {
      const res = await fetch(`${API_URL}/api/companies/${companyId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setActionMsg(`Company status updated to ${newStatus}`);
        fetchTabData();
        fetchMetrics();
      } else {
        alert(json.message || 'Failed to update company status');
      }
    } catch (err) {
      alert(err.message || 'Network error');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'ACTIVE':
      case 'APPROVED':
      case 'SUCCESSFUL':
      case 'VALID_FIRST_SCAN':
        return 'bg-emerald-50 text-emerald-800 border border-emerald-200';
      case 'FROZEN':
      case 'PENDING':
      case 'ALREADY_SCANNED':
      case 'SUSPICIOUS':
        return 'bg-amber-50 text-amber-800 border border-amber-200';
      case 'BLACKLISTED':
      case 'REJECTED':
      case 'FAILED':
      case 'INVALID_SCAN':
      case 'CRITICAL':
        return 'bg-rose-50 text-rose-800 border border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-200';
    }
  };

  return (
    <div className="space-y-8 pb-16 text-slate-800">
      {/* Top Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#16a34a] border border-emerald-200 flex items-center justify-center font-bold shadow-sm">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
                  Super Admin Governance Center
                </h1>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-[#16a34a] border border-emerald-200">
                  Module 19
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
                Centralized platform governance, multi-role management, blockchain audit trails, gate security, and ML fraud oversight.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchMetrics();
              if (activeTab !== 'overview') fetchTabData();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#16a34a]" /> Refresh Data
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-800 text-xs shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16a34a] flex-shrink-0" />
            <span>{actionMsg}</span>
          </div>
          <button
            onClick={() => setActionMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Users */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Users</span>
            <Users className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-900 font-mono">
            {metrics?.users?.total ?? '...'}
          </div>
          <div className="text-[10px] text-emerald-700 mt-0.5 font-medium">
            {metrics?.users?.active ?? 0} Active • {metrics?.users?.frozen ?? 0} Frozen
          </div>
        </div>

        {/* Organizers */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Organizers</span>
            <Building2 className="w-3.5 h-3.5 text-teal-600" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-900 font-mono">
            {metrics?.companies?.total ?? '...'}
          </div>
          <div className="text-[10px] text-amber-700 mt-0.5 font-medium">
            {metrics?.companies?.pendingApproval ?? 0} Pending Approvals
          </div>
        </div>

        {/* Events */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Events</span>
            <Calendar className="w-3.5 h-3.5 text-purple-600" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-900 font-mono">
            {metrics?.events?.total ?? '...'}
          </div>
          <div className="text-[10px] text-purple-700 mt-0.5 font-medium">
            {metrics?.events?.published ?? 0} Published Live
          </div>
        </div>

        {/* Gross Revenue */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Gross Volume</span>
            <DollarSign className="w-3.5 h-3.5 text-[#16a34a]" />
          </div>
          <div className="mt-2 text-lg font-black text-slate-900 font-mono">
            PKR {((metrics?.financials?.grossRevenuePkr ?? 0) / 1000).toFixed(1)}k
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Fee: PKR {(metrics?.financials?.platformFeePkr ?? 0).toLocaleString()}
          </div>
        </div>

        {/* NFT Tickets */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">NFT Tickets</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-900 font-mono">
            {metrics?.ticketing?.totalTickets ?? '...'}
          </div>
          <div className="text-[10px] text-emerald-700 mt-0.5 font-medium">
            {metrics?.ticketing?.scannedTickets ?? 0} Scanned ({metrics?.ticketing?.turnoutRate ?? 0}%)
          </div>
        </div>

        {/* Gate Scans */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Gate Scans</span>
            <Scan className="w-3.5 h-3.5 text-sky-600" />
          </div>
          <div className="mt-2 text-xl font-black text-slate-900 font-mono">
            {metrics?.operations?.totalGateScans ?? '...'}
          </div>
          <div className="text-[10px] text-sky-700 mt-0.5 font-medium">
            Audit: {metrics?.operations?.totalAuditLogs ?? 0} Logs
          </div>
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="border-b border-slate-200 flex items-center space-x-1.5 overflow-x-auto pb-2 text-xs">
        {[
          { id: 'overview', label: 'Command Hub', icon: ShieldCheck },
          { id: 'users', label: 'Manage Users', icon: Users },
          { id: 'approvals', label: 'Organizer Approvals', icon: Building2 },
          { id: 'events', label: 'Events Directory', icon: Calendar },
          { id: 'transactions', label: 'Transactions', icon: CreditCard },
          { id: 'blockchain', label: 'Blockchain Logs', icon: Layers },
          { id: 'fraud', label: 'ML Fraud Alerts', icon: AlertTriangle },
          { id: 'gate', label: 'Gate Scan Logs', icon: Scan },
          { id: 'audit', label: 'Audit Trail', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchTerm('');
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold whitespace-nowrap transition shadow-sm ${
                isActive
                  ? 'bg-[#16a34a] text-white shadow-emerald-200'
                  : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Command Hub Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions Panel */}
          <div className="lg:col-span-2 bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#16a34a]" />
              System Operations & Direct Shortcuts
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                onClick={() => setActiveTab('users')}
                className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-center justify-between text-indigo-600 mb-2">
                  <Users className="w-5 h-5" />
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition" />
                </div>
                <h3 className="text-xs font-bold text-slate-900">Manage Users & Account States</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Freeze, unfreeze, or permanently blacklist customer or bot accounts.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('approvals')}
                className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-center justify-between text-teal-600 mb-2">
                  <Building2 className="w-5 h-5" />
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition" />
                </div>
                <h3 className="text-xs font-bold text-slate-900">Organizer NTN Verification</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Review submitted corporate registration documents and approve event hosts.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('blockchain')}
                className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-center justify-between text-purple-600 mb-2">
                  <Layers className="w-5 h-5" />
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition" />
                </div>
                <h3 className="text-xs font-bold text-slate-900">Smart Contract & NFT Registry</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Audit Polygon Amoy testnet mints, ERC721 token IDs, and resale caps.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('fraud')}
                className="p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 cursor-pointer transition group shadow-sm"
              >
                <div className="flex items-center justify-between text-rose-600 mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition" />
                </div>
                <h3 className="text-xs font-bold text-slate-900">AI Anti-Scalper & Bot Watchlist</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Live detection of script velocities, IP switching, and automated scalpers.
                </p>
              </div>
            </div>
          </div>

          {/* Platform Health & Specs */}
          <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#16a34a]" />
              Platform Architecture
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                <span className="text-slate-500">Blockchain Network</span>
                <span className="font-mono text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Polygon Amoy (80002)</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                <span className="text-slate-500">Smart Contract Standard</span>
                <span className="font-mono text-slate-800 font-bold">ERC-721 Soulbound/Capped</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                <span className="text-slate-500">Resale Price Cap</span>
                <span className="font-mono text-purple-700 font-bold">110% Maximum</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                <span className="text-slate-500">AI Inference Service</span>
                <span className="font-mono text-indigo-700 font-bold">FastAPI ML (Port 8000)</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-b border-slate-100">
                <span className="text-slate-500">Turnstile Dynamic QR</span>
                <span className="font-mono text-amber-700 font-bold">HMAC-SHA256 (30s Nonce)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Manage Users */}
      {activeTab === 'users' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm space-y-4 p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search user name, email, wallet..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchTabData()}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#22c55e]"
                />
              </div>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-[#22c55e]"
              >
                <option value="ALL">All Roles</option>
                <option value="CUSTOMER">Customers</option>
                <option value="ORGANIZER">Organizers</option>
                <option value="GATE_STAFF">Gate Staff</option>
                <option value="SUPER_ADMIN">Super Admins</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-[#22c55e]"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="FROZEN">Frozen</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>
            </div>
            <button
              onClick={fetchTabData}
              className="btn-eventfrog px-4 py-2 text-xs"
            >
              Search
            </button>
          </div>

          {loadingTab ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#16a34a] mb-2" />
              Loading users directory...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">User & Contact</th>
                    <th className="px-3 py-3">Role</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Wallet</th>
                    <th className="px-3 py-3">Orders / Tickets</th>
                    <th className="px-4 py-3 text-right">Account Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersData.users?.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{u.name}</div>
                        <div className="text-[11px] text-slate-500">{u.email}</div>
                        {u.phone && <div className="text-[10px] text-slate-400">{u.phone}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(u.status)}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-slate-500">
                        {u.walletAddress ? `${u.walletAddress.substring(0, 8)}...${u.walletAddress.substring(36)}` : 'None'}
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-mono">
                        {u._count?.orders ?? 0} orders • {u._count?.tickets ?? 0} tickets
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                        {u.status !== 'ACTIVE' && (
                          <button
                            onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'ACTIVE' })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-semibold transition"
                            title="Unfreeze account"
                          >
                            <Unlock className="w-3 h-3" /> Unfreeze
                          </button>
                        )}
                        {u.status !== 'FROZEN' && (
                          <button
                            onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'FROZEN' })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 text-[11px] font-semibold transition"
                            title="Temporarily freeze account activity"
                          >
                            <Lock className="w-3 h-3" /> Freeze
                          </button>
                        )}
                        {u.status !== 'BLACKLISTED' && (
                          <button
                            onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'BLACKLISTED' })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200 text-[11px] font-semibold transition"
                            title="Permanently blacklist account from platform"
                          >
                            <Ban className="w-3 h-3" /> Blacklist
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Organizer Approvals */}
      {activeTab === 'approvals' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Organizer Verification Requests
            </h2>
            <span className="text-xs text-slate-500">
              {companiesData.companies?.length || 0} Total Submissions
            </span>
          </div>

          {loadingTab ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#16a34a] mb-2" />
              Loading company records...
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {companiesData.companies?.map((comp) => (
                <div key={comp.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{comp.companyName}</span>
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(comp.status)}`}>
                        {comp.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Owner: <span className="text-slate-800 font-semibold">{comp.ownerName}</span> • NTN/CNIC:{' '}
                      <span className="text-slate-800 font-mono font-medium">{comp.ntnCnic}</span> • City: {comp.city}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Email: {comp.email} • Phone: {comp.phone}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {comp.documentUrl && (
                      <a
                        href={comp.documentUrl.startsWith('http') ? comp.documentUrl : `${API_URL}${comp.documentUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold shadow-sm transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#16a34a]" />
                        View NTN Document
                      </a>
                    )}
                    {comp.status === 'PENDING' && (
                      <>
                        <button
                          onClick={() => handleCompanyDecision(comp.id, 'APPROVED')}
                          className="btn-eventfrog px-3.5 py-1.5 text-xs shadow-sm"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleCompanyDecision(comp.id, 'REJECTED')}
                          className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 font-semibold text-xs transition shadow-sm"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Events Directory */}
      {activeTab === 'events' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Platform Events Directory
            </h2>
            <span className="text-xs text-slate-500">
              {eventsData.events?.length || 0} Total Events
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Event & Venue</th>
                  <th className="px-3 py-3">Organizer</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Capacity & Occupancy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {eventsData.events?.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{ev.name}</div>
                      <div className="text-[11px] text-slate-500">{ev.venue}, {ev.city}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {ev.company?.companyName || 'Unknown Organizer'}
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {new Date(ev.date).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(ev.status)}`}>
                        {ev.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-slate-900 font-mono font-semibold">{ev.soldTickets} / {ev.totalCapacity} sold</div>
                      <div className="text-[10px] text-emerald-700 font-semibold">{ev.occupancyRate}% filled</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Transactions */}
      {activeTab === 'transactions' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Financial Transactions
            </h2>
            <span className="text-xs text-slate-500">
              {txData.transactions?.length || 0} Orders
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Order ID & Gateway</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Event</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txData.transactions?.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-800 text-[11px] font-semibold">{tx.id.substring(0, 12)}...</div>
                      <div className="text-[10px] text-teal-700 font-bold">{tx.paymentMethod}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{tx.user?.name}</div>
                      <div className="text-[10px] text-slate-500">{tx.user?.email}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {tx.event?.name}
                    </td>
                    <td className="px-3 py-3 font-bold text-[#16a34a] font-mono">
                      PKR {Number(tx.totalAmount).toLocaleString()}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(tx.status)}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-[11px]">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 6: Blockchain Smart Contract Logs */}
      {activeTab === 'blockchain' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-[#212b36] tracking-tight flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </span>
              Polygon Amoy Smart Contract Logs
            </h2>
            <span className="text-xs text-slate-500 font-mono font-semibold bg-slate-100 px-3 py-1 rounded-full border border-slate-200">Chain ID: 80002</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-4 py-3.5">Token ID & Seat</th>
                  <th className="px-3 py-3.5">Event</th>
                  <th className="px-3 py-3.5">Owner Wallet</th>
                  <th className="px-3 py-3.5">Tx Hash & Explorer</th>
                  <th className="px-3 py-3.5">Transfers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {blockchainLogs.blockchainLogs?.map((log) => (
                  <tr key={log.ticketId} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-purple-700">Token #{log.tokenId || 'Minting'}</div>
                      <div className="text-[11px] text-slate-500 font-medium">{log.seatLabel}</div>
                    </td>
                    <td className="px-3 py-3.5 font-medium text-slate-900">
                      {log.event?.name}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-[11px] text-slate-600">
                      {log.ownerWallet}
                    </td>
                    <td className="px-3 py-3.5">
                      {log.txHash ? (
                        <a
                          href={`https://amoy.polygonscan.com/tx/${log.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#008459] font-mono text-[11px] font-semibold flex items-center gap-1 hover:underline"
                        >
                          {log.txHash.substring(0, 14)}...
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400 font-mono text-[11px] italic">Pending On-Chain</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 font-semibold text-slate-700">
                      {log.transfersCount} Transfers
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 7: ML Fraud Alerts */}
      {activeTab === 'fraud' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-[#212b36] tracking-tight flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </span>
              Machine Learning Bot & Scalper Alerts
            </h2>
            <span className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-200 px-3 py-1 rounded-full">Real-Time Risk Scoring</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-4 py-3.5">Actor & IP</th>
                  <th className="px-3 py-3.5">Risk Level</th>
                  <th className="px-3 py-3.5">Fraud Score</th>
                  <th className="px-3 py-3.5">Anomaly Factors</th>
                  <th className="px-3 py-3.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fraudAlerts.alerts?.map((alert) => (
                  <tr key={alert.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900">{alert.user?.name || 'Guest Session'}</div>
                      <div className="text-[11px] font-mono text-slate-500">{alert.ipAddress} • {alert.city}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(alert.riskLevel)}`}>
                        {alert.riskLevel}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 font-mono font-extrabold text-rose-600">
                      {alert.fraudScore}/100
                    </td>
                    <td className="px-3 py-3.5 text-slate-600 text-[11px]">
                      {alert.factors?.join(', ')}
                    </td>
                    <td className="px-3 py-3.5 text-slate-500 text-[11px]">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 8: Gate Scan Logs */}
      {activeTab === 'gate' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-[#212b36] tracking-tight flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Scan className="w-4 h-4" />
              </span>
              Venue Turnstile Scan Logs
            </h2>
            <span className="text-xs text-slate-500 font-medium bg-slate-100 px-3 py-1 rounded-full border border-slate-200">Dual DB & Polygon Verification</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-4 py-3.5">Scan Result</th>
                  <th className="px-3 py-3.5">Gate #</th>
                  <th className="px-3 py-3.5">Attendee</th>
                  <th className="px-3 py-3.5">Event</th>
                  <th className="px-3 py-3.5">Gate Staff</th>
                  <th className="px-3 py-3.5">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gateScans.scans?.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3.5">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold ${getStatusBadge(s.result)}`}>
                        {s.result.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 font-mono text-slate-900 font-bold">
                      {s.gateNumber || 'Gate 1'}
                    </td>
                    <td className="px-3 py-3.5 font-semibold text-slate-900">
                      {s.ticket?.user?.name || 'Attendee'}
                    </td>
                    <td className="px-3 py-3.5 text-slate-700">
                      {s.ticket?.event?.name}
                    </td>
                    <td className="px-3 py-3.5 text-slate-600 text-[11px]">
                      {s.staff?.name || 'Staff'}
                    </td>
                    <td className="px-3 py-3.5 text-slate-500 text-[11px]">
                      {new Date(s.scanTime).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 9: System Audit Trail */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-extrabold text-[#212b36] tracking-tight flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </span>
              Immutable System Audit Logs
            </h2>
            <span className="text-xs text-slate-500 font-medium bg-slate-100 px-3 py-1 rounded-full border border-slate-200">Security & Administrative Actions</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 uppercase font-bold text-[10px] text-slate-500 border-b border-slate-200/80">
                <tr>
                  <th className="px-4 py-3.5">Action</th>
                  <th className="px-3 py-3.5">Actor</th>
                  <th className="px-3 py-3.5">Target</th>
                  <th className="px-3 py-3.5">Details</th>
                  <th className="px-3 py-3.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.auditLogs?.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3.5 font-mono font-bold text-indigo-700">
                      {log.action}
                    </td>
                    <td className="px-3 py-3.5 font-semibold text-slate-900">
                      {log.user?.name || 'System Auto'}
                    </td>
                    <td className="px-3 py-3.5 text-slate-600 text-[11px]">
                      {log.targetType}: {log.targetId?.substring(0, 10)}...
                    </td>
                    <td className="px-3 py-3.5 font-mono text-[11px] text-slate-600 max-w-xs truncate">
                      {JSON.stringify(log.details)}
                    </td>
                    <td className="px-3 py-3.5 text-slate-500 text-[11px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Status Modal (Freeze/Unfreeze/Blacklist) */}
      {statusModal.open && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                statusModal.targetStatus === 'BLACKLISTED'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : statusModal.targetStatus === 'FROZEN'
                  ? 'bg-amber-50 text-amber-600 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
              }`}>
                {statusModal.targetStatus === 'BLACKLISTED' ? (
                  <Ban className="w-5 h-5" />
                ) : statusModal.targetStatus === 'FROZEN' ? (
                  <Lock className="w-5 h-5" />
                ) : (
                  <Unlock className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-extrabold text-[#212b36] text-base">
                  Confirm Status Change: {statusModal.targetStatus}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Target: {statusModal.user?.name} ({statusModal.user?.email})
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-700 font-bold">
                Administrative Reason / Case Note:
              </label>
              <textarea
                rows={3}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Enter mandatory reason for audit trail log..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setStatusModal({ open: false, user: null, targetStatus: '' })}
                className="px-5 py-2.5 rounded-full text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateStatusConfirm}
                disabled={updatingStatus}
                className={`px-5 py-2.5 rounded-full text-xs font-bold text-white transition shadow-sm ${
                  statusModal.targetStatus === 'BLACKLISTED'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : statusModal.targetStatus === 'FROZEN'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-[#008459] hover:bg-[#00704c]'
                }`}
              >
                {updatingStatus ? 'Updating...' : `Confirm ${statusModal.targetStatus}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
