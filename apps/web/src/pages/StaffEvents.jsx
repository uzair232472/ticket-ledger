import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../lib/session';
import { CalendarDays, MapPin, ScanLine, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';

/**
 * Gate staff landing screen (phone-first): pick one of the events you are assigned to, then scan.
 */
export default function StaffEvents() {
  const { user, token } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/staff/my-events`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Could not load your events');
        setEvents(data.data.events);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#16a34a]">Gate staff</p>
        <h1 className="text-xl font-extrabold text-slate-900">Select event</h1>
        <p className="text-xs text-slate-500">
          Signed in as {user?.name}
          {user?.companyName ? ` · ${user.companyName}` : ''}
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <RefreshCw className="w-6 h-6 animate-spin text-[#16a34a]" />
        </div>
      )}

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center text-sm text-slate-600">
          You aren't assigned to any events yet. Ask your organizer to add you to an event.
        </div>
      )}

      <ul className="space-y-3">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              to={`/scanner?eventId=${event.id}`}
              className="flex items-center gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm active:scale-[0.99] hover:border-[#22c55e] transition"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                <ScanLine className="w-5 h-5 text-[#16a34a]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{event.name}</div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  {event.time ? ` · ${event.time}` : ''}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3" /> {event.venue}, {event.city}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
