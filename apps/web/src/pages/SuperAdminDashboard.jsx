import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import StaffManager from '../components/StaffManager';
import { useDialog } from '../components/ui/DialogProvider';
import { DashHead, DashCard, Kpi, Chip, Figure, Tile, Segmented, Status, Notice, DashState, EventTile, EventThumb } from '../components/dash/DashShell';
import { TabStats, Directory, Avatar } from '../components/dash/Studio';
import { ColumnChart, LineChart, Legend, Ring, ArcGauge, Meter, SERIES, NEUTRAL, byDay, compactPkr, formatPkr } from '../components/dash/charts';
import {
  UserPlus,
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
  ExternalLink,
  LayoutGrid,
  Tag,
  BarChart3,
  TrendingUp,
  Star,
  Settings,
  Link2,
  File,
  ArrowRight,
  User,
  PauseCircle,
  XCircle,
  Clock,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PAGE_SIZE = 10;

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'users', label: 'Users', icon: Users },
  { value: 'events', label: 'Events', icon: Calendar },
  { value: 'transactions', label: 'Transactions', icon: CreditCard },
  { value: 'blockchain', label: 'Blockchain', icon: Layers },
  { value: 'fraud', label: 'Fraud alerts', icon: AlertTriangle },
  { value: 'gate', label: 'Gate scans', icon: Scan },
  { value: 'staff', label: 'Gate staff', icon: UserPlus },
  { value: 'audit', label: 'Audit trail', icon: FileText },
];

const PAYMENT_LABELS = { JAZZCASH: 'JazzCash', EASYPAISA: 'EasyPaisa', STRIPE: 'Card', MOCK: 'Test' };
const PAYMENT_COLORS = { JAZZCASH: SERIES[0], EASYPAISA: SERIES[1], STRIPE: SERIES[2], MOCK: NEUTRAL };

const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortTime = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Loading({ children }) {
  return (
    <div className="tl-dash-state">
      <RefreshCw className="w-6 h-6 tl-dash-spin" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function Table({ head, children, empty }) {
  return (
    <div className="tl-dash-table-wrap">
      <table className="tl-dash-table">
        <thead>
          <tr>{head.map((h) => <th key={h.label || h} className={h.num ? 'is-num' : h.right ? 'is-right' : ''}>{h.label || h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <DashState icon={CheckCircle2}>{empty}</DashState>}
    </div>
  );
}

export default function SuperAdminDashboard() {
  const dialog = useDialog();
  // Delete an event: ask first, then report the outcome in the app's dialog
  const deleteEvent = async (ev, after) => {
    const ok = await dialog.confirm({
      tone: 'error',
      title: `Delete “${ev.name}”?`,
      message: 'This permanently removes the event, its tickets setup, seating plan and images. It can’t be undone.\nEvents with sold tickets can’t be deleted; cancel them instead.',
      confirmLabel: 'Delete event',
      cancelLabel: 'Keep event',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/events/${ev.id}`);
      await dialog.alert({ tone: 'success', title: 'Event deleted', message: res.data.message });
      after?.();
    } catch (err) {
      dialog.alert({ tone: 'error', title: 'Couldn’t delete the event', message: err.response?.data?.message || 'Please try again.' });
    }
  };

  const { user, token } = useAuth();
  const authHeader = { Authorization: `Bearer ${token}` };

  const [activeTab, setActiveTab] = useState('overview');

  // Metrics + overview chart data
  const [metrics, setMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [overview, setOverview] = useState({ transactions: [], events: [] });

  // Tab data
  const [usersData, setUsersData] = useState({ users: [], total: 0 });
  const [eventsData, setEventsData] = useState({ events: [], total: 0 });
  const [txData, setTxData] = useState({ transactions: [], total: 0 });
  const [blockchainLogs, setBlockchainLogs] = useState({ blockchainLogs: [], total: 0 });
  const [fraudAlerts, setFraudAlerts] = useState({ alerts: [], total: 0 });
  const [gateScans, setGateScans] = useState({ scans: [], total: 0 });
  const [auditLogs, setAuditLogs] = useState({ auditLogs: [], total: 0 });

  // Filters & search
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [loadingTab, setLoadingTab] = useState(false);
  const [page, setPage] = useState(1);
  const [tabStats, setTabStats] = useState({});
  const [notice, setNotice] = useState(null);

  // Status change dialog
  const [statusModal, setStatusModal] = useState({ open: false, user: null, targetStatus: '' });
  const [statusReason, setStatusReason] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const getJson = async (path) => {
    const res = await fetch(`${API_URL}${path}`, { headers: authHeader });
    return res.json();
  };

  // 1. Overview metrics
  const fetchMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const json = await getJson('/api/admin/metrics');
      if (json.success) setMetrics(json.data);
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Recent orders (volume chart, payment mix) and the event list (top events)
  const fetchOverview = async () => {
    try {
      const [tx, ev] = await Promise.all([
        getJson('/api/admin/transactions?limit=300'),
        getJson('/api/admin/events?limit=100'),
      ]);
      setOverview({
        transactions: tx.success ? tx.data.transactions : [],
        events: ev.success ? ev.data.events : [],
      });
    } catch (err) {
      console.error('Failed to load overview data:', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchMetrics();
      fetchOverview();
    }
  }, [token]);

  // 2. Active tab data
  const fetchTabData = async (pageArg = page) => {
    setLoadingTab(true);
    try {
      const params = new URLSearchParams({ page: String(pageArg), limit: String(PAGE_SIZE) });
      if (searchTerm) params.append('search', searchTerm);
      if (activeTab === 'users') {
        if (filterRole !== 'ALL') params.append('role', filterRole);
        if (filterStatus !== 'ALL') params.append('status', filterStatus);
        const json = await getJson(`/api/admin/users?${params}`);
        if (json.success) setUsersData(json.data);
      } else if (activeTab === 'events') {
        const json = await getJson(`/api/admin/events?${params}`);
        if (json.success) setEventsData(json.data);
      } else if (activeTab === 'transactions') {
        const json = await getJson(`/api/admin/transactions?${params}`);
        if (json.success) setTxData(json.data);
      } else if (activeTab === 'blockchain') {
        const json = await getJson(`/api/admin/blockchain-logs?${params}`);
        if (json.success) setBlockchainLogs(json.data);
      } else if (activeTab === 'fraud') {
        const json = await getJson(`/api/admin/fraud-alerts?${params}`);
        if (json.success) setFraudAlerts(json.data);
      } else if (activeTab === 'gate') {
        const json = await getJson(`/api/admin/gate-scans?${params}`);
        if (json.success) setGateScans(json.data);
      } else if (activeTab === 'audit') {
        const json = await getJson(`/api/admin/audit-logs?${params}`);
        if (json.success) setAuditLogs(json.data);
      }
    } catch (err) {
      console.error('Failed to load tab data:', err);
    } finally {
      setLoadingTab(false);
    }
  };

  useEffect(() => {
    if (token && activeTab !== 'overview' && activeTab !== 'staff') fetchTabData(page);
  }, [activeTab, filterRole, filterStatus, page, token]);

  // Totals for each tab's stat cards, counted by the API (filtered list totals)
  const countOf = async (path) => {
    try {
      const json = await getJson(path);
      return json.success ? json.data.total ?? 0 : 0;
    } catch {
      return 0;
    }
  };
  const fetchTabStats = async (tab) => {
    if (tab === 'transactions') {
      const [pending, failed] = await Promise.all([countOf('/api/admin/transactions?limit=1&status=PENDING'), countOf('/api/admin/transactions?limit=1&status=FAILED')]);
      setTabStats((prev) => ({ ...prev, transactions: { pending, failed } }));
    } else if (tab === 'blockchain') {
      setTabStats((prev) => ({ ...prev, blockchain: { total: null } }));
      const total = await countOf('/api/admin/blockchain-logs?limit=1');
      setTabStats((prev) => ({ ...prev, blockchain: { total } }));
    } else if (tab === 'fraud') {
      const [total, high] = await Promise.all([countOf('/api/admin/fraud-alerts?limit=1'), countOf('/api/admin/fraud-alerts?limit=1&minScore=75')]);
      setTabStats((prev) => ({ ...prev, fraud: { total, high } }));
    } else if (tab === 'gate') {
      const [valid, duplicate, invalid] = await Promise.all(
        ['VALID_FIRST_SCAN', 'ALREADY_SCANNED', 'INVALID_SCAN'].map((r) => countOf(`/api/admin/gate-scans?limit=1&result=${r}`))
      );
      setTabStats((prev) => ({ ...prev, gate: { valid, duplicate, invalid } }));
    } else if (tab === 'events') {
      const [paused, cancelled] = await Promise.all([countOf('/api/admin/events?limit=1&status=PAUSED'), countOf('/api/admin/events?limit=1&status=CANCELLED')]);
      setTabStats((prev) => ({ ...prev, events: { paused, cancelled } }));
    }
  };
  useEffect(() => {
    if (token && activeTab !== 'overview') fetchTabStats(activeTab);
  }, [activeTab, token]);

  const openTab = (tab, { status } = {}) => {
    setSearchTerm('');
    setPage(1);
    if (status) setFilterStatus(status);
    setActiveTab(tab);
  };
  const runSearch = () => {
    if (page !== 1) setPage(1);
    else fetchTabData(1);
  };

  // Freeze / unfreeze / ban
  const handleUpdateStatusConfirm = async () => {
    if (!statusModal.user || !statusModal.targetStatus) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${statusModal.user.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          status: statusModal.targetStatus,
          reason: statusReason || `Administrative action by ${user.name}`,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setNotice({ tone: 'good', text: json.message });
        setStatusModal({ open: false, user: null, targetStatus: '' });
        setStatusReason('');
        fetchTabData();
        fetchMetrics();
      } else {
        setNotice({ tone: 'bad', text: json.message || 'Failed to update user status' });
      }
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message || 'Network error updating user status' });
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ---------- Overview derivations ----------
  const successful = useMemo(() => overview.transactions.filter((t) => t.status === 'SUCCESSFUL'), [overview.transactions]);
  const volumeByDay = useMemo(
    () => byDay(successful, { days: 14, dateOf: (t) => t.createdAt, pick: (t) => Number(t.totalAmount) || 0 }),
    [successful]
  );
  const ordersTrend = useMemo(() => {
    const series = ['SUCCESSFUL', 'PENDING', 'FAILED'].map((status) =>
      byDay(overview.transactions.filter((t) => t.status === status), { days: 14, dateOf: (t) => t.createdAt, pick: () => 1 })
    );
    return {
      labels: series[0].map((b) => b.label),
      series: [
        { label: 'Successful', color: SERIES[0], values: series[0].map((b) => b.value) },
        { label: 'Pending', color: SERIES[1], values: series[1].map((b) => b.value) },
        { label: 'Failed', color: SERIES[2], values: series[2].map((b) => b.value) },
      ],
    };
  }, [overview.transactions]);
  const paymentMix = useMemo(() => {
    const sums = {};
    successful.forEach((t) => { sums[t.paymentMethod] = (sums[t.paymentMethod] || 0) + Number(t.totalAmount || 0); });
    return Object.keys(PAYMENT_LABELS)
      .filter((k) => sums[k])
      .map((k) => ({ label: PAYMENT_LABELS[k], value: sums[k], color: PAYMENT_COLORS[k] }));
  }, [successful]);
  const topEvents = useMemo(
    () => [...overview.events].sort((a, b) => b.soldTickets - a.soldTickets).slice(0, 5),
    [overview.events]
  );
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return overview.events
      .filter((e) => new Date(e.date) >= today && e.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 4);
  }, [overview.events]);
  const volume14 = volumeByDay.reduce((n, b) => n + b.value, 0);

  const m = metrics || {};
  const users = m.users || {};
  const restricted = (users.suspended || 0) + (users.banned || 0);
  const otherUsers = Math.max(0, (users.total || 0) - (users.active || 0) - restricted);
  const failedOrders = (m.ticketing?.totalOrders || 0) - (m.ticketing?.successfulOrders || 0);
  const dash = (v) => (loadingMetrics && !metrics ? '…' : v ?? 0);

  const refreshAll = () => {
    fetchMetrics();
    fetchOverview();
    if (activeTab !== 'overview' && activeTab !== 'staff') fetchTabData();
  };

  const searchBox = (placeholder) => (
    <form className="tl-dash-search" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
      <Search className="w-4 h-4" aria-hidden="true" />
      <input className="tl-dash-input" type="search" placeholder={placeholder} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} aria-label={placeholder} />
    </form>
  );

  // Pager props from a list response ({ total, totalPages })
  const pagerProps = (data) => ({
    page,
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
    pageSize: PAGE_SIZE,
    loading: loadingTab,
    onPage: (p) => setPage(p),
  });

  const tabLabel = TABS.find((t) => t.value === activeTab)?.label;

  return (
    <div>
      <DashHead
        eyebrow={user?.name || 'Super admin'}
        title={activeTab === 'overview' ? 'Overview' : tabLabel}
        intro={activeTab === 'staff' ? 'Manage event access for your gate team.' : undefined}
        segment={<Segmented label="Console sections" options={TABS} value={activeTab} onChange={(v) => openTab(v)} />}
        actions={
          <>
            <button type="button" className="tl-dash-icon-btn" onClick={refreshAll} aria-label="Refresh data">
              <RefreshCw className={`w-4 h-4 ${loadingMetrics || loadingTab ? 'tl-dash-spin' : ''}`} />
            </button>
            <Link to="/admin/companies" className="tl-dash-btn tl-dash-btn--ink">
              Review approvals{m.companies?.pendingApproval ? ` (${m.companies.pendingApproval})` : ''} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {notice && <Notice tone={notice.tone} icon={notice.tone === 'good' ? CheckCircle2 : AlertTriangle} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

      {/* ================= Overview ================= */}
      {activeTab === 'overview' && (
        <>
          <div className="tl-dash-grid">
            <div className="tl-dash-kpis">
              <Kpi
                label="Users"
                icon={Users}
                color="#16a34a"
                value={dash(users.total)}
                chips={[
                  <Chip key="a" dot="good">{dash(users.active)} active</Chip>,
                  <Chip key="r" dot="warn">{restricted} restricted</Chip>,
                ]}
              />
              <Kpi
                label="Events"
                icon={Calendar}
                color="#2563eb"
                value={dash(m.events?.total)}
                chips={[<Chip key="p" dot="good">{dash(m.events?.published)} published</Chip>, <Chip key="o" dot="neutral">{dash(m.companies?.total)} organizers</Chip>]}
              />
              <Kpi
                label="Orders"
                icon={Tag}
                color="#d97706"
                value={dash(m.ticketing?.successfulOrders)}
                chips={[
                  <Chip key="t" dot="good">{dash(m.ticketing?.totalTickets)} tickets</Chip>,
                  <Chip key="f" dot="warn">{failedOrders} unpaid</Chip>,
                ]}
              />
            </div>

            <DashCard className="tl-dash-side tl-dash-panel tl-dash-panel--icons">
              <span className="tl-dash-panel-tag"><ShieldCheck className="w-4 h-4" aria-hidden="true" /> Governance</span>
              <h2 className="tl-dash-panel-title">Needs your attention.</h2>
              <div className="tl-dash-tiles">
                <Tile icon={Users} title="Organizer approvals" value={dash(m.companies?.pendingApproval)} cta="Review" to="/admin/companies">
                  Check NTN/CNIC documents and approve or reject new event hosts.
                </Tile>
                <Tile icon={AlertTriangle} title="Fraud alerts" cta="Review" onClick={() => openTab('fraud')}>
                  Review bot and scalper risk scores from the anti-scalping model.
                </Tile>
                <Tile icon={Lock} title="Restricted accounts" value={restricted} cta="Review" onClick={() => openTab('users', { status: 'SUSPENDED' })}>
                  Reactivate suspended accounts or confirm bans after review.
                </Tile>
              </div>
            </DashCard>

            <div className="tl-dash-under">
              <DashCard title="Gross volume" icon={BarChart3} onOpen={() => openTab('transactions')} openLabel="Open transactions">
                <Figure value={compactPkr(m.financials?.grossRevenuePkr || 0).replace('PKR ', '')} unit="PKR" size="md" />
                <div className="tl-dash-kpi-foot" style={{ marginBottom: 14 }}>
                  <Chip icon={CreditCard}>{formatPkr(volume14)} in the last 14 days</Chip>
                  <Chip>Fee {formatPkr(m.financials?.platformFeePkr || 0)}</Chip>
                </div>
                <ColumnChart data={volumeByDay} format={(v) => compactPkr(v).replace('PKR ', '')} tipFormat={formatPkr} height={150} label="Paid order volume per day, last 14 days" />
                {paymentMix.length > 0 && <Legend items={paymentMix} format={compactPkr} />}
              </DashCard>
              <DashCard title="Orders" icon={TrendingUp} sub="Per day, last 14 days" onOpen={() => openTab('transactions')} openLabel="Open transactions">
                <LineChart labels={ordersTrend.labels} series={ordersTrend.series} height={244} label="Orders per day by status, last 14 days" />
              </DashCard>
            </div>
          </div>

          <div className="tl-dash-grid">
            <DashCard title="Top events" icon={Star} className="tl-span-8" onOpen={() => openTab('events')} openLabel="Open events directory">
              {topEvents.length === 0 ? (
                <DashState icon={Calendar}>No events yet.</DashState>
              ) : (
                <Table head={['Event', { label: 'Sold', num: true }, 'Fill', 'Status']}>
                  {topEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td>
                        <div className="tl-cell-icon">
                          <EventThumb event={ev} />
                          <div style={{ minWidth: 0 }}>
                            <div className="tl-cell-main">{ev.name}</div>
                            <div className="tl-cell-sub">{ev.city}</div>
                          </div>
                        </div>
                      </td>
                      <td className="is-num">{ev.soldTickets.toLocaleString()}</td>
                      <td><Meter value={ev.occupancyRate} /></td>
                      <td><Status value={ev.status} /></td>
                    </tr>
                  ))}
                </Table>
              )}
            </DashCard>

            <div className="tl-span-4 tl-dash-stack">
              <DashCard title="Ticket turnout" icon={Users} onOpen={() => openTab('gate')} openLabel="Open gate scans">
                <div className="tl-turnout">
                  <Ring value={m.ticketing?.turnoutRate || 0} size={120} stroke={9} label="Tickets scanned at the gate" />
                  <div>
                    <strong>{dash(m.ticketing?.scannedTickets)}</strong>
                    <span>of {dash(m.ticketing?.totalTickets)} tickets scanned</span>
                  </div>
                </div>
              </DashCard>
              <DashCard title="Accounts" icon={Users} onOpen={() => openTab('users')} openLabel="Open users">
                <ArcGauge
                  value={dash(users.total)}
                  caption="Total accounts"
                  parts={[
                    { label: 'Active', value: users.active || 0, color: SERIES[0] },
                    { label: 'Restricted', value: restricted, color: SERIES[2] },
                    { label: 'Unverified', value: otherUsers, color: SERIES[1] },
                  ]}
                />
              </DashCard>
            </div>
          </div>

          {upcomingEvents.length > 0 && (
            <div className="tl-dash-grid">
              <DashCard title="Coming up" icon={Calendar} aside={<span className="tl-dash-card-aside-label">Next events on the platform</span>} className="tl-span-12 tl-coming" onOpen={() => openTab('events')} openLabel="Open events directory">
                <div className="tl-dash-tiles-row">
                  {upcomingEvents.map((ev, i) => (
                    <EventTile key={ev.id} event={ev} index={i} flag={ev.status === 'PUBLISHED' ? 'On sale' : ev.status.replace(/_/g, ' ')} flagTone={ev.status === 'PUBLISHED' ? 'live' : undefined} />
                  ))}
                </div>
              </DashCard>
            </div>
          )}

          <div className="tl-dash-grid">
            <DashCard title="Platform" icon={Settings} aside={<span className="tl-dash-card-aside-label">Network and protection settings</span>} className="tl-span-12">
              <dl className="tl-platform">
                <div><Link2 className="w-5 h-5" aria-hidden="true" /><dt>Blockchain network</dt><dd>Polygon Amoy (80002)</dd></div>
                <div><FileText className="w-5 h-5" aria-hidden="true" /><dt>Ticket standard</dt><dd>ERC-721</dd></div>
                <div><ShieldCheck className="w-5 h-5" aria-hidden="true" /><dt>Resale price cap</dt><dd>110% of face value</dd></div>
                <div><Lock className="w-5 h-5" aria-hidden="true" /><dt>Gate security</dt><dd>HMAC-SHA256 rotating</dd></div>
                <div><BarChart3 className="w-5 h-5" aria-hidden="true" /><dt>Gate scans logged</dt><dd>{dash(m.operations?.totalGateScans)}</dd></div>
                <div><File className="w-5 h-5" aria-hidden="true" /><dt>Audit log entries</dt><dd>{dash(m.operations?.totalAuditLogs)}</dd></div>
              </dl>
            </DashCard>
          </div>
        </>
      )}

      {/* ================= Users ================= */}
      {activeTab === 'users' && (
        <>
          <TabStats
            items={[
              { icon: Users, label: 'Total accounts', value: dash(users.total), tone: 'ink' },
              { icon: User, label: 'Active', value: dash(users.active), tone: 'green' },
              { icon: PauseCircle, label: 'Suspended', value: dash(users.suspended), tone: 'amber' },
              { icon: Ban, label: 'Banned', value: dash(users.banned), tone: 'rose' },
            ]}
          />
          <Directory
            title="User directory"
            sub={`${usersData.total ?? 0} accounts match`}
            noun="accounts"
            {...pagerProps(usersData)}
            toolbar={
              <>
                {searchBox('Search name, email, phone or wallet')}
                <select className="tl-dash-select" value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1); }} aria-label="Role">
                  <option value="ALL">All roles</option>
                  <option value="CUSTOMER">Customers</option>
                  <option value="ORGANIZER">Organizers</option>
                  <option value="GATE_STAFF">Gate staff</option>
                  <option value="SUPER_ADMIN">Super admins</option>
                </select>
                <select className="tl-dash-select" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} aria-label="Status">
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING_VERIFICATION">Unverified</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="BANNED">Banned</option>
                  <option value="DEACTIVATED">Deactivated</option>
                </select>
                <button type="button" className="tl-dash-btn tl-dash-btn--ink" onClick={runSearch}>Search</button>
              </>
            }
          >
            {loadingTab && !usersData.users?.length ? <Loading>Loading users…</Loading> : (
              <Table head={['User', 'Role', 'Status', 'Wallet', { label: 'Orders / tickets', num: true }, { label: 'Actions', right: true }]} empty={!usersData.users?.length && 'No users match these filters.'}>
                {usersData.users?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="tl-dir-who">
                        <Avatar name={u.name} />
                        <div style={{ minWidth: 0 }}>
                          <strong>{u.name}</strong>
                          <span>{u.email}{u.phone ? ` • ${u.phone}` : ''}</span>
                        </div>
                      </div>
                    </td>
                    <td className="is-mono">{u.role.replace(/_/g, ' ')}</td>
                    <td><Status value={u.status} /></td>
                    <td className="is-mono">{u.walletAddress ? `${u.walletAddress.substring(0, 8)}...${u.walletAddress.substring(36)}` : '–'}</td>
                    <td className="is-num is-mono">{u._count?.orders ?? 0} · {u._count?.tickets ?? 0}</td>
                    <td className="is-right">
                      <span className="tl-dir-actions">
                        {u.status !== 'ACTIVE' && (
                          <button type="button" className="tl-dir-btn" onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'ACTIVE' })} title="Reactivate account">
                            <Unlock className="w-3.5 h-3.5" /> Reactivate
                          </button>
                        )}
                        {u.status !== 'SUSPENDED' && (
                          <button type="button" className="tl-dir-btn" onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'SUSPENDED' })} title="Suspend the account and end its sessions">
                            <Lock className="w-3.5 h-3.5" /> Suspend
                          </button>
                        )}
                        {u.status !== 'BANNED' && (
                          <button type="button" className="tl-dir-btn tl-dir-btn--danger" onClick={() => setStatusModal({ open: true, user: u, targetStatus: 'BANNED' })} title="Permanently ban the account">
                            <Ban className="w-3.5 h-3.5" /> Ban
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* ================= Events ================= */}
      {activeTab === 'events' && (
        <>
          <TabStats
            items={[
              { icon: Calendar, label: 'Total events', value: dash(m.events?.total), tone: 'ink' },
              { icon: CheckCircle2, label: 'Published', value: dash(m.events?.published), tone: 'green' },
              { icon: PauseCircle, label: 'Paused', value: tabStats.events?.paused ?? '…', tone: 'amber' },
              { icon: Ban, label: 'Cancelled', value: tabStats.events?.cancelled ?? '…', tone: 'rose' },
            ]}
          />
          <Directory
            title="Event directory"
            sub={`${eventsData.total ?? 0} events match`}
            noun="events"
            {...pagerProps(eventsData)}
            toolbar={<>{searchBox('Search event, venue or city')}<button type="button" className="tl-dash-btn tl-dash-btn--ink" onClick={runSearch}>Search</button></>}
          >
            {loadingTab && !eventsData.events?.length ? <Loading>Loading events…</Loading> : (
              <Table head={['Event', 'Organizer', 'Date', 'Status', { label: 'Sold / capacity', num: true }, 'Fill', { label: 'Actions', right: true }]} empty={!eventsData.events?.length && 'No events found.'}>
                {eventsData.events?.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <div className="tl-dir-who">
                        <EventThumb event={ev} />
                        <div style={{ minWidth: 0 }}>
                          <strong>{ev.name}</strong>
                          <span>{ev.venue}, {ev.city}</span>
                        </div>
                      </div>
                    </td>
                    <td>{ev.company?.companyName || 'Unknown organizer'}</td>
                    <td className="is-mono">{shortDate(ev.date)}</td>
                    <td><Status value={ev.status} /></td>
                    <td className="is-num is-mono">{ev.soldTickets} / {ev.totalCapacity}</td>
                    <td><Meter value={ev.occupancyRate} /></td>
                    <td className="is-right">
                      <span className="tl-dir-actions">
                        <Link to={`/events/${ev.id}`} className="tl-dash-btn">View</Link>
                        <button
                          type="button"
                          className="tl-dash-btn tl-dir-delete"
                          onClick={() => deleteEvent(ev, () => setEventsData((d) => ({ ...d, events: d.events.filter((x) => x.id !== ev.id), total: Math.max(0, (d.total || 1) - 1) })))}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* ================= Transactions ================= */}
      {activeTab === 'transactions' && (
        <>
          <TabStats
            items={[
              { icon: CreditCard, label: 'Total orders', value: dash(m.ticketing?.totalOrders), tone: 'ink' },
              { icon: CheckCircle2, label: 'Successful', value: dash(m.ticketing?.successfulOrders), tone: 'green' },
              { icon: Clock, label: 'Pending', value: tabStats.transactions?.pending ?? '…', tone: 'amber' },
              { icon: XCircle, label: 'Failed', value: tabStats.transactions?.failed ?? '…', tone: 'rose' },
            ]}
          />
          <Directory
            title="Transactions"
            sub={`${txData.total ?? 0} orders match · gross ${formatPkr(m.financials?.grossRevenuePkr || 0)}`}
            noun="orders"
            {...pagerProps(txData)}
            toolbar={<>{searchBox('Search order ID, customer or event')}<button type="button" className="tl-dash-btn tl-dash-btn--ink" onClick={runSearch}>Search</button></>}
          >
            {loadingTab && !txData.transactions?.length ? <Loading>Loading transactions…</Loading> : (
              <Table head={['Customer', 'Order', 'Event', { label: 'Amount', num: true }, 'Status', 'Date']} empty={!txData.transactions?.length && 'No orders found.'}>
                {txData.transactions?.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <div className="tl-dir-who">
                        <Avatar name={tx.user?.name} />
                        <div style={{ minWidth: 0 }}>
                          <strong>{tx.user?.name}</strong>
                          <span>{tx.user?.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="is-mono">{tx.id.substring(0, 12)}…<br /><span className="tl-cell-sub">{PAYMENT_LABELS[tx.paymentMethod] || tx.paymentMethod}</span></td>
                    <td>{tx.event?.name}</td>
                    <td className="is-num is-mono">{formatPkr(tx.totalAmount)}</td>
                    <td><Status value={tx.status} /></td>
                    <td className="is-mono">{shortDate(tx.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* ================= Blockchain ================= */}
      {activeTab === 'blockchain' && (
        <>
          <TabStats
            items={[
              { icon: Layers, label: 'Minted tickets', value: tabStats.blockchain?.total ?? '…', tone: 'ink' },
              { icon: Scan, label: 'Scanned at gate', value: dash(m.ticketing?.scannedTickets), tone: 'green' },
              { icon: TrendingUp, label: 'Turnout', value: `${m.ticketing?.turnoutRate ?? 0}%`, tone: 'blue' },
              { icon: Link2, label: 'Network', value: 'Amoy · 80002', tone: 'ink' },
            ]}
          />
          <Directory
            title="Smart contract log"
            sub={`${blockchainLogs.total ?? 0} tokens · Polygon Amoy`}
            noun="tokens"
            {...pagerProps(blockchainLogs)}
            toolbar={<>{searchBox('Search tx hash, wallet, user or event')}<button type="button" className="tl-dash-btn tl-dash-btn--ink" onClick={runSearch}>Search</button></>}
          >
            {loadingTab && !blockchainLogs.blockchainLogs?.length ? <Loading>Loading on-chain records…</Loading> : (
              <Table head={['Token', 'Event', 'Owner wallet', 'Transaction', { label: 'Transfers', num: true }]} empty={!blockchainLogs.blockchainLogs?.length && 'No minted tickets yet.'}>
                {blockchainLogs.blockchainLogs?.map((log) => (
                  <tr key={log.ticketId}>
                    <td>
                      <div className="tl-dir-who">
                        <span className="tl-av" aria-hidden="true"><Layers className="w-4 h-4" /></span>
                        <div style={{ minWidth: 0 }}>
                          <strong>Token #{log.tokenId || 'minting'}</strong>
                          <span>{log.seatLabel}</span>
                        </div>
                      </div>
                    </td>
                    <td>{log.event?.name}</td>
                    <td className="is-mono">{log.ownerWallet}</td>
                    <td>
                      {log.txHash ? (
                        <a className="tl-dir-link" href={`https://amoy.polygonscan.com/tx/${log.txHash}`} target="_blank" rel="noreferrer">
                          {log.txHash.substring(0, 14)}… <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <Status value="PENDING" label="Pending on-chain" />}
                    </td>
                    <td className="is-num is-mono">{log.transfersCount}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* ================= Fraud ================= */}
      {activeTab === 'fraud' && (
        <>
          <TabStats
            items={[
              { icon: AlertTriangle, label: 'Fraud alerts', value: tabStats.fraud?.total ?? '…', tone: 'ink' },
              { icon: Ban, label: 'High risk (≥ 75)', value: tabStats.fraud?.high ?? '…', tone: 'rose' },
              { icon: Clock, label: 'Lower risk', value: tabStats.fraud ? Math.max(0, tabStats.fraud.total - tabStats.fraud.high) : '…', tone: 'amber' },
              {
                icon: BarChart3,
                label: 'Avg score (this page)',
                value: fraudAlerts.alerts?.length ? Math.round(fraudAlerts.alerts.reduce((n, a) => n + Number(a.fraudScore || 0), 0) / fraudAlerts.alerts.length) : '–',
                tone: 'blue',
              },
            ]}
          />
          <Directory title="Bot & scalper alerts" sub="Real-time risk scoring from the anti-scalping model" noun="alerts" {...pagerProps(fraudAlerts)}>
            {loadingTab && !fraudAlerts.alerts?.length ? <Loading>Loading alerts…</Loading> : (
              <Table head={['Actor', 'Risk', 'Score', 'Factors', 'Time']} empty={!fraudAlerts.alerts?.length && 'No risky sessions flagged.'}>
                {fraudAlerts.alerts?.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <div className="tl-dir-who">
                        <Avatar name={alert.user?.name || 'Guest'} guest={!alert.user} />
                        <div style={{ minWidth: 0 }}>
                          <strong>{alert.user?.name || 'Guest session'}</strong>
                          <span className="is-mono">{alert.ipAddress} · {alert.city}</span>
                        </div>
                      </div>
                    </td>
                    <td><Status value={alert.riskLevel} /></td>
                    <td style={{ minWidth: 120 }}><Meter value={alert.fraudScore} color={alert.fraudScore >= 75 ? '#be123c' : '#d97706'} /></td>
                    <td className="tl-cell-sub">{alert.factors?.join(', ')}</td>
                    <td className="is-mono">{shortTime(alert.timestamp)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* ================= Gate scans ================= */}
      {activeTab === 'gate' && (
        <>
          <TabStats
            items={[
              { icon: Scan, label: 'Total scans', value: dash(m.operations?.totalGateScans), tone: 'ink' },
              { icon: CheckCircle2, label: 'Admitted', value: tabStats.gate?.valid ?? '…', tone: 'green' },
              { icon: Clock, label: 'Double entry blocked', value: tabStats.gate?.duplicate ?? '…', tone: 'amber' },
              { icon: XCircle, label: 'Invalid passes', value: tabStats.gate?.invalid ?? '…', tone: 'rose' },
            ]}
          />
          <Directory title="Turnstile scans" sub="Database and on-chain verification" noun="scans" {...pagerProps(gateScans)}>
            {loadingTab && !gateScans.scans?.length ? <Loading>Loading scans…</Loading> : (
              <Table head={['Attendee', 'Result', 'Gate', 'Event', 'Staff', 'Time']} empty={!gateScans.scans?.length && 'No gate scans yet.'}>
                {gateScans.scans?.map((sc) => (
                  <tr key={sc.id}>
                    <td>
                      <div className="tl-dir-who">
                        <Avatar name={sc.ticket?.user?.name || 'Attendee'} />
                        <strong>{sc.ticket?.user?.name || 'Attendee'}</strong>
                      </div>
                    </td>
                    <td><Status value={sc.result} /></td>
                    <td className="is-mono">{sc.gateNumber || 'Gate 1'}</td>
                    <td>{sc.ticket?.event?.name}</td>
                    <td>{sc.staff?.name || 'Staff'}</td>
                    <td className="is-mono">{shortTime(sc.scanTime)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {activeTab === 'staff' && <StaffManager layout="full" />}

      {/* ================= Audit ================= */}
      {activeTab === 'audit' && (
        <>
          <TabStats
            items={[
              { icon: FileText, label: 'Audit entries', value: auditLogs.total ?? '…', tone: 'ink' },
              { icon: Layers, label: 'On this page', value: auditLogs.auditLogs?.length ?? 0, tone: 'blue' },
              { icon: Users, label: 'Actors on this page', value: new Set((auditLogs.auditLogs || []).map((l) => l.user?.name || 'System')).size, tone: 'green' },
              { icon: Clock, label: 'Latest entry', value: auditLogs.auditLogs?.[0] ? shortTime(auditLogs.auditLogs[0].createdAt) : '–', tone: 'ink' },
            ]}
          />
          <Directory
            title="Audit trail"
            sub="Security and administrative actions"
            noun="entries"
            {...pagerProps(auditLogs)}
            toolbar={<>{searchBox('Search action or target')}<button type="button" className="tl-dash-btn tl-dash-btn--ink" onClick={runSearch}>Search</button></>}
          >
            {loadingTab && !auditLogs.auditLogs?.length ? <Loading>Loading audit log…</Loading> : (
              <Table head={['Actor', 'Action', 'Target', 'Details', 'Time']} empty={!auditLogs.auditLogs?.length && 'No audit entries.'}>
                {auditLogs.auditLogs?.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <div className="tl-dir-who">
                        <Avatar name={log.user?.name || 'System'} />
                        <strong>{log.user?.name || 'System'}</strong>
                      </div>
                    </td>
                    <td className="is-mono tl-cell-main">{log.action}</td>
                    <td className="tl-cell-sub">{log.targetType}: {log.targetId?.substring(0, 10)}…</td>
                    <td className="is-mono tl-cell-sub" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{JSON.stringify(log.details)}</td>
                    <td className="is-mono">{shortTime(log.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Directory>
        </>
      )}

      {/* Status change dialog */}
      {statusModal.open && (
        <div className="tl-dash-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setStatusModal({ open: false, user: null, targetStatus: '' })}>
          <div className="tl-dash-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-status-title">
            <h3 id="tl-status-title">
              {statusModal.targetStatus === 'BANNED' ? 'Ban account' : statusModal.targetStatus === 'SUSPENDED' ? 'Suspend account' : 'Reactivate account'}
            </h3>
            <p>{statusModal.user?.name} · {statusModal.user?.email}</p>
            <label htmlFor="tl-status-reason">Reason for the audit log</label>
            <textarea
              id="tl-status-reason"
              rows={3}
              className="tl-dash-textarea"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Why is this change being made?"
            />
            <div className="tl-dash-dialog-actions">
              <button type="button" className="tl-dash-btn" onClick={() => setStatusModal({ open: false, user: null, targetStatus: '' })}>Cancel</button>
              <button
                type="button"
                className={`tl-dash-btn ${statusModal.targetStatus === 'ACTIVE' ? 'tl-dash-btn--green' : statusModal.targetStatus === 'BANNED' ? 'tl-dash-btn--danger' : 'tl-dash-btn--ink'}`}
                onClick={handleUpdateStatusConfirm}
                disabled={updatingStatus}
              >
                {updatingStatus ? 'Updating…' : statusModal.targetStatus === 'BANNED' ? 'Ban account' : statusModal.targetStatus === 'SUSPENDED' ? 'Suspend account' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
