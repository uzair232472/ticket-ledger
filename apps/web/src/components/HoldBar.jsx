import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import './holdbar.css';

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * Site-wide "My tickets" countdown: while the signed-in user holds seats, a small bar on every screen shows
 * how long the reservation lasts and links back to the seat plan. Holds come from the server, so the bar
 * survives refreshes and page changes. Hidden on that event's own seat page, which has the same button.
 */
export default function HoldBar() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [holds, setHolds] = useState([]);
  const [offset, setOffset] = useState(0); // server clock minus local clock
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!isAuthenticated) return setHolds([]);
    try {
      const res = await api.get('/venues/holds/mine');
      const d = res.data?.data;
      setOffset(new Date(d.serverTime).getTime() - Date.now());
      setHolds(d.holds || []);
    } catch {
      // Keep the last known state; the next poll retries
    }
    return undefined;
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load, pathname]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('tl:holds-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(load, 30000);
    return () => {
      window.removeEventListener('tl:holds-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [load]);

  const first = holds[0];
  const count = useMemo(() => holds.reduce((n, h) => n + h.count, 0), [holds]);

  useEffect(() => {
    if (!first) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [first]);

  const secondsLeft = first ? Math.max(0, Math.round((new Date(first.expiresAt).getTime() - (now + offset)) / 1000)) : null;

  // Expired: drop it now and confirm with the server (another event's hold may still be running)
  useEffect(() => {
    if (secondsLeft !== 0) return;
    setHolds((h) => h.slice(1));
    load();
  }, [secondsLeft, load]);

  if (!first || !secondsLeft || pathname === `/events/${first.eventId}/seats`) return null;

  const urgent = secondsLeft < 60;
  return (
    <Link
      to={`/events/${first.eventId}/seats`}
      className={`tl-holdbar${urgent ? ' is-urgent' : ''}`}
      aria-label={`My tickets: ${count} seat${count === 1 ? '' : 's'} reserved for ${first.eventName}, ${Math.ceil(secondsLeft / 60)} minute${secondsLeft > 60 ? 's' : ''} left`}
      title={`Seats reserved for ${first.eventName}`}
    >
      <span className="tl-holdbar-label">My tickets</span>
      <span className="tl-holdbar-time" role="timer" aria-hidden="true">{clock(secondsLeft)}</span>
      <span className="tl-holdbar-count" aria-hidden="true">{count}</span>
    </Link>
  );
}
