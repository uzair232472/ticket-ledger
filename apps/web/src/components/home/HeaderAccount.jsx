import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, UserRound, ArrowRight } from 'lucide-react';
import api from '../../utils/api';
import { TicketBellIcon, TicketUserIcon, TicketCartIcon } from './HeaderIcons';
import { useCartHolds } from '../../hooks/useCartHolds';

const timeAgo = (date) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * Signed-in header icons: notifications (latest three + "View all") and account (profile / log out).
 * `menuOpen` closes both popovers when the site menu opens; `onOpen` lets the header close its menu.
 */
export default function HeaderAccount({ menuOpen, onOpen, onLogout }) {
  const location = useLocation();
  const [which, setWhich] = useState(null); // 'notifications' | 'account' | null
  const [latest, setLatest] = useState(null); // null while loading
  const [unread, setUnread] = useState(0);
  const rootRef = useRef(null);
  const { holds, first, totalCount, secondsLeft, releaseAll } = useCartHolds();

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications?limit=3');
      setLatest(res.data?.data?.notifications || []);
      setUnread(res.data?.data?.unreadCount || 0);
    } catch {
      setLatest((l) => l || []);
    }
  }, []);

  // Unread badge: on load, on every page change and once a minute
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications, location.pathname]);
  useEffect(() => {
    const id = setInterval(loadNotifications, 60000);
    return () => clearInterval(id);
  }, [loadNotifications]);

  useEffect(() => {
    if (menuOpen) setWhich(null);
  }, [menuOpen]);
  useEffect(() => setWhich(null), [location.pathname]);

  // Outside click and Escape close the open popover
  useEffect(() => {
    if (!which) return undefined;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setWhich(null);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const button = rootRef.current?.querySelector(`[data-pop="${which}"]`);
      setWhich(null);
      button?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [which]);

  const toggle = (name) => {
    if (which === name) return setWhich(null);
    onOpen?.();
    if (name === 'notifications') loadNotifications();
    setWhich(name);
  };

  return (
    <div ref={rootRef} className="tl-hacc">
      {/* Ticket Cart Button & Popover when seats are held */}
      {totalCount > 0 && first && secondsLeft > 0 && (
        <div className="tl-hacc-item">
          <button
            type="button"
            className="tl-hacc-btn"
            data-pop="cart"
            aria-expanded={which === 'cart'}
            aria-controls="tl-hacc-cart"
            aria-label={`Cart: ${totalCount} tickets reserved`}
            onClick={() => toggle('cart')}
          >
            <TicketCartIcon className="tl-hacc-icon" />
            <span className="tl-hacc-dot" aria-hidden="true">{totalCount}</span>
          </button>
          {which === 'cart' && (
            <div id="tl-hacc-cart" className="tl-hacc-pop tl-hacc-pop--wide" role="region" aria-label="Ticket Cart">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: 8, marginBottom: 10 }}>
                <p className="tl-hacc-title" style={{ margin: 0, fontWeight: 700 }}>Your Ticket Cart</p>
                {secondsLeft != null && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,0.18)', padding: '2px 8px', borderRadius: 999 }}>
                    ⏱ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {holds.map((h) => (
                  <div key={h.eventId} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={{ fontWeight: 700, fontSize: 12, margin: 0, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.eventName}</p>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', margin: '2px 0 8px 0' }}>
                      {h.count} seat{h.count === 1 ? '' : 's'} held{h.totalPrice > 0 ? ` · Rs. ${h.totalPrice.toLocaleString()}` : ''}
                    </p>
                    <Link
                      to={`/events/${h.eventId}/checkout`}
                      onClick={() => setWhich(null)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#16a34a', color: '#fff', padding: '8px 12px', borderRadius: 10, fontWeight: 700, fontSize: 12, textDecoration: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
                    >
                      <span>Complete booking</span>
                      <ArrowRight style={{ width: 14, height: 14 }} />
                    </Link>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 8 }}>
                      <Link to={`/events/${h.eventId}/seats`} onClick={() => setWhich(null)} style={{ color: 'rgba(255,255,255,0.85)', textDecoration: 'underline' }}>
                        Change seats
                      </Link>
                      <button type="button" onClick={() => releaseAll(h.eventId, h.keys)} style={{ color: '#f87171', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                        Release
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="tl-hacc-item">
        <button
          type="button"
          className="tl-hacc-btn"
          data-pop="notifications"
          aria-expanded={which === 'notifications'}
          aria-controls="tl-hacc-notifications"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          onClick={() => toggle('notifications')}
        >
          <TicketBellIcon className="tl-hacc-icon" />
          {unread > 0 && <span className="tl-hacc-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {which === 'notifications' && (
          <div id="tl-hacc-notifications" className="tl-hacc-pop tl-hacc-pop--wide" role="region" aria-label="Latest notifications">
            <p className="tl-hacc-title">Notifications</p>
            {latest === null ? (
              <p className="tl-hacc-empty">Loading…</p>
            ) : latest.length === 0 ? (
              <p className="tl-hacc-empty">You’re all caught up.</p>
            ) : (
              <ul className="tl-hacc-list">
                {latest.map((n) => (
                  <li key={n.id}>
                    <Link to="/notifications" className={`tl-hacc-note${n.isRead ? '' : ' is-unread'}`}>
                      <span className="tl-hacc-note-title">{n.title}</span>
                      <span className="tl-hacc-note-msg">{n.message}</span>
                      <span className="tl-hacc-note-time">{timeAgo(n.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/notifications" className="tl-hacc-all">View all</Link>
          </div>
        )}
      </div>

      <div className="tl-hacc-item">
        <button
          type="button"
          className="tl-hacc-btn"
          data-pop="account"
          aria-expanded={which === 'account'}
          aria-controls="tl-hacc-account"
          aria-label="Account"
          onClick={() => toggle('account')}
        >
          <TicketUserIcon className="tl-hacc-icon" />
        </button>
        {which === 'account' && (
          <div id="tl-hacc-account" className="tl-hacc-pop" role="region" aria-label="Account">
            <Link to="/profile" className="tl-hacc-action">
              <UserRound className="w-4 h-4" aria-hidden="true" /> View profile
            </Link>
            <button type="button" className="tl-hacc-action" onClick={onLogout}>
              <LogOut className="w-4 h-4" aria-hidden="true" /> Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
