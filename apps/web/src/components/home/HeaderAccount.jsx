import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Heart, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWishlist } from '../../context/WishlistContext';
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
 * Header icons:
 * - Permanent Cart button: links directly to /cart page showing booking completion & delete options.
 * - Notifications (latest three + "View all") and Account (profile / log out) when signed in.
 */
export default function HeaderAccount({ menuOpen, onOpen, onLogout }) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [which, setWhich] = useState(null); // 'notifications' | 'account' | null
  const [latest, setLatest] = useState(null); // null while loading
  const [unread, setUnread] = useState(0);
  const rootRef = useRef(null);
  const { count: savedCount } = useWishlist();
  const { totalCount, first, secondsLeft } = useCartHolds();

  const loadNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.get('/notifications?limit=3');
      setLatest(res.data?.data?.notifications || []);
      setUnread(res.data?.data?.unreadCount || 0);
    } catch {
      setLatest((l) => l || []);
    }
  }, [isAuthenticated]);

  // Unread badge: on load, on every page change and once a minute
  useEffect(() => {
    if (isAuthenticated) loadNotifications();
  }, [loadNotifications, location.pathname, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(loadNotifications, 60000);
    return () => clearInterval(id);
  }, [loadNotifications, isAuthenticated]);

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

  const hasItems = totalCount > 0 && first && secondsLeft > 0;

  return (
    <div ref={rootRef} className="tl-hacc">
      {/* Permanent Ticket Cart Button - Navigates directly to /cart page */}
      <div className="tl-hacc-item">
        <Link
          to="/cart"
          className="tl-hacc-btn"
          aria-label={hasItems ? `Cart: ${totalCount} tickets reserved` : 'Ticket Cart'}
          title={hasItems ? `${totalCount} tickets held: Complete booking` : 'Ticket Cart'}
        >
          <TicketCartIcon className="tl-hacc-icon" />
          {hasItems && (
            <span className="tl-hacc-dot" aria-hidden="true">
              {totalCount}
            </span>
          )}
        </Link>
      </div>

      {/* Notifications Button & Popover (when signed in) */}
      {isAuthenticated && (
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
      )}

      {/* Account Button & Popover (when signed in) */}
      {isAuthenticated && (
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
              <Link to="/wishlist" className="tl-hacc-action">
                <Heart className="w-4 h-4" aria-hidden="true" /> Wishlist
                {savedCount > 0 && <span className="tl-hacc-count">{savedCount}</span>}
              </Link>
              <button type="button" className="tl-hacc-action" onClick={onLogout}>
                <LogOut className="w-4 h-4" aria-hidden="true" /> Log out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
