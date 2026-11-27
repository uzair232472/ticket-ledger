import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CalendarDays, Clock, Filter, RefreshCw, ShoppingBag, Ticket, User, Users, X } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, StudioSelect, StatCard, Panel, Badge, Pager } from '../components/dash/Studio';
import { ColumnChart } from '../components/dash/charts';
import { RuleTag } from '../components/ml/InsightPanels';
import '../components/ml/ml.css';

/*
 * Customer behaviour (super admin). Counts only, no model, no score:
 *   - what happened (steps), on which event (per-event funnel) and by which customer (per person + timeline).
 * Customers only by default: staff, organizer, admin and test-script accounts are left out unless asked for.
 */
const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']];
const n = (x) => (x == null ? '—' : Number(x).toLocaleString());
const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const PAGE = 10;

export default function BehaviourReport() {
  const [days, setDays] = useState(30);
  const [eventId, setEventId] = useState('');
  const [scope, setScope] = useState('customers');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [person, setPerson] = useState(null); // { userId, name }
  const [timeline, setTimeline] = useState(null);
  const seq = useRef(0);

  const load = async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/behavior/report', { params: { days, scope, ...(eventId ? { eventId } : {}) } });
      if (mine === seq.current) { setData(r.data.data); setPage(1); }
    } catch (e) {
      if (mine === seq.current) setError(e.response?.data?.message || 'The report is unavailable right now.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days, eventId, scope]);

  useEffect(() => {
    if (!person) { setTimeline(null); return undefined; }
    let live = true;
    setTimeline(null);
    api.get(`/behavior/report/customers/${person.userId}`, { params: eventId ? { eventId } : {} })
      .then((r) => { if (live) setTimeline(r.data.data); })
      .catch(() => { if (live) setTimeline({ error: true }); });
    return () => { live = false; };
  }, [person, eventId]);

  const s = data?.summary;
  const eventName = eventId && data?.events?.find((e) => e.id === eventId)?.name;
  const customers = data?.customers || [];
  const rows = customers.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div>
      <StudioHead
        crumbs={['Admin', 'Insights', 'Customer behaviour']}
        title="Customer behaviour"
        intro="What customers did, on which event, and who did it. Pick a period and an event, then open a customer to see their full timeline. Counts only: no model, and nothing here decides anything about anyone."
        controls={
          <>
            <StudioSelect icon={CalendarDays} value={days} onChange={(e) => setDays(Number(e.target.value))} label="Period">
              {PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
            </StudioSelect>
            <StudioSelect icon={Ticket} value={eventId} onChange={(e) => { setEventId(e.target.value); setPerson(null); }} label="Event" wide>
              <option value="">All events</option>
              {(data?.events || []).map((e) => <option key={e.id} value={e.id}>{e.name}{e.city ? ` (${e.city})` : ''}</option>)}
            </StudioSelect>
            <StudioSelect icon={Filter} value={scope} onChange={(e) => setScope(e.target.value)} label="Accounts">
              <option value="customers">Customers and guests only</option>
              <option value="all">All accounts (incl. staff and test)</option>
            </StudioSelect>
          </>
        }
        actions={
          <>
            <RuleTag />
            <button type="button" className="tl-st-btn tl-st-btn--light" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh</button>
          </>
        }
      />

      {error && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />{error}</div>}

      {s && (
        <>
          <p className="tl-pn-sub" style={{ margin: '0 0 12px' }}>
            Showing <b>{PERIODS.find(([d]) => d === data.period.days)?.[1].toLowerCase() || `${data.period.days} days`}</b>
            {eventName ? <> on <b>{eventName}</b></> : ' on all events'}
            {data.scope === 'customers' ? ', customer accounts and guests only.' : ', all accounts including staff and test accounts.'}
          </p>
          <div className="tl-sc-grid">
            <StatCard icon={Users} tone="ink" label="Active people" value={n(s.activePeople)} note={`${n(s.signedInPeople)} signed in · ${n(s.guestSessions)} guest sessions (a guest can be the same person on another day)`} />
            <StatCard icon={Activity} tone="ink" label="Event page views" value={n(s.eventViews)} note={`Plus ${n(s.signIns)} sign-ins (not counted as behaviour)`} />
            <StatCard icon={ShoppingBag} tone="green" label="Buyers" value={n(s.buyers)} note={`${n(s.firstTimeBuyers)} first purchase ever · ${n(s.returningBuyers)} bought before this period`} />
            <StatCard icon={BarChart3} tone="blue" label="Orders paid" value={n(s.orders)} note={`PKR ${n(s.revenuePkr)} in this period`} />
          </div>

          <div style={{ marginTop: 16 }}>
            <Panel icon={BarChart3} title="What people did" sub="Each step counted once per action. Sign-ins and automatic system checks are left out.">
              <ColumnChart data={data.activity.slice(0, 10).map((a) => ({ label: a.label, value: a.count }))} label="Actions in this period" />
            </Panel>
          </div>

          {!eventId && (
            <div style={{ marginTop: 16 }}>
              <Panel flush icon={Ticket} title="Behaviour by event" badge={`${data.byEvent.length} events`} sub="People (not clicks) at each step of each event. Click an event to filter the whole page to it.">
                {data.byEvent.length === 0 ? <p className="tl-empty-row">No event activity in this period.</p> : (
                  <div className="tl-stb-wrap">
                    <table className="tl-stb">
                      <thead><tr><th>Event</th><th className="is-right">Page views</th><th className="is-right">People</th><th className="is-right">Chose seat</th><th className="is-right">Checkout</th><th className="is-right">Left checkout</th><th className="is-right">Bought</th><th className="is-right">Conversion</th></tr></thead>
                      <tbody>
                        {data.byEvent.map((e) => (
                          <tr key={e.eventId} className="tl-row-link" onClick={() => setEventId(e.eventId)} tabIndex={0} onKeyDown={(k) => { if (k.key === 'Enter') setEventId(e.eventId); }}>
                            <td><strong>{e.name}</strong>{e.city && <div className="tl-who-mail">{e.city}</div>}</td>
                            <td className="is-right">{n(e.views)}</td>
                            <td className="is-right">{n(e.viewers)}</td>
                            <td className="is-right">{n(e.choseSeat)}</td>
                            <td className="is-right">{n(e.startedCheckout)}</td>
                            <td className="is-right">{n(e.leftCheckout)}</td>
                            <td className="is-right"><b>{n(e.bought)}</b></td>
                            <td className="is-right">{e.conversionPct == null ? '—' : `${e.conversionPct}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Panel flush icon={User} title={eventName ? `Customers on ${eventName}` : 'Customers'} badge={`${customers.length} signed in`} sub="Signed-in people, most recently active first. Guests have no account to list. Click a person for their timeline.">
              {customers.length === 0 ? <p className="tl-empty-row">No signed-in activity in this period.</p> : (
                <>
                  <div className="tl-stb-wrap">
                    <table className="tl-stb">
                      <thead><tr><th>Customer</th><th className="is-right">Events</th><th className="is-right">Views</th><th className="is-right">Seats</th><th className="is-right">Checkouts</th><th className="is-right">Left</th><th className="is-right">Orders</th><th className="is-right">Spent</th><th>Last active</th></tr></thead>
                      <tbody>
                        {rows.map((p) => (
                          <tr key={p.userId} className={`tl-row-link${person?.userId === p.userId ? ' is-selected' : ''}`} onClick={() => setPerson({ userId: p.userId, name: p.name })} tabIndex={0} onKeyDown={(k) => { if (k.key === 'Enter') setPerson({ userId: p.userId, name: p.name }); }}>
                            <td>
                              <div className="tl-who-name">{p.name}</div>
                              <div className="tl-who-mail">{p.email}</div>
                              {p.role !== 'CUSTOMER' && <Badge tone="amber">{String(p.role).replace(/_/g, ' ').toLowerCase()}</Badge>}
                            </td>
                            <td className="is-right">{n(p.events)}</td>
                            <td className="is-right">{n(p.views)}</td>
                            <td className="is-right">{n(p.seats)}</td>
                            <td className="is-right">{n(p.checkouts)}</td>
                            <td className="is-right">{n(p.left)}</td>
                            <td className="is-right"><b>{n(p.orders)}</b></td>
                            <td className="is-right">PKR {n(p.spentPkr)}</td>
                            <td><div>{when(p.lastActive)}</div>{p.lastEvent && <div className="tl-who-mail">{p.lastEvent}</div>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pageSize={PAGE} total={customers.length} onPage={setPage} noun="customers" />
                </>
              )}
            </Panel>
          </div>

          {person && (
            <div style={{ marginTop: 16 }}>
              <Panel
                icon={Clock}
                title={`Timeline: ${person.name}`}
                sub={eventName ? `Everything they did on ${eventName}, newest first.` : 'Everything they did, on every event, newest first (sign-ins left out).'}
                action={<button type="button" className="tl-st-btn tl-st-btn--light tl-st-btn--xs" onClick={() => setPerson(null)}><X className="w-4 h-4" /> Close</button>}
              >
                {!timeline ? <p className="tl-pn-sub">Loading…</p> : timeline.error ? <p className="tl-pn-sub">The timeline could not be loaded.</p> : (
                  <div className="tl-bh-tl">
                    {timeline.orders.length > 0 && (
                      <p className="tl-pn-sub" style={{ marginTop: 0 }}>
                        Orders: {timeline.orders.map((o) => `${o.event || 'Event'}: ${o.status.toLowerCase()}, ${o.tickets} ticket${o.tickets === 1 ? '' : 's'}, PKR ${n(o.amountPkr)}`).join(' · ')}
                      </p>
                    )}
                    {timeline.timeline.length === 0 ? <p className="tl-pn-sub">No activity recorded.</p> : (
                      <ol>
                        {timeline.timeline.slice(0, 100).map((t, i) => (
                          <li key={`${t.at}-${i}`}>
                            <time>{when(t.at)}</time>
                            <b>{t.label}</b>
                            {t.event && <span>{t.event}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
