import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StaffManager from '../components/StaffManager';
import { DashHead, DashCard, Kpi, Chip, Tile, Notice, DashState } from '../components/dash/DashShell';
import { ColumnChart, LineChart, Legend, Ring, Meter, SERIES, NEUTRAL, compactPkr, formatPkr } from '../components/dash/charts';
import { getEventVisual } from '../utils/eventMedia';
import {
  Ticket,
  Scan,
  AlertTriangle,
  ShoppingCart,
  UserX,
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  Plus,
  Wallet,
  CalendarDays,
  MapPin,
  ArrowUpRight,
  ChevronDown,
  Users,
  Send,
  Info,
  Receipt,
  ScanLine,
  ShieldAlert,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const EVENTS_SHOWN = 4;
const TIERS_SHOWN = 8;

const dayLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const eventDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore")
const place = (venue = '', city = '') => (city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city);
const STATUS_BADGE = {
  PUBLISHED: ['On sale', 'is-live'],
  DRAFT: ['Draft', 'is-warn'],
  PRELAUNCH_ANALYSIS: ['Pre-launch', 'is-warn'],
  PAUSED: ['Paused', 'is-warn'],
  COMPLETED: ['Completed', ''],
  CANCELLED: ['Cancelled', ''],
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Per-event totals from the all-events tier breakdown (the API reports tiers with their event name)
function totalsByEvent(tiers) {
  const map = new Map();
  tiers.forEach((t) => {
    const e = map.get(t.eventName) || { sold: 0, capacity: 0, revenue: 0 };
    e.sold += t.soldQuantity;
    e.capacity += t.totalQuantity;
    e.revenue += t.tierRevenuePkr;
    map.set(t.eventName, e);
  });
  return map;
}

/** Event card: photo with status, title, date and venue, revenue / tickets box, quick links. */
function EventCard({ event, index, totals, selected, onStats }) {
  const image = getEventVisual(event, index).image;
  const [badge, badgeClass] = STATUS_BADGE[event.status] || [event.status, ''];
  return (
    <article className={`tl-st-ev${selected ? ' is-selected' : ''}`}>
      <Link to={`/events/${event.id}`} className="tl-st-ev-media" tabIndex={-1} aria-hidden="true">
        <img src={image} alt="" loading="lazy" onError={(e) => e.currentTarget.classList.add('is-broken')} />
        <span className={`tl-st-ev-badge ${badgeClass}`}>{badge}</span>
      </Link>
      <div className="tl-st-ev-body">
        <h3><Link to={`/events/${event.id}`}>{event.name}</Link></h3>
        <p className="tl-st-ev-meta"><CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />{eventDate(event.date)}</p>
        <p className="tl-st-ev-meta"><MapPin className="w-3.5 h-3.5" aria-hidden="true" />{place(event.venue, event.city)}</p>
        <div className="tl-st-ev-stats">
          <div>
            <small>Revenue</small>
            <strong>{totals ? formatPkr(totals.revenue) : '—'}</strong>
          </div>
          <div className="tl-st-ev-sold">
            <Receipt className="w-4 h-4" aria-hidden="true" />
            <div>
              <small>Tickets sold</small>
              <strong><Users className="w-3.5 h-3.5" aria-hidden="true" />{totals ? `${totals.sold.toLocaleString()} / ${totals.capacity.toLocaleString()}` : '—'}</strong>
            </div>
          </div>
        </div>
        <div className="tl-st-ev-links">
          <button type="button" onClick={onStats} aria-pressed={selected}>Stats</button>
          <Link to={`/organizer/events/${event.id}/edit`}>Edit</Link>
          <Link to={`/organizer/events/${event.id}/venue`}>Seating</Link>
          <Link to={`/events/${event.id}`} className="tl-st-ev-open" aria-label={`Open the ${event.name} event page`}>
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function OrganizerDashboard() {
  const { user, token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedEventId, setSelectedEventId] = useState(searchParams.get('eventId') || 'ALL');
  const [dashboardData, setDashboardData] = useState(null);
  const [allTiers, setAllTiers] = useState(null); // tier breakdown for every event (per-event card totals)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [eventView, setEventView] = useState('upcoming'); // upcoming | all | past
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showAllTiers, setShowAllTiers] = useState(false);

  const load = async (eventId) => {
    const params = new URLSearchParams();
    if (eventId && eventId !== 'ALL') params.append('eventId', eventId);
    const res = await fetch(`${API_URL}/api/organizer/organizer-dashboard?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || 'Failed to load organizer dashboard');
    return json.data;
  };

  const fetchDashboard = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await load(selectedEventId);
      setDashboardData(data);
      if (selectedEventId === 'ALL') setAllTiers(data.tierBreakdown || []);
      else if (!allTiers) load('ALL').then((all) => setAllTiers(all.tierBreakdown || [])).catch(() => {});
    } catch (err) {
      setError(err.message || 'Network error fetching dashboard metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (token) fetchDashboard();
  }, [selectedEventId, token]);

  const metrics = dashboardData?.metrics || {};
  const liveGate = dashboardData?.liveGatePacing || {};
  const attendance = dashboardData?.attendancePrediction || {};
  const tierBreakdown = dashboardData?.tierBreakdown || [];
  const salesGraph = dashboardData?.salesGraph || [];
  const fraudFeed = dashboardData?.fraudFeed || [];
  const modulesPreview = dashboardData?.modulesPreview || {};
  const events = dashboardData?.events || [];

  const revenueBars = useMemo(() => salesGraph.map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.revenuePkr })), [salesGraph]);
  const salesLines = useMemo(() => ({
    labels: salesGraph.map((d) => dayLabel(d.date)),
    series: [
      { label: 'Tickets', color: SERIES[0], values: salesGraph.map((d) => d.ticketsSold) },
      { label: 'Orders', color: SERIES[1], values: salesGraph.map((d) => d.ordersCount) },
    ],
  }), [salesGraph]);
  // Revenue by ticket type: the three biggest tiers by name, everything else as "Other"
  const tierMix = useMemo(() => {
    const byName = new Map();
    tierBreakdown.forEach((t) => byName.set(t.tierName, (byName.get(t.tierName) || 0) + t.tierRevenuePkr));
    const sorted = [...byName.entries()].sort((a, b) => b[1] - a[1]);
    const parts = sorted.slice(0, 3).map(([label, value], i) => ({ label, value, color: SERIES[i] }));
    const rest = sorted.slice(3).reduce((n, [, v]) => n + v, 0);
    if (rest > 0) parts.push({ label: 'Other', value: rest, color: NEUTRAL });
    return parts;
  }, [tierBreakdown]);
  const eventTotals = useMemo(() => totalsByEvent(allTiers || []), [allTiers]);
  // Upcoming and live events (soonest first) by default; past events on request (latest first)
  const listedEvents = useMemo(() => {
    const today = startOfToday();
    const upcoming = events.filter((e) => new Date(e.date) >= today).sort((a, b) => new Date(a.date) - new Date(b.date));
    const past = events.filter((e) => new Date(e.date) < today).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (eventView === 'past') return past;
    if (eventView === 'all') return [...upcoming, ...past];
    return upcoming;
  }, [events, eventView]);
  const shownEvents = showAllEvents ? listedEvents : listedEvents.slice(0, EVENTS_SHOWN);
  // Best-selling tiers first
  const sortedTiers = useMemo(
    () => [...tierBreakdown].sort((a, b) => b.tierRevenuePkr - a.tierRevenuePkr || b.soldQuantity - a.soldQuantity || b.price - a.price),
    [tierBreakdown]
  );
  const shownTiers = showAllTiers ? sortedTiers : sortedTiers.slice(0, TIERS_SHOWN);

  const occupancy = metrics.totalCapacity > 0 ? Math.round((metrics.totalTicketsSold / metrics.totalCapacity) * 100) : 0;
  const eventQuery = selectedEventId !== 'ALL' ? `?eventId=${selectedEventId}` : '';
  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const liveCount = events.filter((e) => e.status === 'PUBLISHED').length;
  const highRisk = fraudFeed.filter((f) => f.fraudScore >= 75).length;

  const changeEvent = (id) => {
    setSelectedEventId(id);
    setSearchParams(id !== 'ALL' ? { eventId: id } : {});
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <div>
      <DashHead
        eyebrow={user?.companyName || 'Organizer studio'}
        title={selectedEvent ? 'Event stats' : 'Your events'}
        note={
          selectedEvent
            ? `${selectedEvent.name}. Sales, gate check-ins and the attendance forecast for this event only.`
            : 'Sales, gate check-ins and attendance across every event you host. Pick one event to see only its numbers.'
        }
      />

      {/* Deep green filter bar */}
      <form className="tl-st-bar" onSubmit={(e) => e.preventDefault()} aria-label="Dashboard filters">
        <label className="tl-st-select">
          <CalendarDays className="w-4 h-4" aria-hidden="true" />
          <span>
            <small>Event</small>
            <select value={selectedEventId} onChange={(e) => changeEvent(e.target.value)}>
              <option value="ALL">All events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
          </span>
          <ChevronDown className="w-4 h-4 tl-st-select-chev" aria-hidden="true" />
        </label>
        <div className="tl-st-bar-right">
          <div className="tl-st-bar-stat">
            <small>{events.length} {events.length === 1 ? 'event' : 'events'}</small>
            <span><i aria-hidden="true" />{liveCount} of {events.length} on sale</span>
          </div>
          <button type="button" className="tl-st-btn tl-st-btn--ghost" onClick={fetchDashboard} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'tl-dash-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
          <Link to="/organizer/create-event" className="tl-st-btn tl-st-btn--green">
            <Plus className="w-4 h-4" aria-hidden="true" /> Create event
          </Link>
        </div>
      </form>

      <p className="tl-st-count" aria-live="polite">
        {loading ? (
          <span>Loading your dashboard…</span>
        ) : (
          <>
            <span>{events.length} {events.length === 1 ? 'event' : 'events'}</span>
            <span>{(metrics.totalTicketsSold || 0).toLocaleString()} tickets sold</span>
            <span>{formatPkr(metrics.totalRevenuePkr)} gross</span>
            {selectedEvent && (
              <span>
                <Link to={`/organizer/events/${selectedEvent.id}/edit`}>Edit</Link>
                <Link to={`/organizer/events/${selectedEvent.id}/venue`}>Seating</Link>
                <button type="button" onClick={() => changeEvent('ALL')} style={{ marginLeft: 12 }}>Back to all events</button>
              </span>
            )}
          </>
        )}
      </p>

      {error && <Notice tone="bad" icon={AlertTriangle}>{error}</Notice>}

      {!loading && (
        <>
          {/* Headline numbers, charts and insights */}
          <div className="tl-dash-grid">
            <div className="tl-dash-kpis">
              <Kpi
                label="GROSS REVENUE"
                unit="PKR"
                value={metrics.totalRevenuePkr || 0}
                chips={[<Chip key="n" icon={Wallet}>Net PKR {(metrics.netRevenuePkr || 0).toLocaleString()}</Chip>, <Chip key="f" icon={Receipt}>Fee {(metrics.platformFeePkr || 0).toLocaleString()}</Chip>]}
              />
              <Kpi
                label="TICKETS SOLD"
                value={metrics.totalTicketsSold || 0}
                chips={[<Chip key="o" icon={Users}>{occupancy}% of {(metrics.totalCapacity || 0).toLocaleString()} seats</Chip>]}
              />
              <Kpi
                label="GATE CHECK-INS"
                value={liveGate.scanned || 0}
                chips={[<Chip key="t" icon={ScanLine}>{liveGate.turnoutPercentage || 0}% turnout</Chip>, <Chip key="r" icon={Send}>{liveGate.remaining || 0} to arrive</Chip>]}
              />
            </div>

            <DashCard className="tl-dash-side tl-dash-panel">
              <span className="tl-dash-panel-tag"><TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> Insights</span>
              <h2 className="tl-dash-panel-title">What to look at next</h2>
              <div className="tl-dash-tiles">
                <Tile num={1} icon={ShoppingCart} title="Purchase intent" value={(modulesPreview.intentViewers || 0).toLocaleString()} to={`/admin/purchase-intent${eventQuery}`}>
                  People showed intent to buy tickets but didn't complete checkout.
                </Tile>
                <Tile num={2} icon={TrendingUp} title="Demand forecast" to={`/admin/demand-forecast${eventQuery}`}>
                  Predicted ticket demand based on recent page views and conversion patterns.
                </Tile>
                <Tile num={3} icon={UserX} title="Abandoned checkouts" value={modulesPreview.abandonedCarts || 0} to={`/admin/abandoned-intents${eventQuery}`}>
                  Users added tickets to their cart but didn't complete the purchase.
                </Tile>
              </div>
              <div className="tl-dash-ask">
                <Link to="/scanner" className="tl-st-btn tl-st-btn--outline">
                  <Scan className="w-4 h-4" aria-hidden="true" /> Open gate scanner
                </Link>
              </div>
            </DashCard>

            <div className="tl-dash-under">
              <DashCard title="Revenue" sub={`${salesGraph.length} sales ${salesGraph.length === 1 ? 'day' : 'days'} · by ticket type volume`}>
                <ColumnChart data={revenueBars} format={(v) => compactPkr(v).replace('PKR ', '')} tipFormat={formatPkr} height={170} label="Revenue per sales day" />
                {tierMix.length > 0 && <Legend items={tierMix} format={compactPkr} />}
              </DashCard>
              <DashCard title="Sales" sub="Tickets and orders per day">
                <LineChart labels={salesLines.labels} series={salesLines.series} height={200} area endDot label="Tickets and orders per sales day" />
              </DashCard>
            </div>
          </div>

          {/* Events */}
          <div className="tl-st-section">
            <div>
              <p className="tl-st-kicker">Events</p>
              <h2>Events</h2>
            </div>
            <div className="tl-st-section-aside">
              <p>
                {eventView === 'upcoming' ? 'Upcoming and live. Past events are hidden by default.' : eventView === 'past' ? 'Past events, latest first.' : 'Upcoming events first, then past ones.'}
              </p>
              <select className="tl-st-filter" value={eventView} onChange={(e) => { setEventView(e.target.value); setShowAllEvents(false); }} aria-label="Which events to show">
                <option value="upcoming">Upcoming &amp; live</option>
                <option value="all">All events</option>
                <option value="past">Past events</option>
              </select>
            </div>
          </div>
          {listedEvents.length === 0 ? (
            <div className="tl-st-empty">
              {eventView === 'past' ? 'No past events yet.' : 'No upcoming events. '}
              {eventView !== 'past' && <Link to="/organizer/create-event" style={{ color: 'var(--st-green)', fontWeight: 700 }}>Create one</Link>}
            </div>
          ) : (
            <div className="tl-st-events">
              {shownEvents.map((ev, i) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  index={i}
                  totals={eventTotals.get(ev.name)}
                  selected={ev.id === selectedEventId}
                  onStats={() => changeEvent(ev.id === selectedEventId ? 'ALL' : ev.id)}
                />
              ))}
            </div>
          )}
          {listedEvents.length > EVENTS_SHOWN && (
            <div className="tl-st-more">
              <button type="button" className="tl-st-btn tl-st-btn--outline tl-st-btn--sm" onClick={() => setShowAllEvents((v) => !v)}>
                {showAllEvents ? 'Show fewer' : `Show all ${listedEvents.length}`}
              </button>
            </div>
          )}

          {/* On the day */}
          <section className="tl-st-band" aria-labelledby="tl-st-day">
            <div className="tl-st-band-intro">
              <p className="tl-st-kicker">On the ground</p>
              <h2 id="tl-st-day">On the day</h2>
              <p>Live event day attendance across your events and entry points.</p>
            </div>
            <div className="tl-st-band-item">
              <header><h3>Turnout</h3><span role="img" aria-label="Valid first scans at the gate divided by tickets sold" title="Valid first scans at the gate divided by tickets sold" style={{ display: "inline-flex" }}><Info className="w-3.5 h-3.5" aria-hidden="true" /></span></header>
              <p>Total check-ins vs tickets sold</p>
              <div className="tl-st-band-figure">
                <Ring value={liveGate.turnoutPercentage || 0} muted label="Turnout" />
                <div>
                  <strong>{(liveGate.scanned || 0).toLocaleString()}</strong>
                  <span>of {(liveGate.totalTicketsSold || 0).toLocaleString()} checked in</span>
                </div>
              </div>
            </div>
            <div className="tl-st-band-item">
              <header><h3>Expected attendance</h3><span role="img" aria-label="Forecast from the attendance model" title="Forecast from the attendance model" style={{ display: "inline-flex" }}><Info className="w-3.5 h-3.5" aria-hidden="true" /></span></header>
              <p>Based on historical trends</p>
              <div className="tl-st-band-figure">
                <Ring value={attendance.rate || 0} size={84} label="Predicted turnout" />
                <div>
                  <strong>{attendance.rate || 0}%</strong>
                  <span>Predicted turnout{attendance.predictedAttendees ? ` · ~${attendance.predictedAttendees} people` : ''}</span>
                </div>
              </div>
            </div>
            <div className="tl-st-band-item">
              <header><h3>Health check</h3><span role="img" aria-label="Bot and scalper activity flagged on your events" title="Bot and scalper activity flagged on your events" style={{ display: "inline-flex" }}><Info className="w-3.5 h-3.5" aria-hidden="true" /></span></header>
              <p>{fraudFeed.length ? 'Activity flagged on your events.' : 'Everything looks good at the moment.'}</p>
              {fraudFeed.length === 0 ? (
                <div className="tl-st-health">
                  <CheckCircle2 className="w-9 h-9" aria-hidden="true" />
                  <span>No active issues or alerts. Keep it up!</span>
                </div>
              ) : (
                <div className="tl-st-health is-alert">
                  <ShieldAlert className="w-9 h-9" aria-hidden="true" />
                  <span>
                    <strong>{fraudFeed.length} {fraudFeed.length === 1 ? 'alert' : 'alerts'}</strong>
                    {highRisk ? `, ${highRisk} high risk` : ''}. Latest: {fraudFeed[0].userName}, {fraudFeed[0].reason.toLowerCase()}.{' '}
                    <Link to={`/admin/purchase-intent${eventQuery}`}>Review</Link>
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Ticket tiers and staff */}
          <div className="tl-st-section">
            <p className="tl-st-kicker">Ticket tiers and staff</p>
          </div>
          <div className="tl-st-split">
            <DashCard title="Ticket tiers" sub={`${tierBreakdown.length} ticket tiers${selectedEvent ? '' : ' across all events'} · best sellers first`}>
              {tierBreakdown.length === 0 ? (
                <DashState icon={Ticket}>No ticket tiers yet. Create an event to start selling.</DashState>
              ) : (
                <div className="tl-dash-table-wrap">
                  <table className="tl-dash-table">
                    <thead>
                      <tr>
                        <th>Ticket tier</th>
                        {!selectedEvent && <th>Event</th>}
                        <th className="is-num">Price</th>
                        <th>Sold / total</th>
                        <th className="is-num">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownTiers.map((t) => (
                        <tr key={t.tierId}>
                          <td className="tl-cell-main">{t.tierName}</td>
                          {!selectedEvent && <td><div className="tl-cell-sub" title={t.eventName}>{t.eventName}</div></td>}
                          <td className="is-num">{formatPkr(t.price)}</td>
                          <td>
                            <span className="tl-st-sold">
                              {t.soldQuantity.toLocaleString()} / {t.totalQuantity.toLocaleString()}
                              <Meter value={t.percentageSold} />
                            </span>
                          </td>
                          <td className="is-num">{formatPkr(t.tierRevenuePkr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sortedTiers.length > TIERS_SHOWN && (
                    <div className="tl-st-more">
                      <button type="button" className="tl-st-btn tl-st-btn--outline tl-st-btn--sm" onClick={() => setShowAllTiers((v) => !v)}>
                        {showAllTiers ? 'Show top tiers only' : `Show all ${sortedTiers.length} tiers`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </DashCard>
            <StaffManager />
          </div>
        </>
      )}
    </div>
  );
}
