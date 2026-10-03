import React, { useState, useEffect } from 'react';
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
  Smartphone
} from 'lucide-react';

const NOTIFICATION_TYPES_LIST = [
  { value: 'BOOKING_CONFIRMATION', label: 'Booking Confirmation', icon: Ticket, color: 'text-emerald-400' },
  { value: 'PAYMENT_CONFIRMATION', label: 'Payment Confirmation', icon: CreditCard, color: 'text-teal-400' },
  { value: 'TICKET_ISSUED', label: 'Ticket Issued (NFT Ready)', icon: Sparkles, color: 'text-purple-400' },
  { value: 'EVENT_REMINDER', label: 'Event Reminder', icon: Clock, color: 'text-amber-400' },
  { value: 'TICKET_TRANSFERRED', label: 'Ticket Transferred', icon: ArrowRightLeft, color: 'text-blue-400' },
  { value: 'RESALE_AVAILABLE', label: 'Resale Available (Waitlist)', icon: Tag, color: 'text-emerald-300' },
  { value: 'ORGANIZER_APPROVAL', label: 'Organizer Approved', icon: ShieldCheck, color: 'text-teal-300' },
  { value: 'ORGANIZER_REJECTION', label: 'Organizer Rejection', icon: XCircle, color: 'text-rose-400' },
  { value: 'FRAUD_ALERT', label: 'Fraud / Bot Security Alert', icon: AlertTriangle, color: 'text-rose-400' },
  { value: 'ABANDONED_CHECKOUT_REMINDER', label: 'Abandoned Checkout Reminder', icon: ShoppingCart, color: 'text-amber-300' },
];

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL'); // ALL, UNREAD, BOOKINGS, SECURITY, TRANSFERS

  // Simulator State
  const [selectedType, setSelectedType] = useState('BOOKING_CONFIRMATION');
  const [simulating, setSimulating] = useState(false);
  const [simFeedback, setSimFeedback] = useState(null);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await api.get('/notifications?limit=50');
      if (res.data.success) {
        setNotifications(res.data.data.notifications || []);
        setTotal(res.data.data.total || 0);
        setUnreadCount(res.data.data.unreadCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

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
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
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
        await fetchNotifications();
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

  // Filter items
  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'UNREAD') return !n.isRead;
    if (activeTab === 'BOOKINGS') return n.type.includes('BOOKING') || n.type.includes('PAYMENT');
    if (activeTab === 'TRANSFERS') return n.type.includes('TRANSFER') || n.type.includes('RESALE') || n.type.includes('TICKET');
    if (activeTab === 'SECURITY') return n.type.includes('FRAUD') || n.type.includes('ORGANIZER') || n.type.includes('ABANDONED');
    return true;
  });

  // Icon per type; the colour comes from the row's tone group (see basic.css)
  const getIcon = (type) => {
    const Icon = NOTIFICATION_TYPES_LIST.find((t) => t.value === type)?.icon || Bell;
    return <Icon className="w-5 h-5" aria-hidden="true" />;
  };
  const toneOf = (type = '') => {
    if (type.includes('FRAUD') || type.includes('REJECTION')) return 'security';
    if (type.includes('REMINDER')) return 'reminder';
    if (type.includes('TRANSFER')) return 'transfer';
    if (type.includes('ISSUED')) return 'nft';
    return 'default';
  };

  const TABS = [
    { id: 'ALL', label: `All (${total})` },
    { id: 'UNREAD', label: `Unread (${unreadCount})` },
    { id: 'BOOKINGS', label: 'Bookings & Payments' },
    { id: 'TRANSFERS', label: 'NFTs & Transfers' },
    { id: 'SECURITY', label: 'Security & Approvals' },
  ];

  return (
    <BasicShell
      eyebrow="Your account"
      title="Notifications"
      intro={loading ? 'Loading your notification feed…' : `${unreadCount} unread of ${total}. Delivered in-app, by email, by push and in real time.`}
      actions={
        <>
          {unreadCount > 0 && (
            <button type="button" onClick={handleMarkAllRead} className="tl-btn tl-btn--green">
              <CheckCheck className="w-4 h-4" aria-hidden="true" /> Mark all read
            </button>
          )}
          <button type="button" onClick={fetchNotifications} className="tl-basic-icon-btn" title="Refresh" aria-label="Refresh notifications">
            <RefreshCw className={`w-4 h-4 ${loading ? 'tl-nt-spin' : ''}`} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="tl-nt">
        <section aria-label="Notification feed">
          <div className="tl-nt-tabs" role="group" aria-label="Filter notifications">
            {TABS.map((tab) => (
              <button key={tab.id} type="button" className="tl-nt-tab" aria-pressed={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
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
        </section>

        <aside className="tl-nt-side">
          {/* Simulator (Module 12 demonstration) */}
          <div className="tl-basic-card tl-nt-panel">
            <p className="tl-basic-label">Test dispatcher</p>
            <h2 style={{ marginTop: 8 }}>Send a test notification</h2>
            <p>Pick an event type and dispatch it across in-app, email, push and Socket.io.</p>
            <div className="tl-nt-types" role="group" aria-label="Notification type">
              {NOTIFICATION_TYPES_LIST.map((t) => (
                <button key={t.value} type="button" className="tl-nt-type-opt" aria-pressed={selectedType === t.value} onClick={() => setSelectedType(t.value)}>
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
