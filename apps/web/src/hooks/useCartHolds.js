import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

export function useCartHolds() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [holds, setHolds] = useState([]);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [releasing, setReleasing] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setHolds([]);
      return;
    }
    try {
      const res = await api.get('/venues/holds/mine');
      const d = res.data?.data;
      if (d) {
        setOffset(new Date(d.serverTime).getTime() - Date.now());
        setHolds(d.holds || []);
      }
    } catch {
      // Keep state on transient network failures
    }
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load, location.pathname]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('tl:holds-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(load, 20000);
    return () => {
      window.removeEventListener('tl:holds-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [load]);

  const first = holds[0] || null;
  const totalCount = useMemo(() => holds.reduce((acc, h) => acc + (h.count || 0), 0), [holds]);

  useEffect(() => {
    if (!first) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [first]);

  const secondsLeft = first ? Math.max(0, Math.round((new Date(first.expiresAt).getTime() - (now + offset)) / 1000)) : null;

  useEffect(() => {
    if (secondsLeft === 0) {
      setHolds((prev) => prev.slice(1));
      load();
    }
  }, [secondsLeft, load]);

  const releaseAll = useCallback(async (eventId, keys) => {
    if (!eventId || !keys || !keys.length) return;
    try {
      setReleasing(true);
      await api.post(`/venues/event/${eventId}/holds/release`, { keys });
      window.dispatchEvent(new Event('tl:holds-changed'));
      await load();
    } catch (err) {
      console.error('Failed to release holds:', err);
    } finally {
      setReleasing(false);
    }
  }, [load]);

  return {
    holds,
    first,
    totalCount,
    secondsLeft,
    releasing,
    releaseAll,
    refresh: load,
  };
}

export default useCartHolds;
