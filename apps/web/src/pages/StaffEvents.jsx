import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../lib/session';
import { DashHead, DashCard, Kpi, Chip, Notice, DashState, EventTile, useAdminDark } from '../components/dash/DashShell';
import { PageHero } from './AdminOverview';
import { getEventVisual } from '../utils/eventMedia';
import { SERIES } from '../components/dash/charts';
import { CalendarDays, MapPin, RefreshCw, AlertCircle, ScanLine, CalendarCheck, CalendarClock, Clock, Search, ArrowRight, ChevronLeft, ChevronRight, Building2, Radio } from 'lucide-react';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const PAGE_SIZE = 8; // two rows of four
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const STATE = {
  LIVE: { label: 'Live', className: 'is-live' },
  UPCOMING: { label: 'Upcoming', className: 'is-up' },
  PAST: { label: 'Past', className: 'is-past' },
};

/** Gate console (dark layout): stats, filter pills, search and event cards, 6 per page. */
function DarkStaffEvents({ events, loading, error }) {
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const today = startOfToday();
  const stateOf = (e) => {
    const d = new Date(e.date);
    if (sameDay(d, today)) return 'LIVE';
    return d > today ? 'UPCOMING' : 'PAST';
  };
  const withState = useMemo(() => events.map((e) => ({ ...e, state: stateOf(e) })), [events]);
  const counts = {
    ALL: withState.length,
    UPCOMING: withState.filter((e) => e.state === 'UPCOMING').length,
    LIVE: withState.filter((e) => e.state === 'LIVE').length,
    PAST: withState.filter((e) => e.state === 'PAST').length,
  };
  const upcoming = withState.filter((e) => e.state !== 'PAST').sort((a, b) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0];
  // Live first, then upcoming (soonest first), then past (latest first)
  const rank = { LIVE: 0, UPCOMING: 1, PAST: 2 };
  const shown = withState
    .filter((e) => filter === 'ALL' || e.state === filter)
    .filter((e) => !query.trim() || [e.name, e.venue, e.city, e.company?.companyName].some((v) => String(v || '').toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'PAST' ? new Date(b.date) - new Date(a.date) : new Date(a.date) - new Date(b.date)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [filter, query]);

  const FILTERS = [['ALL', 'All events'], ['UPCOMING', 'Upcoming'], ['LIVE', 'Live'], ['PAST', 'Past']];
  const dateLine = (e) => {
    const d = new Date(e.date);
    return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${e.time ? ` • ${e.time}` : ''}`;
  };

  return (
    <div className="tl-aov tl-aov-sec tl-se">
      <PageHero
        title="My Events"
        intro="Choose the event you are working, then scan attendee passes at your gate."
        aside={<Link to="/scanner" className="tl-aov-refresh"><ScanLine className="w-4 h-4" aria-hidden="true" /> Open scanner</Link>}
      />

      {error && <Notice tone="bad" icon={AlertCircle}>{error}</Notice>}

      <section className="tl-se-stats" aria-label="Summary">
        <div>
          <span className="tl-se-stat-icon" aria-hidden="true"><CalendarCheck /></span>
          <p><strong>{loading ? '…' : events.length}</strong><span>Assigned events</span></p>
        </div>
        <div>
          <span className="tl-se-stat-icon" aria-hidden="true"><Radio /></span>
          <p><strong>{loading ? '…' : counts.LIVE}</strong><span>Today’s events</span></p>
        </div>
        <div>
          <span className="tl-se-stat-icon" aria-hidden="true"><CalendarClock /></span>
          <p><strong>{next ? new Date(next.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</strong><span>{next ? `Next event · ${next.city}` : 'Next event'}</span></p>
        </div>
      </section>

      <div className="tl-apv-bar">
        <div className="tl-apv-filters" role="group" aria-label="Filter events">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" className={`tl-apv-filter${filter === v ? ' is-active' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {label} <span>{counts[v]}</span>
            </button>
          ))}
        </div>
        <label className="tl-apv-search">
          <Search className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">Search events</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events…" />
        </label>
      </div>

      {loading ? (
        <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading your events…</p></div>
      ) : !events.length ? (
        <div className="tl-gm-empty">
          <span className="tl-gm-empty-icon" aria-hidden="true"><CalendarDays /></span>
          <h2>No events yet</h2>
          <p>You aren't assigned to any events yet. Ask your organizer to add you to an event.</p>
        </div>
      ) : !rows.length ? (
        <div className="tl-dash-state"><Search className="w-7 h-7" /><p>No events match this filter.</p></div>
      ) : (
        <div className="tl-se-grid">
          {rows.map((e, i) => {
            const st = STATE[e.state];
            return (
              <article key={e.id} className={`tl-se-card ${st.className}`}>
                <Link to={`/scanner?eventId=${e.id}`} className="tl-se-media" aria-label={`Scan for ${e.name}`}>
                  <img src={getEventVisual(e, i).image} alt="" loading="lazy" onError={(ev) => ev.currentTarget.remove()} />
                  <span className={`tl-se-flag ${st.className}`}><i aria-hidden="true" />{st.label}</span>
                </Link>
                <div className="tl-se-body">
                  <h3>{e.name}</h3>
                  <p><CalendarDays className="w-4 h-4" aria-hidden="true" /> {dateLine(e)}</p>
                  <p><MapPin className="w-4 h-4" aria-hidden="true" /> {[e.venue, e.city].filter(Boolean).join(', ')}</p>
                  <div className="tl-se-foot">
                    <span><Building2 className="w-4 h-4" aria-hidden="true" /> {e.company?.companyName || 'Organizer'}</span>
                    <Link to={`/scanner?eventId=${e.id}`} className="tl-se-go" aria-label={`Scan for ${e.name}`}><ArrowRight className="w-4 h-4" /></Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {shown.length > PAGE_SIZE && (
        <nav className="tl-apv-pager" aria-label="Pages">
          <p>Showing <strong>{(current - 1) * PAGE_SIZE + 1} – {Math.min(shown.length, current * PAGE_SIZE)}</strong> of <strong>{shown.length}</strong> events</p>
          <div>
            <button type="button" className="tl-se-pg" onClick={() => setPage(current - 1)} disabled={current <= 1}><ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous</button>
            <span>Page {current} of {pages}</span>
            <button type="button" className="tl-se-pg is-next" onClick={() => setPage(current + 1)} disabled={current >= pages}>Next <ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        </nav>
      )}
    </div>
  );
}

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

  const dark = useAdminDark();
  if (dark) return <DarkStaffEvents events={events} loading={loading} error={error} />;

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
