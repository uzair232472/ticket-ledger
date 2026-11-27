import React, { useEffect, useState } from 'react';
import { FlaskConical, ShieldCheck, Users, LineChart as LineIcon, DoorOpen, TrendingUp, ShoppingCart } from 'lucide-react';
import api from '../../utils/api';
import { Panel } from '../dash/Studio';
import { LineChart } from '../dash/charts';
import {
  bandRows, crowdSeries, evaluationText, experimentalState, fetchInsight, fetchMlFlags, modelLine, num, pct, reasonText,
} from '../../lib/mlInsights';
import './ml.css';

/*
 * Step 6 panels (each also takes `data` directly, for offline render tests). The rule figures (what the app uses) come first; the experimental model's aggregates sit in a
 * muted, collapsible box labelled "not used for any decision". Each panel hides itself when insights are off or
 * the call fails, and an error inside a panel never breaks the page around it (InsightBoundary).
 */

export class InsightBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.debug('[AI insight] panel hidden after an error:', error?.message); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Loads an insight (null while loading, on failure, or when insights are off). */
export function useInsight(path, params) {
  const [state, setState] = useState({ loading: Boolean(path), data: null });
  const key = path ? `${path}?${JSON.stringify(params || {})}` : '';
  useEffect(() => {
    let live = true;
    if (!path) { setState({ loading: false, data: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    fetchMlFlags(api).then((f) => (f.insights ? fetchInsight(api, path, params) : null)).then((data) => { if (live) setState({ loading: false, data }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export const RuleTag = () => <span className="tl-ml-tag tl-ml-tag--rule"><ShieldCheck className="w-3 h-3" aria-hidden="true" />Rules decide</span>;
export const ExperimentalTag = () => <span className="tl-ml-tag"><FlaskConical className="w-3 h-3" aria-hidden="true" />Experimental</span>;

export function Figures({ items }) {
  return (
    <dl className="tl-ml-grid">
      {items.filter(Boolean).map(([label, value]) => (
        <div key={label} className="tl-ml-fig"><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function Bands({ bands, label }) {
  const rows = bandRows(bands);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="tl-ml-bands" role="img" aria-label={`${label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}>
      {rows.map((r) => (
        <div key={r.label} className="tl-ml-band"><span>{r.label}</span><i style={{ width: `${(r.value / max) * 100}%` }} /><b>{num(r.value)}</b></div>
      ))}
    </div>
  );
}

export function EvaluationLine({ evaluation }) {
  const text = evaluationText(evaluation);
  if (!text) return null;
  return <p className="tl-ml-eval">{text} No accuracy figure is shown until real outcomes are evaluated offline.</p>;
}

/** The muted experimental box. `children` render only when there are aggregates to show. */
export function ExperimentalBlock({ experimental, evaluation, children, open = false }) {
  const st = experimentalState(experimental);
  if (st.kind === 'none') return null;
  return (
    <details className="tl-ml-x" open={open}>
      <summary><ExperimentalTag /> <span>Shadow model view: not used for any decision</span></summary>
      <div className="tl-ml-x-body">
        <p className="tl-ml-x-line">{modelLine(experimental)}</p>
        {experimental?.offline_note && <p className="tl-ml-x-line">{experimental.offline_note}</p>}
        {st.text && <p>{st.text}</p>}
        {st.kind === 'value' && children}
        <EvaluationLine evaluation={evaluation} />
      </div>
    </details>
  );
}

const shadowFigures = (v) => [
  ['Scored by model', num(v?.predicted)],
  ['Skipped (missing inputs)', num(v?.skipped)],
  ['Failed calls', num(v?.errors)],
];

// ---------------------------------------------------------------------------------------------
// A. Purchase intent
// ---------------------------------------------------------------------------------------------
export function IntentInsightPanel({ eventId, data: given }) {
  const loaded = useInsight(!given && eventId ? `/ml/insights/events/${eventId}/intent` : null);
  const data = given ?? loaded.data;
  if (!data) return null;
  const r = data.rules;
  const v = data.experimental?.value;
  return (
    <Panel icon={TrendingUp} title="Visit scoring summary" sub="Totals only. No individual customer's score is shown here." action={<RuleTag />}>
      <Figures items={[['Visits scored', num(r.visits_scored)], ['High (rule)', num(r.by_level?.HIGH)], ['Moderate (rule)', num(r.by_level?.MODERATE)], ['Low (rule)', num(r.by_level?.LOW)]]} />
      <p className="tl-pn-sub" style={{ marginTop: 8 }}>Rule: {r.rule}.</p>
      <p className="tl-pn-sub" style={{ marginTop: 4 }}>
        Different source from the cards above: this box counts single VISITS (one sitting, ended after 30 minutes idle) by
        signed-in people, scored by a background job every 15 minutes, which looks back 48 hours. Older activity and
        guests are not scored here{!r.visits_scored ? ', which is why it can show 0 while the funnel shows people' : ''}.
      </p>
      <ExperimentalBlock experimental={data.experimental} evaluation={data.evaluation}>
        <Figures items={[...shadowFigures(v), ['Average probability', pct(v?.mean_probability)], v?.same_direction_as_rule && ['Points the same way as the rule', pct(v.same_direction_as_rule.share)]]} />
        <Bands bands={v?.probability_bands} label="Model purchase probability" />
      </ExperimentalBlock>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// B. Abandoned checkout
// ---------------------------------------------------------------------------------------------
export function AbandonmentInsightPanel({ eventId, data: given }) {
  const loaded = useInsight(!given && eventId ? `/ml/insights/events/${eventId}/abandonment` : null);
  const data = given ?? loaded.data;
  if (!data) return null;
  const r = data.rules;
  const v = data.experimental?.value;
  return (
    <Panel icon={ShoppingCart} title="Checkout scoring summary" sub="Totals for this event. Reminders are only ever sent by you or the existing recovery rules." action={<RuleTag />}>
      <Figures items={[['Checkout visits scored', num(r.checkout_visits_scored)], ['Checkouts logged', num(r.checkout_snapshots)], ['Ended unpaid', num(r.checkout_outcomes?.abandoned)], ['Completed', num(r.checkout_outcomes?.completed)]]} />
      <ExperimentalBlock experimental={data.experimental} evaluation={data.evaluation}>
        <Figures items={[...shadowFigures(v), ['Average abandon probability', pct(v?.mean_probability)]]} />
        <Bands bands={v?.probability_bands} label="Model abandonment probability" />
      </ExperimentalBlock>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// F. Demand (with the organizer's what-if price; never saved, never applied)
// ---------------------------------------------------------------------------------------------
/** The 80% range on a 0..capacity track, the model's forecast and the rule's estimate. Numbers are also shown as text. */
function RangeBand({ current, rule }) {
  const cap = Number(current.capacity) || Math.max(current.high || 0, rule || 0, 1);
  const at = (v) => `${Math.max(0, Math.min(100, (Number(v) / cap) * 100))}%`;
  const cov = current.range_offline_coverage;
  return (
    <div className="tl-ml-range" aria-label={`80% range ${num(current.low)} to ${num(current.high)} of ${num(cap)} seats; forecast ${num(current.sales_48h)}; rule ${num(rule)}`} role="img">
      <div className="tl-ml-range-track">
        <span className="tl-ml-range-band" style={{ left: at(current.low), width: `calc(${at(current.high)} - ${at(current.low)})` }} />
        <span className="tl-ml-range-pt" style={{ left: at(current.sales_48h) }} title={`Model ${num(current.sales_48h)}`} />
        {Number.isFinite(rule) && <span className="tl-ml-range-rule" style={{ left: at(rule) }} title={`Rule ${num(rule)}`} />}
      </div>
      <div className="tl-ml-range-axis"><span>0</span><span>{num(cap)} seats</span></div>
      <p className="tl-pn-sub" style={{ margin: '4px 0 0' }}>
        <i className="tl-ml-range-key tl-ml-range-key--band" /> 80% range · <i className="tl-ml-range-key tl-ml-range-key--pt" /> model · <i className="tl-ml-range-key tl-ml-range-key--rule" /> rule.
        {Number.isFinite(cov) ? ` In the offline test this range held the real 48-hour sales ${Math.round(cov * 100)}% of the time.` : ''}
      </p>
    </div>
  );
}

export function DemandInsightPanel({ eventId, price, data: given }) {
  const [debounced, setDebounced] = useState(price);
  useEffect(() => { const t = setTimeout(() => setDebounced(price), 600); return () => clearTimeout(t); }, [price]);
  const loaded = useInsight(!given && eventId ? `/ml/insights/events/${eventId}/demand` : null, debounced ? { price: debounced } : undefined);
  const data = given ?? loaded.data;
  if (!data) return null;
  const v = data.experimental?.value;
  const w = v?.what_if;
  return (
    <Panel icon={LineIcon} title="Experimental demand model" sub="Shown next to the rule estimate for comparison only. It never changes prices or publishes anything." action={<ExperimentalTag />}>
      {data.rules.latest_hourly_pace && <p className="tl-pn-sub" style={{ marginTop: 0 }}>Sold in the last 24 hours (logged {new Date(data.rules.latest_hourly_pace.as_of).toLocaleString()}): <b>{num(data.rules.latest_hourly_pace.sold_last_24h)}</b></p>}
      <ExperimentalBlock experimental={data.experimental} evaluation={data.evaluation} open>
        {v?.current && (
          <>
            <p>Model reading now, at the saved prices (live call, not saved, not applied):</p>
            <Figures items={[['Model: first 48 h', num(v.current.sales_48h)], ['Range low', num(v.current.low)], ['Range high', num(v.current.high)], ['Rule estimate', num(data.rules.projected_48h_sales)]]} />
            <RangeBand current={v.current} rule={data.rules.projected_48h_sales} />
            {v.current.reasons?.length > 0 && (
              <>
                <p style={{ marginTop: 10 }}>Why the model says this (each input compared with a typical event):</p>
                <ul className="tl-ml-sens">
                  {v.current.reasons.map((r) => (
                    <li key={r.feature}><span>{r.label}: {String(r.value)} <em className="tl-pn-sub">(typical {String(r.typical)})</em></span><b className={r.effect > 0 ? 'up' : 'down'}>{r.effect > 0 ? '+' : ''}{num(r.effect)} tickets</b></li>
                  ))}
                </ul>
                <p className="tl-pn-sub">One input at a time: the effects do not add up to the forecast.</p>
              </>
            )}
          </>
        )}
        {v?.sensitivity?.length > 0 && (
          <>
            <p style={{ marginTop: 10 }}>What moves the model&apos;s number (same event, one input changed):</p>
            <ul className="tl-ml-sens">
              {v.sensitivity.map((s) => (
                <li key={s.key}><span>{s.label}</span><b className={s.change > 0 ? 'up' : s.change < 0 ? 'down' : ''}>{s.change > 0 ? '+' : ''}{num(s.change)} tickets</b></li>
              ))}
            </ul>
          </>
        )}
        {v?.latest_logged && <><p style={{ marginTop: 10 }}>Last logged prediction ({new Date(v.latest_logged.as_of).toLocaleDateString()}):</p><Figures items={[['Model: first 48 h', num(v.latest_logged.sales_48h)], ['Range low', num(v.latest_logged.low)], ['Range high', num(v.latest_logged.high)]]} /></>}
        {w && (w.unavailable_reason
          ? <p>What-if: {reasonText(w.unavailable_reason)}</p>
          : <><p>What-if at your edited average price (not saved, not applied):</p><Figures items={[['Model: first 48 h', num(w.sales_48h)], ['Range low', num(w.low)], ['Range high', num(w.high)]]} /></>)}
      </ExperimentalBlock>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// G. Attendance
// ---------------------------------------------------------------------------------------------
export function AttendanceInsightPanel({ eventId, data: given }) {
  const loaded = useInsight(!given && eventId ? `/ml/insights/events/${eventId}/attendance` : null);
  const data = given ?? loaded.data;
  if (!data) return null;
  const r = data.rules;
  return (
    <Panel icon={Users} title="Expected attendance" sub={`Rule: ${r.show_rate_percent}% show rate (${String(r.basis).replace(/_/g, ' ').toLowerCase()}). Gate admission never uses this estimate.`} action={<RuleTag />}>
      <Figures items={[['Tickets', num(r.live_tickets)], ['Expected to attend', num(r.expected_attendance)], ['Checked in so far', num(r.checked_in_so_far)], r.snapshot_24h_before?.actual_attended != null && ['Attended (final)', num(r.snapshot_24h_before.actual_attended)]]} />
      {(r.factors || []).length > 0 && <p className="tl-pn-sub" style={{ marginTop: 8 }}>{r.factors.join(' ')}</p>}
      <ExperimentalBlock experimental={data.experimental} evaluation={data.evaluation} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// H. Crowd flow
// ---------------------------------------------------------------------------------------------
const CROWD_COLORS = { rule: 'var(--ds-s1)', actual: 'var(--ds-s3)', model: 'var(--ds-s4)' };
export function CrowdInsightPanel({ eventId, data: given, chart = null }) {
  const loaded = useInsight(!given && eventId ? `/ml/insights/events/${eventId}/crowd` : null);
  const data = given ?? loaded.data;
  if (!data) return null;
  const r = data.rules;
  const showModel = experimentalState(data.experimental).kind === 'value';
  return (
    <Panel icon={DoorOpen} title="Expected arrivals per gate" sub="Scans per 5 minutes around the start. The scanner, admission and staffing never use these numbers." action={<RuleTag />}>
      {!r.readiness?.ready && <p className="tl-pn-sub">Not available: {r.readiness?.reason === 'GATE_CAPACITY_MISSING' ? `set a capacity per hour on ${r.readiness.missingCapacity.join(', ')}` : 'add at least one active gate'}.</p>}
      {r.gates.length === 0 && r.readiness?.ready && <p className="tl-pn-sub">The estimate appears from 26 hours before the start.</p>}
      {chart}
      {(() => {
        const perGate = r.gates.map((g) => {
          const { labels, series } = crowdSeries(g, { showModel });
          if (!series.length) return null;
          return (
            <div key={g.gate_id} style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 6px' }}>{g.gate}</h3>
              <LineChart labels={labels} series={series.map((s) => ({ label: s.key === 'model' ? 'Experimental model (not used)' : s.label, color: CROWD_COLORS[s.key], values: s.values }))} height={170} label={`Arrivals at ${g.gate}`} />
            </div>
          );
        });
        // With the crowd-flow chart above, the small per-gate charts stay available, folded away
        return chart ? <details className="tl-mc-table"><summary>Small chart per gate</summary>{perGate}</details> : perGate;
      })()}
      <ExperimentalBlock experimental={data.experimental} evaluation={data.evaluation}>
        <Figures items={shadowFigures(data.experimental?.value)} />
      </ExperimentalBlock>
    </Panel>
  );
}
