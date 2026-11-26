import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import BasicShell from '../components/basic/BasicShell';
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  Filter,
  Send,
  Ticket,
  CreditCard,
  Sparkles,
  Clock,
  ArrowRightLeft,
  Tag,
  ShieldCheck,
  AlertTriangle,
  ShoppingCart,
  XCircle,
  RefreshCw,
  Mail,
  Smartphone,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const PAGE_SIZE = 15;

const NOTIFICATION_TYPES_LIST = [
  { value: 'BOOKING_CONFIRMATION', label: 'Booking Confirmation', icon: Ticket, tone: 'default' },
  { value: 'PAYMENT_CONFIRMATION', label: 'Payment Confirmation', icon: CreditCard, tone: 'security' },
  { value: 'TICKET_ISSUED', label: 'Ticket Issued (NFT Ready)', icon: Sparkles, tone: 'reminder' },
  { value: 'EVENT_REMINDER', label: 'Event Reminder', icon: Clock, tone: 'reminder' },
  { value: 'TICKET_TRANSFERRED', label: 'Ticket Transferred', icon: ArrowRightLeft, tone: 'transfer' },
  { value: 'RESALE_AVAILABLE', label: 'Resale Available (Waitlist)', icon: Tag, tone: 'transfer' },
  { value: 'ORGANIZER_APPROVAL', label: 'Organizer Approved', icon: ShieldCheck, tone: 'default' },
  { value: 'ORGANIZER_REJECTION', label: 'Organizer Rejection', icon: XCircle, tone: 'security' },
  { value: 'FRAUD_ALERT', label: 'Fraud / Bot Security Alert', icon: AlertTriangle, tone: 'security' },
  { value: 'ABANDONED_CHECKOUT_REMINDER', label: 'Abandoned Checkout Reminder', icon: ShoppingCart, tone: 'transfer' },
];

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0); // in the current tab
  const [allTotal, setAllTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL'); // ALL, UNREAD, BOOKINGS, SECURITY, TRANSFERS

  // Simulator State
  const [selectedType, setSelectedType] = useState('BOOKING_CONFIRMATION');
  const [simulating, setSimulating] = useState(false);
  const [simFeedback, setSimFeedback] = useState(null);

  // One page of 15 for the current tab (the server filters, so every tab pages through all its items)
  const fetchNotifications = async (pageArg = page, tab = activeTab) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(pageArg) });
      if (tab !== 'ALL') params.set('filter', tab);
      const res = await api.get(`/notifications?${params}`);
      if (res.data.success) {
        const d = res.data.data;
        // A page emptied by deletes: step back one page
        if (!(d.notifications || []).length && pageArg > 1) {
          setPage(pageArg - 1);
          return;
        }
        setNotifications(d.notifications || []);
        setTotal(d.total || 0);
        setAllTotal(d.allTotal ?? d.total ?? 0);
        setTotalPages(d.totalPages || Math.max(1, Math.ceil((d.total || 0) / PAGE_SIZE)));
        setUnreadCount(d.unreadCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications(page, activeTab);
  }, [page, activeTab]);

  const handleMarkAsRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      // Reload the page so the next notification moves up into the free slot
      await fetchNotifications(page, activeTab);
    } catch (err) {
      console.error(err);
    }
  };

  // Test Notification Dispatcher
  const handleSimulateNotification = async () => {
    try {
      setSimulating(true);
      setSimFeedback(null);

      const res = await api.post('/notifications/test', {
        type: selectedType,
        title: `Simulated Alert: ${selectedType.replace(/_/g, ' ')}`,
        message: `This is a test notification generated on ${new Date().toLocaleTimeString()} to verify In-app, Nodemailer Email, FCM push, and Socket.io.`,
        data: {
          timestamp: new Date().toISOString(),
          environment: 'TicketLedger FYP Phase 2',
        },
      });

      if (res.data.success) {
        setSimFeedback({
          success: true,
          message: `Dispatched ${selectedType} across In-App, Email, and Push!`,
        });
        if (page !== 1) setPage(1);
        else await fetchNotifications(1, activeTab);
      }
    } catch (err) {
      setSimFeedback({
        success: false,
        message: err.response?.data?.message || err.message,
      });
    } finally {
      setSimulating(false);
    }
  };

  // The server already filtered this page by tab
  const filteredNotifications = notifications;
  const openTab = (id) => {
    setActiveTab(id);
    setPage(1);
  };

  // Icon per type; the colour comes from the row's tone group (see basic.css)
  const getIcon = (type) => {
    const Icon = NOTIFICATION_TYPES_LIST.find((t) => t.value === type)?.icon || Bell;
    return <Icon className="w-5 h-5" aria-hidden="true" />;
  };
  const toneOf = (type = '') => {
    if (type.includes('FRAUD') || type.includes('REJECTION') || type.includes('ABANDONED')) return 'security';
    if (type.includes('REMINDER')) return 'reminder';
    if (type.includes('TRANSFER')) return 'transfer';
    if (type.includes('ISSUED')) return 'nft';
    return 'default';
  };

  const TABS = [
    { id: 'ALL', label: `All (${allTotal})` },
    { id: 'UNREAD', label: `Unread (${unreadCount})` },
    { id: 'BOOKINGS', label: 'Bookings & Payments' },
    { id: 'TRANSFERS', label: 'NFTs & Transfers' },
    { id: 'SECURITY', label: 'Security & Approvals' },
  ];

  return (
    <BasicShell
      theme="dark"
      eyebrow="Your account"
      title="Notifications"
      intro={loading ? 'Loading your notification feed…' : `${unreadCount} unread of ${allTotal}. Delivered in-app, by email, by push and in real time.`}
      actions={
        <>
          {unreadCount > 0 && (
            <button type="button" onClick={handleMarkAllRead} className="tl-btn tl-btn--green">
              <CheckCheck className="w-4 h-4" aria-hidden="true" /> Mark all read
            </button>
          )}
          <button type="button" onClick={() => fetchNotifications(page, activeTab)} className="tl-basic-icon-btn" title="Refresh" aria-label="Refresh notifications">
            <RefreshCw className={`w-4 h-4 ${loading ? 'tl-nt-spin' : ''}`} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="tl-nt">
        <section aria-label="Notification feed">
          <div className="tl-nt-tabs" role="group" aria-label="Filter notifications">
            {TABS.map((tab) => (
              <button key={tab.id} type="button" className="tl-nt-tab" aria-pressed={activeTab === tab.id} onClick={() => openTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="tl-nt-state" aria-busy="true">
              <RefreshCw className="w-8 h-8 tl-nt-spin" aria-hidden="true" />
              <p>Loading notification feed...</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="tl-nt-state">
              <Bell className="w-9 h-9" aria-hidden="true" />
              <h3>No notifications in this view</h3>
              <p>You are all caught up! Use the test dispatcher to simulate notifications.</p>
            </div>
          ) : (
            <ul className="tl-nt-list">
              {filteredNotifications.map((item) => (
                <li key={item.id} className={`tl-nt-item${item.isRead ? '' : ' is-unread'}`} data-tone={toneOf(item.type)}>
                  <span className="tl-nt-icon">{getIcon(item.type)}</span>
                  <div>
                    <div className="tl-nt-top">
                      <span className="tl-nt-title">{item.title}</span>
                      <span className="tl-nt-type">{item.type.replace(/_/g, ' ')}</span>
                      {!item.isRead && <span className="tl-nt-new">New</span>}
                    </div>
                    <p className="tl-nt-msg">{item.message}</p>
                    {item.link && (
                      <Link to={item.link} className="tl-nt-link" onClick={() => !item.isRead && handleMarkAsRead(item.id)}>Open →</Link>
                    )}
                    <time className="tl-nt-time" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                  </div>
                  <div className="tl-nt-actions">
                    {!item.isRead && (
                      <button type="button" onClick={() => handleMarkAsRead(item.id)} title="Mark read" aria-label={`Mark "${item.title}" as read`} className="tl-basic-icon-btn">
                        <Check className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                    <button type="button" onClick={() => handleDelete(item.id)} title="Delete" aria-label={`Delete "${item.title}"`} className="tl-basic-icon-btn tl-nt-delete">
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {total > PAGE_SIZE && (
            <nav className="tl-nt-pager" aria-label="Notification pages">
              <p>Showing <strong>{(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)}</strong> of <strong>{total}</strong></p>
              <div>
                <button type="button" className="tl-nt-pg" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous 15
                </button>
                <span>Page {page} of {totalPages}</span>
                <button type="button" className="tl-nt-pg is-next" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
                  Next 15 <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </section>

        <aside className="tl-nt-side">
          {/* Simulator (Module 12 demonstration) */}
          <div className="tl-basic-card tl-nt-panel">
            <p className="tl-basic-label tl-nt-badge">Test dispatcher</p>
            <h2 style={{ marginTop: 12 }}>Send a test notification</h2>
            <p>Pick an event type and dispatch it across in-app, email, push and Socket.io.</p>
            <div className="tl-nt-types" role="group" aria-label="Notification type">
              {NOTIFICATION_TYPES_LIST.map((t) => (
                <button key={t.value} type="button" className="tl-nt-type-opt" data-tone={t.tone} aria-pressed={selectedType === t.value} onClick={() => setSelectedType(t.value)}>
                  <t.icon className="w-4 h-4" aria-hidden="true" />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="tl-nt-panel-actions">
              <button type="button" onClick={handleSimulateNotification} disabled={simulating} className="tl-btn tl-btn--green">
                {simulating ? <RefreshCw className="w-4 h-4 tl-nt-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                Dispatch test
              </button>
              <a
                href={`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/notifications/preview-email?type=${selectedType}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tl-btn tl-btn--ghost"
                title="Open full rendered Nodemailer HTML email in browser"
              >
                <Mail className="w-4 h-4" aria-hidden="true" /> Preview HTML email
              </a>
            </div>
            {simFeedback && (
              <p className={`tl-nt-feedback ${simFeedback.success ? 'is-ok' : 'is-err'}`} role="status">{simFeedback.message}</p>
            )}
          </div>


        </aside>
      </div>
    </BasicShell>
  );
}
