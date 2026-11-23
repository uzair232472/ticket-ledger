import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, StudioSelect, StatCard, Panel, Badge, ScoreBar } from '../components/dash/Studio';
import { DemandInsightPanel, InsightBoundary } from '../components/ml/InsightPanels';
import { whatIfPrice } from '../lib/mlInsights';
import {
  Users,
  MapPin,
  CalendarDays,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  Lightbulb,
  AlertTriangle,
  Clock,
  SlidersHorizontal,
  Send,
  Check,
  Info,
  Banknote,
  Gauge,
  BadgeCheck,
  ArrowLeft,
  ListChecks,
  Target,
} from 'lucide-react';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const PRICE_MIN = 500;
const PRICE_MAX = 25000;
const PREVIEW_DELAY_MS = 250; // wait for the slider to settle before asking the server
const LIVE = ['PUBLISHED', 'PAUSED'];
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

export default function DemandForecast() {
  const { eventId: paramEventId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  const [organizerEvents, setOrganizerEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(paramEventId || searchParams.get('eventId') || '');
  // New-event setup (step 3 → forecast → step 4 seating): the save button continues to the seating plan
  const setup = searchParams.get('setup') === '1';

  const [eventDetails, setEventDetails] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [savedTiers, setSavedTiers] = useState([]); // the event's stored prices (the what-if compares against them)
  const [forecast, setForecast] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const [error, setError] = useState('');
  const [confirmSold, setConfirmSold] = useState(false); // inline confirmation before changing prices of a live event
  const request = useRef({ seq: 0, controller: null, timer: null });

  // 1. The organizer's own events only (Super Admins see every event)
  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch(`${API_BASE}/events/organizer/my-events`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json = await res.json();
        if (json.success && json.data.events.length > 0) {
          setOrganizerEvents(json.data.events);
          if (!selectedEventId) setSelectedEventId(json.data.events[0].id);
        }
      } catch (err) {
        console.error('Failed to load organizer events:', err);
      }
    }
    fetchEvents();
  }, [token]);

  // 2. Forecast for the selected event. customTiers = unsaved price edits (sent per tier, never saved).
  // Only the newest request may update the page: older ones are cancelled, and a late answer is ignored,
  // so the cards always match the sliders.
  const fetchPreLaunchForecast = async (eventId, customTiers = null) => {
    if (!eventId) return;
    const r = request.current;
    r.controller?.abort();
    const controller = new AbortController();
    const seq = ++r.seq;
    r.controller = controller;
    setRecalculating(true);
    setError('');
    try {
      const queryParams = new URLSearchParams();
      if (customTiers?.length) queryParams.set('tierPrices', customTiers.map((t) => `${t.id}:${Number(t.price)}`).join(','));

      const res = await fetch(`${API_BASE}/events/${eventId}/prelaunch-forecast?${queryParams.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      const json = await res.json();
      if (seq !== r.seq) return; // a newer request has started
      if (res.ok && json.success) {
        setForecast(json.data);
        setEventDetails(json.data);
        if (!customTiers) { setTiers(json.data.tiers || []); setSavedTiers(json.data.tiers || []); }
      } else {
        // No stand-in forecast: a generic one built from made-up inputs would look like this event's
        setForecast(null);
        setError(json.message || 'The forecast for this event is not available right now.');
      }
    } catch (err) {
      if (err.name === 'AbortError' || seq !== r.seq) return;
      console.error('Error fetching prelaunch forecast:', err);
      setError(err.message || 'Failed to load pre-launch forecast');
    } finally {
      if (seq === r.seq) setRecalculating(false);
    }
  };

  useEffect(() => {
    // A new event starts from its own saved prices (never the previous event's edits)
    setTiers([]); setSavedTiers([]); setConfirmSold(false);
    if (selectedEventId) fetchPreLaunchForecast(selectedEventId);
    return () => { clearTimeout(request.current.timer); request.current.controller?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  // 3. Live price edits: the slider moves at once; the estimate follows once it settles
  const handlePriceChange = (tierId, newPrice) => {
    const updated = tiers.map((t) => (t.id === tierId ? { ...t, price: Number(newPrice) } : t));
    setTiers(updated);
    setConfirmSold(false);
    clearTimeout(request.current.timer);
    request.current.timer = setTimeout(() => fetchPreLaunchForecast(selectedEventId, updated), PREVIEW_DELAY_MS);
  };

  // 4. Save prices
  const handleSavePrices = async () => {
    setSavingPrices(true);
    setSuccessMessage(null);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/events/${selectedEventId}/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tiers: tiers.map((t) => ({ id: t.id, price: Number(t.price) })) }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setSavedTiers(tiers);
        setConfirmSold(false);
        setSuccessMessage('Ticket prices saved.');
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setError(json.message || 'Failed to update pricing');
      }
    } catch (err) {
      setError(`Error saving prices: ${err.message}`);
    } finally {
      setSavingPrices(false);
    }
  };

  // 5. Save prices and publish
  const handlePublishEvent = async () => {
    setPublishing(true);
    setSuccessMessage(null);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/events/${selectedEventId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tiers: tiers.map((t) => ({ id: t.id, price: Number(t.price) })) }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        if (setup || !['PUBLISHED', 'PAUSED'].includes(json.data.event.status)) {
          // Prices saved; the event goes on sale only after seating and admin approval
          navigate(`/organizer/events/${selectedEventId}/venue?setup=1`);
          return;
        }
        setSavedTiers(tiers);
        setConfirmSold(false);
        setSuccessMessage(json.message || `Prices for "${json.data.event.name}" are saved.`);
        setTimeout(() => setSuccessMessage(null), 6000);
      } else {
        setError(json.message || 'Failed to save prices');
      }
    } catch (err) {
      setError(`Error saving prices: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const sales48 = forecast?.projected_48h_sales ?? forecast?.predicted_48h_sales;
  const sellout = Math.min(100, Math.round((forecast?.sellout_probability || 0) * 100));
  const revenue = forecast?.projected_revenue_pkr || forecast?.expected_revenue_pkr || 0;
  const demand = forecast?.demand_level || forecast?.demand_tier || '—';
  const actuals = forecast?.actuals;
  const live = LIVE.includes(eventDetails?.status) && !setup;
  // Tickets already sold in tiers whose price is being changed (live events): asked to confirm first
  const changedSold = tiers.filter((t) => {
    const o = savedTiers.find((x) => x.id === t.id);
    return o && Number(o.price) !== Number(t.price) && (t.sold || 0) > 0;
  });
  const soldInChanged = changedSold.reduce((a, t) => a + (t.sold || 0), 0);
  const unsaved = whatIfPrice(savedTiers, tiers) != null;
  const saveLive = () => (soldInChanged > 0 && !confirmSold ? setConfirmSold(true) : handlePublishEvent());
  const warning = forecast?.pricing_warning;
  const warn = warning?.severity === 'amber';
  const status = eventDetails?.status;
  const source = forecast?.prediction_source;
  const synthetic = source === 'synthetic-demo-model';
  // Step 6: the experimental model's what-if uses the edited average price; it is never saved or applied
  const experimentPrice = whatIfPrice(savedTiers, tiers);

  return (
    <div>
      <StudioHead
        crumbs={['Insights', 'Pre-launch']}
        title="Demand forecast"
        intro="A rule-based estimate of first-48-hour sales and revenue for this event, an experimental AI model next to it, and real sales once the event is on sale. Editing a price only previews the estimate: nothing changes until you save."
        controls={
          // New-event setup came from step 3 (tickets & pricing); otherwise back to the event's dashboard
          setup && selectedEventId ? (
            <Link to={`/organizer/events/${selectedEventId}/edit?step=3`} className="tl-st-btn tl-st-btn--light">
              <ArrowLeft className="w-4 h-4" /> Back: Tickets &amp; pricing
            </Link>
          ) : (
            <Link to={`/organizer/dashboard${selectedEventId ? `?eventId=${selectedEventId}` : ''}`} className="tl-st-btn tl-st-btn--light">
              <ArrowLeft className="w-4 h-4" /> Back to dashboard
            </Link>
          )
        }
      />

      {/* Where this estimate comes from: never presented as a validated real-world prediction */}
      {forecast && (
        <div
          role="note"
          className={`tl-df-card ${synthetic ? 'border-amber-300 bg-amber-50' : ''}`}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px' }}
        >
          {synthetic ? <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" /> : <Info className="w-4 h-4 text-slate-500" aria-hidden="true" />}
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{synthetic ? 'Demonstration model (synthetic data, not validated).' : source === 'rules' ? 'Rule-based estimate.' : 'Unverified estimate.'}</strong>{' '}
            {forecast.prediction_notice || 'This is not a validated real-world prediction.'}
          </p>
        </div>
      )}

      {/* Event picker + facts */}
      <div className="tl-df-card">
        <div className="tl-df-pick">
          <StudioSelect
            icon={CalendarDays}
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              navigate(`/demand-forecast?eventId=${e.target.value}`);
            }}
            label="Event"
          >
            {organizerEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.city}){ev.status ? ` · ${ev.status.replace(/_/g, ' ').toLowerCase()}` : ''}
              </option>
            ))}
          </StudioSelect>
          <button type="button" className="tl-st-icon-btn" onClick={() => fetchPreLaunchForecast(selectedEventId)} aria-label="Refresh forecast" disabled={recalculating}>
            <RefreshCw className={`w-4 h-4 ${recalculating ? 'tl-dash-spin' : ''}`} />
          </button>
        </div>
        {eventDetails && (
          <div className="tl-df-meta">
            <span><MapPin className="w-4 h-4" aria-hidden="true" />{eventDetails.venue ? `${eventDetails.venue}, ` : ''}{eventDetails.city}</span>
            {eventDetails.eventDate && (
              <span><CalendarDays className="w-4 h-4" aria-hidden="true" />{new Date(eventDetails.eventDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            )}
            {eventDetails.venueCapacity != null && <span><Users className="w-4 h-4" aria-hidden="true" />Capacity: {eventDetails.venueCapacity.toLocaleString()}</span>}
            {status && <Badge tone={status === 'PUBLISHED' ? 'green' : 'amber'}>Status: {status.replace(/_/g, ' ')}</Badge>}
          </div>
        )}
      </div>

      {successMessage && <div style={{ marginTop: 14 }}><Notice tone="good" icon={CheckCircle2} onDismiss={() => setSuccessMessage(null)}>{successMessage}</Notice></div>}
      {error && <div style={{ marginTop: 14 }}><Notice tone="bad" icon={AlertTriangle} onDismiss={() => setError('')}>{error}</Notice></div>}

      <h2 className="tl-df-section">Forecast overview{forecast?.what_if && <span className="tl-df-preview"> · preview at your edited prices (not saved)</span>}</h2>
      <div className="tl-sc-grid tl-sc-grid--3">
        <StatCard icon={BarChart3} iconSide="right" tone="ink" label="Estimated 48-hour sales (rule)" value={sales48 != null ? sales48.toLocaleString() : '—'} unit="tickets">
          <div className="tl-sc-meter">
            <div><span>Share of {num(forecast?.venueCapacity)} tickets</span><strong>{sellout}%</strong></div>
            <ScoreBar value={sellout} />
          </div>
        </StatCard>
        <StatCard
          icon={Banknote}
          iconSide="right"
          tone="green"
          label="Expected gross revenue (rule)"
          value={`PKR ${revenue.toLocaleString()}`}
          note={`Each tier sells the same share of its own tickets; average ticket PKR ${num(forecast?.avgTicketPrice)} (weighted by quantity)`}
        />
        <StatCard
          icon={Gauge}
          iconSide="right"
          tone="ink"
          label="Demand level (rule)"
          value={demand.replace(/_/g, ' ')}
          extra={<Badge tone="grey" icon={BadgeCheck}>Rule</Badge>}
          note={`This event: ${sellout}% of tickets in 48 h. Scale: under 30% low · 30%+ moderate · 45%+ high · 60%+ very high`}
        />
      </div>

      {forecast?.factors?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel icon={ListChecks} title="Why this estimate" sub="Every factor the rule used for this event. A factor above 1 raises the estimate; below 1 lowers it.">
            {forecast.formula && (
              <p className="tl-df-formula">
                <span>Calculation</span>
                <code>{forecast.formula}</code>
                <small>Higher prices give a lower price factor, so a lower share and a lower demand level. Lower prices do the opposite.</small>
              </p>
            )}
            <ul className="tl-df-factors">
              {forecast.factors.map((f) => (
                <li key={f.key}>
                  <b>{f.label}</b>
                  <span className={f.key === 'category' ? '' : f.effect > 1 ? 'up' : f.effect < 1 ? 'down' : ''}>{f.key === 'category' ? `${Math.round(f.effect * 100)}%` : `× ${f.effect}`}</span>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {actuals?.on_sale && (
        <div style={{ marginTop: 16 }}>
          <Panel icon={Target} title="Estimate vs real sales" sub="What actually happened on TicketLedger, next to the rule estimate. Paid, not cancelled tickets.">
            <dl className="tl-df-actuals">
              <div><dt>Rule estimate: first 48 h</dt><dd>{num(sales48)}</dd></div>
              <div><dt>{actuals.window_complete ? 'Sold in the first 48 h' : 'Sold so far in the first 48 h (still running)'}</dt><dd>{num(actuals.sold_first_48h)}</dd></div>
              <div><dt>Sold in total</dt><dd>{num(actuals.sold_total)} <small>of {num(forecast?.venueCapacity)}</small></dd></div>
              <div><dt>Revenue so far</dt><dd>PKR {num(actuals.revenue_so_far_pkr)}</dd></div>
            </dl>
            {actuals.window_complete && sales48 > 0 && (
              <p className="tl-pn-sub" style={{ marginTop: 8 }}>
                The rule was {actuals.sold_first_48h >= sales48 ? 'below' : 'above'} real sales by {num(Math.abs(actuals.sold_first_48h - sales48))} tickets
                ({Math.round((Math.abs(actuals.sold_first_48h - sales48) / sales48) * 100)}%). Results like this are logged so the AI model can be compared with the rule.
              </p>
            )}
          </Panel>
        </div>
      )}

      <div className="tl-df-row">
        <Panel icon={SlidersHorizontal} title="Pricing workspace">
          <p className="tl-df-sub">{live ? 'Adjust prices of a live event' : 'Adjust pricing before publishing'}</p>
          <p className="tl-pn-sub" style={{ marginTop: 0, marginBottom: 16 }}>
            Adjust tier prices to preview the rule estimate. Nothing is saved until you press a save button.
          </p>
          <div className="tl-tiers-adj">
            {tiers.length === 0 ? (
              <p className="tl-empty-row">No ticket tiers configured for this event.</p>
            ) : (
              tiers.map((tier) => (
                <div key={tier.id} className="tl-tier-adj">
                  <div>
                    <strong>{tier.name}</strong>
                    <small>Total quantity: <b>{tier.totalQuantity?.toLocaleString()}</b>{tier.sold > 0 && <> · sold <b>{tier.sold.toLocaleString()}</b></>}</small>
                  </div>
                  <div>
                    <div className="tl-range-labels">
                      <span>PKR {PRICE_MIN.toLocaleString()}</span>
                      <b>PKR {Number(tier.price).toLocaleString()}</b>
                      <span>PKR {PRICE_MAX.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min={PRICE_MIN}
                      max={PRICE_MAX}
                      step="250"
                      value={tier.price}
                      onChange={(e) => handlePriceChange(tier.id, e.target.value)}
                      aria-label={`${tier.name} price`}
                    />
                  </div>
                  <label className="tl-price-input">
                    PKR
                    <input
                      type="number"
                      min={PRICE_MIN}
                      max="50000"
                      step="100"
                      value={tier.price}
                      onChange={(e) => handlePriceChange(tier.id, e.target.value)}
                      aria-label={`${tier.name} price in PKR`}
                    />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="tl-df-foot">
            <p><Info className="w-4 h-4" aria-hidden="true" />Drag the sliders or type new prices for each ticket tier. The estimate updates; prices change only when you save.</p>
            {live ? (
              <div>
                <button type="button" className="tl-st-btn tl-st-btn--green" onClick={saveLive} disabled={publishing || tiers.length === 0 || !unsaved}>
                  {publishing ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Check className="w-4 h-4" />} Save new prices
                </button>
              </div>
            ) : (
              <div>
                <button type="button" className="tl-st-btn tl-st-btn--light" onClick={handleSavePrices} disabled={savingPrices || tiers.length === 0}>
                  {savingPrices ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Check className="w-4 h-4" />} Save prices (stay here)
                </button>
                <button type="button" className="tl-st-btn tl-st-btn--green" onClick={handlePublishEvent} disabled={publishing || tiers.length === 0}>
                  {publishing ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Send className="w-4 h-4" />} Save &amp; continue to seating
                </button>
              </div>
            )}
          </div>
          {live && confirmSold && (
            <div className="tl-df-confirm" role="alert">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <div>
                <strong>{soldInChanged.toLocaleString()} ticket{soldInChanged === 1 ? ' was' : 's were'} already sold in {changedSold.map((t) => t.name).join(', ')}.</strong>
                <p>Those buyers keep the price they paid; only new sales use the new price. Buyers who paid more may ask why.</p>
                <div>
                  <button type="button" className="tl-st-btn tl-st-btn--light" onClick={() => setConfirmSold(false)}>Cancel</button>
                  <button type="button" className="tl-st-btn tl-st-btn--green" onClick={handlePublishEvent} disabled={publishing}>Yes, save new prices</button>
                </div>
              </div>
            </div>
          )}
        </Panel>

        <div className="tl-df-side">
          <section className="tl-pn tl-pn--mint">
            <p className="tl-df-kicker"><Clock className="w-4 h-4" aria-hidden="true" /> {forecast?.already_published ? 'Publish time' : 'Suggested publish time window'}</p>
            <p className="tl-df-time">{forecast?.suggested_publish_time || '—'}</p>
            <p className="tl-df-text">{forecast?.suggested_window_reason || 'No suggestion available.'}</p>
            <div className="tl-df-tip">
              <Lightbulb className="w-4 h-4" aria-hidden="true" />
              <span>{forecast?.already_published ? 'The event is live: use the real sales above to judge demand.' : 'A rule of thumb, not a measured result. You choose when to publish.'}</span>
            </div>
          </section>

          <section className={`tl-pn ${warn ? 'tl-pn--warn' : 'tl-pn--mint'}`}>
            <p className="tl-df-kicker"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> {warning?.title || 'Price note'}</p>
            <p className="tl-df-text">
              {warning?.message || 'No price note.'}
            </p>
            {(warning?.recommendation || forecast?.pricing_recommendation) && (
              <div className="tl-df-advice">
                <strong>Rule-of-thumb note</strong>
                {warning?.recommendation || forecast?.pricing_recommendation}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Step 6: experimental (shadow) demand model, display-only; its what-if is never saved or applied */}
      <InsightBoundary><div style={{ marginTop: 16 }}><DemandInsightPanel eventId={selectedEventId} price={experimentPrice} /></div></InsightBoundary>
    </div>
  );
}
