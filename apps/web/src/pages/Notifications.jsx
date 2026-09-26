import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
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

  const getIcon = (type) => {
    switch (type) {
      case 'BOOKING_CONFIRMATION':
        return <Ticket className="w-5 h-5 text-emerald-400" />;
      case 'PAYMENT_CONFIRMATION':
        return <CreditCard className="w-5 h-5 text-teal-400" />;
      case 'TICKET_ISSUED':
        return <Sparkles className="w-5 h-5 text-purple-400" />;
      case 'EVENT_REMINDER':
        return <Clock className="w-5 h-5 text-amber-400" />;
      case 'TICKET_TRANSFERRED':
        return <ArrowRightLeft className="w-5 h-5 text-blue-400" />;
      case 'RESALE_AVAILABLE':
        return <Tag className="w-5 h-5 text-emerald-300" />;
      case 'ORGANIZER_APPROVAL':
        return <ShieldCheck className="w-5 h-5 text-teal-300" />;
      case 'ORGANIZER_REJECTION':
        return <XCircle className="w-5 h-5 text-rose-400" />;
      case 'FRAUD_ALERT':
        return <AlertTriangle className="w-5 h-5 text-rose-400" />;
      case 'ABANDONED_CHECKOUT_REMINDER':
        return <ShoppingCart className="w-5 h-5 text-amber-300" />;
      default:
        return <Bell className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <Bell className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">Notification Center</h1>
              <p className="text-sm text-slate-400">
                Multi-channel notifications via In-App, Nodemailer Email, FCM Push, and Real-Time WebSockets
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
            >
              <CheckCheck className="w-4 h-4 text-emerald-400" />
              <span>Mark All Read</span>
            </button>
          )}

          <button
            onClick={fetchNotifications}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Multi-Channel Protocol Architecture Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Database Feed</div>
            <div className="text-sm font-bold text-white">In-App Alerts</div>
            <div className="text-[10px] text-emerald-400">Prisma Persistent Storage</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Email Gateway</div>
            <div className="text-sm font-bold text-white">Nodemailer HTML</div>
            <div className="text-[10px] text-blue-400">Styled Dark Theme Receipts</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Push Notifications</div>
            <div className="text-sm font-bold text-white">Firebase FCM</div>
            <div className="text-[10px] text-amber-400">Mobile & Device Tokens</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Real-Time Channel</div>
            <div className="text-sm font-bold text-white">Socket.io</div>
            <div className="text-[10px] text-purple-400">Targeted User Rooms</div>
          </div>
        </div>
      </div>

      {/* Simulator Section (Module 12 Demonstration) */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-emerald-500/30 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
              <Send className="w-4 h-4" /> Multi-Channel Notification Simulator
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Simulate any of the 9 required FYP notification events across In-app, Nodemailer, FCM, and Socket.io
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`http://localhost:5000/api/notifications/preview-email?type=${selectedType}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition"
              title="Open full rendered Nodemailer HTML email in browser"
            >
              <Mail className="w-3.5 h-3.5 text-blue-400" />
              <span>Preview HTML Email</span>
            </a>

            <button
              onClick={handleSimulateNotification}
              disabled={simulating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Dispatch Test Notification</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {NOTIFICATION_TYPES_LIST.map((t) => (
            <button
              key={t.value}
              onClick={() => setSelectedType(t.value)}
              className={`p-2.5 rounded-xl border text-left text-xs transition ${
                selectedType === t.value
                  ? 'bg-emerald-950/60 border-emerald-500 text-white font-semibold shadow-sm'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
              }`}
            >
              <t.icon className={`w-3.5 h-3.5 mb-1.5 ${t.color}`} />
              <div className="truncate text-[11px]">{t.label}</div>
            </button>
          ))}
        </div>

        {simFeedback && (
          <div className={`mt-3 p-3 rounded-xl text-xs font-semibold ${
            simFeedback.success ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800' : 'bg-rose-950/60 text-rose-300 border border-rose-800'
          }`}>
            {simFeedback.message}
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {[
          { id: 'ALL', label: `All (${total})` },
          { id: 'UNREAD', label: `Unread (${unreadCount})` },
          { id: 'BOOKINGS', label: 'Bookings & Payments' },
          { id: 'TRANSFERS', label: 'NFTs & Transfers' },
          { id: 'SECURITY', label: 'Security & Approvals' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-slate-950 shadow-md shadow-emerald-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-16 text-center text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-slate-600" />
            <p className="text-sm">Loading notification feed...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-16 text-center bg-slate-900/50 rounded-2xl border border-slate-800/80">
            <Bell className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white">No notifications in this view</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              You are all caught up! Use the test dispatcher above to simulate notifications.
            </p>
          </div>
        ) : (
          filteredNotifications.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition flex items-start gap-4 ${
                !item.isRead
                  ? 'bg-slate-900/90 border-emerald-500/30 shadow-lg shadow-emerald-950/20'
                  : 'bg-slate-900/40 border-slate-800/80 opacity-80'
              }`}
            >
              <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700/60 shrink-0 mt-0.5">
                {getIcon(item.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{item.title}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                      {item.type.replace(/_/g, ' ')}
                    </span>
                    {!item.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 font-mono">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>

                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {item.message}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!item.isRead && (
                  <button
                    onClick={() => handleMarkAsRead(item.id)}
                    title="Mark read"
                    className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(item.id)}
                  title="Delete"
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
