import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Bell,
  Check,
  CheckCheck,
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
  ExternalLink
} from 'lucide-react';

const getNotificationIcon = (type) => {
  switch (type) {
    case 'BOOKING_CONFIRMATION':
      return <Ticket className="w-4 h-4 text-emerald-400" />;
    case 'PAYMENT_CONFIRMATION':
      return <CreditCard className="w-4 h-4 text-teal-400" />;
    case 'TICKET_ISSUED':
      return <Sparkles className="w-4 h-4 text-purple-400" />;
    case 'EVENT_REMINDER':
      return <Clock className="w-4 h-4 text-amber-400" />;
    case 'TICKET_TRANSFERRED':
      return <ArrowRightLeft className="w-4 h-4 text-blue-400" />;
    case 'RESALE_AVAILABLE':
      return <Tag className="w-4 h-4 text-emerald-300" />;
    case 'ORGANIZER_APPROVAL':
      return <ShieldCheck className="w-4 h-4 text-teal-300" />;
    case 'ORGANIZER_REJECTION':
      return <XCircle className="w-4 h-4 text-rose-400" />;
    case 'FRAUD_ALERT':
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    case 'ABANDONED_CHECKOUT_REMINDER':
      return <ShoppingCart className="w-4 h-4 text-amber-300" />;
    default:
      return <Bell className="w-4 h-4 text-slate-400" />;
  }
};

const formatTimeAgo = (dateStr) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
};

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastAlert, setToastAlert] = useState(null);
  const dropdownRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const res = await api.get('/notifications?limit=6');
      if (res.data.success) {
        setNotifications(res.data.data.notifications || []);
        setUnreadCount(res.data.data.unreadCount || 0);
      }
    } catch (err) {
      console.warn('Failed to fetch notifications:', err.message);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchNotifications();

    // Socket.io Real-Time Connection
    const socket = io(import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000', {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('join_user_room', user.id);
    });

    const handleNewNotification = (notification) => {
      setNotifications((prev) => [notification, ...prev.slice(0, 5)]);
      setUnreadCount((prev) => prev + 1);

      // Show toast alert
      setToastAlert(notification);
      setTimeout(() => {
        setToastAlert(null);
      }, 5000);
    };

    socket.on('notification', handleNewNotification);
    socket.on(`notification_${user.id}`, handleNewNotification);

    return () => {
      socket.disconnect();
    };
  }, [user]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id, e) => {
    if (e) e.stopPropagation();
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

  const handleNotificationClick = (item) => {
    if (!item.isRead) {
      handleMarkAsRead(item.id);
    }
    setIsOpen(false);

    if (item.type.includes('TICKET') || item.type.includes('TRANSFER')) {
      navigate('/wallet');
    } else if (item.type.includes('BOOKING') || item.type.includes('PAYMENT')) {
      navigate('/my-bookings');
    } else if (item.type.includes('RESALE')) {
      navigate('/resale');
    } else if (item.type.includes('ORGANIZER')) {
      navigate('/company');
    } else {
      navigate('/notifications');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Toast Alert Popup */}
      {toastAlert && (
        <div className="fixed top-20 right-6 z-50 max-w-sm w-full bg-slate-900 border border-emerald-500/50 rounded-xl shadow-2xl p-4 animate-in slide-in-from-top duration-300">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 shrink-0">
              {getNotificationIcon(toastAlert.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-emerald-400 flex items-center justify-between">
                <span>NEW ALERT</span>
                <button
                  onClick={() => setToastAlert(null)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm font-semibold text-white truncate mt-0.5">{toastAlert.title}</p>
              <p className="text-xs text-slate-300 line-clamp-2 mt-1">{toastAlert.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 transition flex items-center justify-center focus:outline-none"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-md shadow-rose-500/50 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 font-medium transition"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-800/60">
            {notifications.length === 0 ? (
              <div className="py-10 text-center px-4">
                <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No notifications yet</p>
                <p className="text-xs text-slate-500 mt-1">
                  You will receive real-time alerts for bookings, transfers, and fraud alerts.
                </p>
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`p-3.5 hover:bg-slate-800/60 cursor-pointer transition flex items-start gap-3 ${!item.isRead ? 'bg-slate-800/30' : ''
                    }`}
                >
                  <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/60 shrink-0 mt-0.5">
                    {getNotificationIcon(item.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs font-semibold truncate ${!item.isRead ? 'text-white' : 'text-slate-300'}`}>
                        {item.title}
                      </p>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {formatTimeAgo(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                  {!item.isRead && (
                    <button
                      onClick={(e) => handleMarkAsRead(item.id, e)}
                      title="Mark as read"
                      className="p-1 text-slate-500 hover:text-emerald-400 shrink-0 mt-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-slate-800 bg-slate-950/80 text-center">
            <Link
              to="/notifications"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition py-1"
            >
              <span>View Full Notification Center</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
