import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../lib/session';
import { DashHead, DashCard, Kpi, Chip, Notice, DashState, EventTile } from '../components/dash/DashShell';
import { SERIES } from '../components/dash/charts';
import { CalendarDays, MapPin, RefreshCw, AlertCircle, ScanLine } from 'lucide-react';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

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

  const today = startOfToday();
  const upcoming = events.filter((e) => new Date(e.date) >= today).sort((a, b) => new Date(a.date) - new Date(b.date));
  const todays = upcoming.filter((e) => new Date(e.date).toDateString() === today.toDateString());
  const next = upcoming[0];

  return (
    <div>
      <DashHead
        eyebrow={`Gate staff · ${user?.name || ''}${user?.companyName ? ` · ${user.companyName}` : ''}`}
        title="My events"
        intro="Choose the event you are working, then scan attendee passes at your gate."
        actions={<Link to="/scanner" className="tl-dash-btn tl-dash-btn--ink"><ScanLine className="w-4 h-4" /> Open scanner</Link>}
      />

      {error && <Notice tone="bad" icon={AlertCircle}>{error}</Notice>}

      <div className="tl-dash-grid">
        <div className="tl-span-4"><Kpi label="Assigned events" color={SERIES[0]} value={loading ? '…' : events.length} chips={[<Chip key="u" icon={CalendarDays}>{upcoming.length} upcoming</Chip>]} /></div>
        <div className="tl-span-4"><Kpi label="Today" color={SERIES[1]} value={loading ? '…' : todays.length} chips={[<Chip key="t">{todays.length ? 'Gates open today' : 'Nothing scheduled today'}</Chip>]} /></div>
        <div className="tl-span-4">
          <Kpi
            label="Next event"
            color={SERIES[2]}
            value={next ? new Date(next.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
            chips={next ? [<Chip key="n" icon={MapPin}>{next.city}</Chip>] : []}
          />
        </div>
      </div>

      <div className="tl-dash-grid">
        <DashCard title="Select event" sub="Tap an event to start scanning for it" className="tl-span-12">
          {loading ? (
            <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading your events…</p></div>
          ) : events.length === 0 ? (
            <DashState icon={CalendarDays} title="No events yet">You aren't assigned to any events yet. Ask your organizer to add you to an event.</DashState>
          ) : (
            <div className="tl-dash-tiles-row">
              {events.map((event, i) => {
                const d = new Date(event.date);
                const isToday = d.toDateString() === today.toDateString();
                const isPast = d < today;
                return (
                  <EventTile
                    key={event.id}
                    event={event}
                    index={i}
                    to={`/scanner?eventId=${event.id}`}
                    flag={isToday ? 'Today' : isPast ? 'Ended' : event.time || 'Upcoming'}
                    flagTone={isToday ? 'live' : undefined}
                  >
                    <div className="tl-dash-tile-actions">
                      <Link to={`/scanner?eventId=${event.id}`}>Scan for this event</Link>
                    </div>
                  </EventTile>
                );
              })}
            </div>
          )}
        </DashCard>
      </div>
    </div>
  );
}
