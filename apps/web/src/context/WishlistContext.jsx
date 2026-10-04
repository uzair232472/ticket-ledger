import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from './AuthContext';
import { useDialog } from '../components/ui/DialogProvider';

const WishlistContext = createContext(null);

/**
 * The signed-in user's wishlist (events saved with the heart), shared by every page with event cards.
 * Hearts update instantly and are saved to the account; signed-out visitors are asked to sign in.
 */
export function WishlistProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const [ids, setIds] = useState(() => new Set());

  // Load (or clear) the saved ids whenever the signed-in user changes
  useEffect(() => {
    if (!isAuthenticated) {
      setIds(new Set());
      return undefined;
    }
    let alive = true;
    api
      .get('/wishlist/ids')
      .then((res) => alive && setIds(new Set(res.data?.data?.eventIds || [])))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAuthenticated, user?.id]);

  const isSaved = useCallback((eventId) => ids.has(eventId), [ids]);

  const toggle = useCallback(
    async (eventId) => {
      if (!isAuthenticated) {
        const go = await dialog.confirm({
          tone: 'info',
          title: 'Sign in to save events',
          message: 'Your wishlist is kept in your account, so you can find saved events on any device.',
          confirmLabel: 'Sign in',
          cancelLabel: 'Not now',
        });
        if (go) navigate('/login', { state: { from: location.pathname } });
        return false;
      }
      const saving = !ids.has(eventId);
      setIds((prev) => {
        const next = new Set(prev);
        if (saving) next.add(eventId);
        else next.delete(eventId);
        return next;
      });
      try {
        if (saving) await api.post(`/wishlist/${eventId}`);
        else await api.delete(`/wishlist/${eventId}`);
        return true;
      } catch (err) {
        // Undo the instant change
        setIds((prev) => {
          const next = new Set(prev);
          if (saving) next.delete(eventId);
          else next.add(eventId);
          return next;
        });
        dialog.alert({ tone: 'error', title: saving ? 'Couldn’t save this event' : 'Couldn’t remove this event', message: err.response?.data?.message || 'Please try again.' });
        return false;
      }
    },
    [isAuthenticated, ids, dialog, navigate, location.pathname]
  );

  return <WishlistContext.Provider value={{ ids, count: ids.size, isSaved, toggle }}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used inside <WishlistProvider>');
  return ctx;
}
