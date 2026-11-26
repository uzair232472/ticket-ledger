import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Cpu, FlaskConical, Gauge, Link2, RefreshCw, ShieldCheck, Waves, XCircle } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, StatCard, Panel, Badge, UnderlineTabs } from '../components/dash/Studio';
import { InsightBoundary, RuleTag } from '../components/ml/InsightPanels';
import { BarList, CalibrationChart, Legend, LineChart, SERIES } from '../components/ml/charts';
import '../components/ml/ml.css';

/*
 * Model card (SUPER_ADMIN): one shadow model in depth. Everything on the left of the page is the OFFLINE test
 * (newest 15% of the history, never seen in training): model vs the current rule over time, calibration, which
 * inputs matter, worked examples with reasons, the must-not-get-worse checks. The drift panel is LIVE but looks at
 * inputs only. No accuracy is computed from live traffic, and nothing here changes a decision.
 */
const MODELS = [
  ['intent', 'Purchase intent'], ['abandonment', 'Abandoned visit'], ['checkout_abandonment', 'Abandoned checkout'], ['fraud', 'Fraud'],
  ['demand', 'Demand (48 h)'], ['demand_hourly', 'Demand (hourly)'], ['attendance', 'Attendance'], ['crowd', 'Crowd flow'],
];
const isShare = (m) => /share|precision|%|rate/i.test(m || '');
const fmt = (v, m) => (v == null || !Number.isFinite(Number(v)) ? '—' : isShare(m) ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toFixed(1));
const day = (s) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const DRIFT_TONE = { STABLE: 'green', WATCH: 'amber', DRIFT: 'rose' };
const DRIFT_ICON = { STABLE: CheckCircle2, WATCH: AlertTriangle, DRIFT: XCircle };

function StatusBadge({ status }) {
  const Icon = DRIFT_ICON[status] || AlertTriangle;
  return <Badge tone={DRIFT_TONE[status] || 'grey'} icon={Icon}>{status ? status.replace(/_/g, ' ').toLowerCase() : 'unknown'}</Badge>;
}

function OverTime({ card }) {
  const slices = card.diagnostics?.over_time || [];
  if (!slices.length) return null;
  const m = card.main_measure;
  return (
    <Panel icon={Gauge} title="AI vs rule across the test period" sub={`${m} (${card.higher_is_better ? 'higher' : 'lower'} is better), in ${slices.length} consecutive slices of the newest, unseen data.`}>
      <Legend items={[{ name: 'AI model', color: SERIES.model }, { name: 'Current rule', color: SERIES.rule }]} />
      <LineChart
        ariaLabel={`${m}: AI model against the current rule over the test period`}
        labels={slices.map((s) => `${day(s.from)}–${day(s.to)}`)}
        series={[{ key: 'model', name: 'AI model', color: SERIES.model, values: slices.map((s) => s.model) }, { key: 'rule', name: 'Current rule', color: SERIES.rule, values: slices.map((s) => s.rule) }]}
        format={(v) => fmt(v, m)}
      />
      <details className="tl-mc-table"><summary>Show as a table</summary>
        <table className="tl-ml-table"><thead><tr><th>Slice</th><th className="num">Rows</th><th className="num">AI model</th><th className="num">Rule</th>{slices[0].range_coverage !== undefined && <th className="num">Range held</th>}</tr></thead>
          <tbody>{slices.map((s) => <tr key={s.from}><td>{day(s.from)}–{day(s.to)}</td><td className="num">{s.rows.toLocaleString()}</td><td className="num">{fmt(s.model, m)}</td><td className="num">{fmt(s.rule, m)}</td>{s.range_coverage !== undefined && <td className="num">{(s.range_coverage * 100).toFixed(0)}%</td>}</tr>)}</tbody>
        </table>
      </details>
    </Panel>
  );
}

function Reasons({ reasons, unit = 'pts' }) {
  if (!reasons?.length) return <span className="tl-pn-sub">No reasons logged.</span>;
  return (
    <ul className="tl-mc-reasons">
      {reasons.map((r) => (
        <li key={r.feature} data-dir={r.direction}>
          <b>{r.direction === 'up' ? '▲' : '▼'} {r.label}</b>
          <span>{String(r.value)} <em>(typical {String(r.typical)})</em></span>
          <span className="tl-mc-eff">{r.effect > 0 ? '+' : ''}{r.effect} {unit}</span>
        </li>
      ))}
    </ul>
  );
}

function LinkAblation({ card }) {
  const w = card.diagnostics?.without_link_features;
  if (!w) return null;
  const d = card.details || {};
  const mf = d.model_flags || {};
  const rows = [
    ['Share of flags that are fraud (precision)', w.precision, card.result?.model, w.rule_precision],
    ['Share of frauds caught (recall)', w.recall, mf.recall, d.rule_flags?.recall],
    ['False flags among legitimate orders', w.false_flag_rate, mf.false_flag_rate, d.rule_flags?.false_flag_rate],
  ];
  const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
  return (
    <Panel icon={Link2} title="What the account links add" sub="The same pipeline trained with and without the three account-link inputs (shared phone number or browser). Same test rows.">
      <table className="tl-ml-table">
        <thead><tr><th>Measure</th><th className="num">Without links</th><th className="num">With links</th><th className="num">Current rule</th></tr></thead>
        <tbody>{rows.map(([label, a, b, r]) => <tr key={label}><td>{label}</td><td className="num">{pct(a)}</td><td className="num"><b>{pct(b)}</b></td><td className="num">{pct(r)}</td></tr>)}</tbody>
      </table>
      <p className="tl-pn-sub" style={{ marginTop: 8 }}>Synthetic data: the generator assumes bot rings often share phones and browsers, so this gain is partly built in. The real gain can only be measured on blind-reviewed real orders.</p>
    </Panel>
  );
}

const pctx = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`);
const GROUP_LABEL = { city: 'City', event_type: 'Event type', payment_method: 'Payment method', customer_history: 'Customer history' };

function Fairness({ card }) {
  const f = card.diagnostics?.fairness;
  if (!f) return null;
  const fraud = card.model === 'fraud';
  const binary = card.kind === 'binary';
  return (
    <Panel icon={ShieldCheck} title="Fairness check" sub={`The same test rows split by group. Flagged when: ${f.rule}.`} action={f.watch.length ? <Badge tone="amber" icon={AlertTriangle}>{f.watch.length} to review</Badge> : <Badge tone="green" icon={CheckCircle2}>none flagged</Badge>}>
      {Object.entries(f.groups).map(([g, vals]) => (
        <details key={g} className="tl-mc-table" open={Object.values(vals).some((r) => r.watch)}>
          <summary>{GROUP_LABEL[g] || g} ({Object.keys(vals).length})</summary>
          <div className="tl-ml-scroll">
            <table className="tl-ml-table">
              <thead><tr><th>Group</th><th className="num">Rows</th>
                {fraud ? <><th className="num">False flags (AI)</th><th className="num">False flags (rule)</th><th className="num">Frauds caught (AI)</th></>
                  : binary ? <><th className="num">Predicted</th><th className="num">Actual</th><th className="num">AUC</th></>
                    : <><th className="num">AI error</th><th className="num">Rule error</th></>}
                <th>Status</th></tr></thead>
              <tbody>{Object.entries(vals).map(([v, r]) => (
                <tr key={v}><td>{v.replace(/_/g, ' ')}</td><td className="num">{r.rows.toLocaleString()}</td>
                  {r.note ? <td colSpan={fraud || binary ? 3 : 2} className="tl-pn-sub">{r.note}</td>
                    : fraud ? <><td className="num">{pctx(r.false_flag_rate, 2)}</td><td className="num">{pctx(r.rule_false_flag_rate, 2)}</td><td className="num">{pctx(r.recall)}</td></>
                      : binary ? <><td className="num">{pctx(r.predicted_rate)}</td><td className="num">{pctx(r.actual_rate)}</td><td className="num">{r.auc}</td></>
                        : <><td className="num">{fmt(r.model, card.main_measure)}</td><td className="num">{fmt(r.rule, card.main_measure)}</td></>}
                  <td>{r.note ? '—' : r.watch ? <Badge tone="amber" icon={AlertTriangle}>review</Badge> : <Badge tone="green" icon={CheckCircle2}>ok</Badge>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      ))}
      <p className="tl-pn-sub" style={{ marginTop: 8 }}>{f.note}</p>
    </Panel>
  );
}

function Overload({ card }) {
  const o = card.diagnostics?.overload;
  if (!o) return null;
  return (
    <Panel icon={Gauge} title="Chance a gate goes over capacity" sub={`${o.note} Calibrated on the validation period; each dot is a tenth of the test slots.`}>
      <dl className="tl-ml-grid">
        <div className="tl-ml-fig"><dt>80% range held the real count</dt><dd>{pctx(o.range_coverage)}</dd></div>
        <div className="tl-ml-fig"><dt>Test slots over capacity</dt><dd>{o.slots_over_capacity.toLocaleString()} / {o.slots.toLocaleString()}</dd></div>
      </dl>
      <CalibrationChart bins={o.calibration} />
    </Panel>
  );
}

function PublicData({ pub }) {
  if (!pub?.report) return null;
  const r = pub.report;
  const fraud = pub.experiment === 'credit_card_fraud';
  return (
    <Panel icon={FlaskConical} title="Method check on real public data" sub={r.banner} action={<Badge tone="blue">public data</Badge>}>
      {fraud ? (
        <>
          <table className="tl-ml-table">
            <thead><tr><th>Detector</th><th className="num">Flagged</th><th className="num">Share of flags that are fraud</th><th className="num">Frauds caught</th><th className="num">False flags</th></tr></thead>
            <tbody>
              <tr><td>Model (threshold fixed at 1% false flags)</td><td className="num">{r.model.flagged}</td><td className="num">{pctx(r.model.precision)}</td><td className="num"><b>{pctx(r.model.recall)}</b></td><td className="num">{pctx(r.model.false_flag_rate, 2)}</td></tr>
              <tr><td>{r.rule.rule}</td><td className="num">{r.rule.flagged}</td><td className="num">{pctx(r.rule.precision)}</td><td className="num">{pctx(r.rule.recall)}</td><td className="num">{pctx(r.rule.false_flag_rate, 2)}</td></tr>
            </tbody>
          </table>
          <p className="tl-pn-sub" style={{ marginTop: 8 }}>{r.split.rows.test.toLocaleString()} test transactions, {r.split.frauds.test} frauds (base rate {pctx(r.base_rate, 2)}): the model's flags are {r.model.lift_over_random}x more likely to be fraud than a random transaction. AUC {r.model.test_auc}; 95% interval of the recall gain {pctx(r.recall_gain_95ci[0])} to {pctx(r.recall_gain_95ci[1])}.</p>
        </>
      ) : (
        <table className="tl-ml-table">
          <thead><tr><th>Variant</th><th className="num">Buyers in the top 10% (AI)</th><th className="num">Rule</th><th className="num">AUC</th><th className="num">Calibration error</th></tr></thead>
          <tbody>{['without_PageValues', 'with_PageValues'].filter((k) => r[k]).map((k) => (
            <tr key={k}><td>{k === 'without_PageValues' ? 'Honest (no after-the-fact page values)' : 'With page values (leaks the outcome)'}</td><td className="num"><b>{pctx(r[k].top10_buyer_share)}</b></td><td className="num">{pctx(r[k].rule_top10_buyer_share)}</td><td className="num">{r[k].test_auc}</td><td className="num">{r[k].calibration_error_ece}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="tl-pn-sub" style={{ marginTop: 8 }}>Source: {r.source.title}. {r.source.citation} Licence: {r.source.license}. This shows the method works on genuinely recorded data; it says nothing about TicketLedger's own customers.</p>
    </Panel>
  );
}

function RealData({ real, card }) {
  if (!real) return null;
  if (real.status === 'WAITING_FOR_LIVE_DATA') {
    return (
      <Panel icon={FlaskConical} title="Test on TicketLedger's own data" action={<Badge tone="grey">waiting for live data</Badge>}>
        <p className="tl-pn-sub" style={{ marginTop: 0 }}>{real.note}</p>
        <p className="tl-pn-sub">When it appears, this panel shows the same test as above (AI vs the current rule on the newest unseen period) on real customers, with its own pass or fail.</p>
      </Panel>
    );
  }
  if (real.unavailable_reason) return null;
  const res = real.result || {};
  return (
    <Panel icon={FlaskConical} title="Test on TicketLedger's own data" sub={`Export ${real.stamp}: ${(real.data?.rows || 0).toLocaleString()} rows.`} action={<Badge tone={real.status === 'PASSED' ? 'green' : 'amber'}>{real.status}</Badge>}>
      <p className="tl-pn-sub" style={{ marginTop: 0 }}>{real.main_measure}: AI {fmt(res.model, real.main_measure)} vs rule {fmt(res.baseline, real.main_measure)} (95% interval of the improvement {fmt(res.improvement_95ci?.[0], real.main_measure)} to {fmt(res.improvement_95ci?.[1], real.main_measure)}).</p>
      {real.reasons?.length > 0 && <ul className="tl-pn-sub">{real.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="tl-pn-sub">Recommendation: {real.recommendation}. Nothing is promoted automatically.</p>
    </Panel>
  );
}

function Drift({ drift }) {
  if (!drift) return null;
  return (
    <Panel icon={Waves} title="Live input drift" sub={`Inputs of the last ${drift.window_days || 14} days of shadow predictions against the training data (PSI: over ${drift.thresholds?.watch ?? 0.1} watch, over ${drift.thresholds?.drift ?? 0.25} drift).`} action={<StatusBadge status={drift.status} />}>
      {drift.reason && <p className="tl-pn-sub">{drift.reason}</p>}
      {drift.status === 'NOT_ENOUGH_ROWS' && <p className="tl-pn-sub">{drift.live_rows} live rows so far; at least {drift.minimum_rows} are needed.</p>}
      {drift.features?.length > 0 && (
        <div className="tl-ml-scroll">
          <table className="tl-ml-table">
            <thead><tr><th>Input</th><th className="num">PSI</th><th>Status</th><th>Training</th><th>Live</th></tr></thead>
            <tbody>{drift.features.slice(0, 12).map((f) => (
              <tr key={f.feature}><td>{f.feature.replace(/_/g, ' ')}</td><td className="num">{f.psi.toFixed(3)}</td><td><StatusBadge status={f.status} /></td>
                <td>{String(f.kind === 'numeric' ? f.training_median : f.training_most_common)}</td><td>{String(f.kind === 'numeric' ? f.live_median : f.live_most_common)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {drift.note && <p className="tl-pn-sub" style={{ marginTop: 8 }}>{drift.note}</p>}
    </Panel>
  );
}

function FraudReviews() {
  const [metrics, setMetrics] = useState(null);
  const [cases, setCases] = useState(null);
  useEffect(() => {
    api.get('/ml/fraud-review-metrics').then((r) => setMetrics(r.data.data)).catch(() => setMetrics(false));
    api.get('/ml/fraud-review-cases', { params: { limit: 20 } }).then((r) => setCases(r.data.data.cases)).catch(() => setCases(false));
  }, []);
  const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
  const det = (k) => metrics?.[k] || {};
  return (
    <Panel icon={ShieldCheck} title="Blind fraud reviews (live)" sub="Weighted by each review's sampling rate. Reviewers never see this page, the detector or any score.">
      {metrics === false && <p className="tl-pn-sub">Review metrics are unavailable.</p>}
      {metrics && (
        <>
          <div className="tl-ml-scroll">
            <table className="tl-ml-table">
              <thead><tr><th>Detector</th><th className="num">Precision</th><th className="num">Recall</th><th className="num">False-flag rate</th></tr></thead>
              <tbody>{['rules', 'model'].map((k) => <tr key={k}><td>{k === 'rules' ? 'Current rules' : 'Shadow model'}</td><td className="num">{pct(det(k).precision)}</td><td className="num">{pct(det(k).recall)}</td><td className="num">{pct(det(k).falseFlagRate)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="tl-pn-sub" style={{ marginTop: 8 }}>{metrics.note}</p>
        </>
      )}
      <h4 className="tl-mc-h">Reviewed orders (resolved blind reviews only)</h4>
      {cases === false && <p className="tl-pn-sub">Cases are unavailable.</p>}
      {cases && !cases.length && <p className="tl-pn-sub">No resolved blind reviews yet.</p>}
      {cases && cases.length > 0 && (
        <div className="tl-ml-scroll">
          <table className="tl-ml-table">
            <thead><tr><th>Sampled</th><th>Rule</th><th className="num">Model</th><th>Why the model scored it</th><th>Review</th></tr></thead>
            <tbody>{cases.map((c) => (
              <tr key={c.sampleId}>
                <td>{day(c.sampledAt)}<div className="tl-pn-sub">{c.cell.replace(/_/g, ' ').toLowerCase()}</div></td>
                <td>{c.rule.decision || '—'}</td>
                <td className="num">{c.model.probability == null ? '—' : pct(c.model.probability)}<div className="tl-pn-sub">{c.model.wouldFlag ? 'would flag' : 'would not flag'}</div></td>
                <td><Reasons reasons={c.model.reasons} /></td>
                <td><Badge tone={c.review.decision === 'CONFIRMED_FRAUD' ? 'rose' : 'green'}>{c.review.decision === 'CONFIRMED_FRAUD' ? 'Fraud' : 'Legitimate'}</Badge><div className="tl-pn-sub">{c.agreement}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function ModelCard() {
  const [params, setParams] = useSearchParams();
  const name = MODELS.some(([k]) => k === params.get('model')) ? params.get('model') : 'intent';
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get(`/ml/ops/${name}`);
      setData(r.data.data);
      setState(r.data.data.enabled === false ? 'off' : 'ok');
    } catch {
      setData(null);
      setState('failed');
    }
  }, [name]);
  useEffect(() => { load(); }, [load]);

  const card = data?.card;
  const hasCard = card && !card.unavailable_reason;
  const d = card?.diagnostics || {};
  const unit = card?.kind === 'binary' ? 'pts' : card?.kind === 'count' ? 'scans' : 'tickets';
  const importance = useMemo(() => (d.importance?.features || []).slice(0, 10).map((f) => ({ label: f.label, value: f.importance, note: f.feature })), [d.importance]);
  const res = card?.result || {};
  const [lo, hi] = res.improvement_95ci || [];

  return (
    <div>
      <StudioHead
        crumbs={['Admin', 'AI', 'Model card']}
        title={data?.title || 'Model card'}
        intro="How one experimental model did in its offline test, which inputs drive it, why it scores what it scores, and whether live inputs still look like its training data. It runs in shadow only: the rules make every decision."
        controls={(
          <>
            <Link className="tl-st-btn tl-st-btn--light" to="/admin/ai-monitor"><ArrowLeft className="w-4 h-4" /> AI monitor</Link>
            <Link className="tl-st-btn tl-st-btn--light" to="/admin/ai-readiness">Go-live readiness</Link>
            <button type="button" className="tl-st-btn tl-st-btn--light" onClick={load} disabled={state === 'loading'}><RefreshCw className={`w-4 h-4 ${state === 'loading' ? 'tl-dash-spin' : ''}`} /> Refresh</button>
          </>
        )}
        actions={<RuleTag />}
      />
      <UnderlineTabs label="Model" options={MODELS.map(([value, label]) => ({ value, label }))} value={name} onChange={(v) => setParams({ model: v })} />

      {state === 'failed' && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />The model card could not be loaded. The application and its rules are not affected.</div>}
      {state === 'off' && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />AI insights are switched off (ML_INSIGHTS_ENABLED).</div>}
      {card?.unavailable_reason && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />{card.unavailable_reason === 'NO_REPORT' ? 'This model has no offline evaluation report yet.' : 'The ML service is unavailable, so the offline report cannot be shown.'}</div>}
      {data && data.card_matches_registered_model === false && <div className="tl-ml-warn tl-ml-warn--error" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />The report describes a different model file than the one registered in the app. Re-register the models (scripts/ml-register-models.mjs).</div>}

      {data && (
        <InsightBoundary>
          {hasCard && (
            <div className="tl-sc-grid tl-sc-grid--3" style={{ marginTop: 12 }}>
              <StatCard icon={card.status === 'PASSED' ? CheckCircle2 : XCircle} tone={card.status === 'PASSED' ? 'green' : 'amber'} label="Offline test" value={card.status === 'PASSED' ? 'Passed' : card.status === 'REJECTED' ? 'Rejected' : card.status}
                note={card.status === 'PASSED' ? `Better than the rule in 95% of re-tests (${fmt(lo, card.main_measure)} to ${fmt(hi, card.main_measure)}).` : (card.reasons?.[0] || '')} />
              <StatCard icon={Gauge} tone="ink" label={card.main_measure} value={`${fmt(res.model, card.main_measure)} vs ${fmt(res.baseline, card.main_measure)}`} note={`AI model vs current rule (${card.higher_is_better ? 'higher' : 'lower'} is better).`} />
              <StatCard icon={FlaskConical} tone="ink" label="Trained on" value={card.data?.source || '—'} note={`${(card.data?.rows || 0).toLocaleString()} rows, ${day(card.data?.from)} ${card.data?.from ? new Date(card.data.from).getFullYear() : ''} – ${day(card.data?.to)} ${card.data?.to ? new Date(card.data.to).getFullYear() : ''}. Synthetic: not evidence of real-world accuracy.`} />
            </div>
          )}

          <div className="tl-mc-grid">
            {hasCard && <OverTime card={card} />}
            {hasCard && d.calibration && (
              <Panel icon={Cpu} title="Calibration" sub="When the model says 30%, does it happen about 30% of the time? Each dot is a tenth of the test rows, sorted by prediction.">
                <CalibrationChart bins={d.calibration} />
              </Panel>
            )}
            {hasCard && d.range && (
              <Panel icon={Cpu} title="Forecast range" sub="The 80% range shown with every demand forecast (split-conformal, fitted on the validation period only).">
                <dl className="tl-ml-grid">
                  <div className="tl-ml-fig"><dt>Range held the real number</dt><dd>{(d.range.coverage * 100).toFixed(1)}%</dd></div>
                  <div className="tl-ml-fig"><dt>Rule's range</dt><dd>{(d.range.baseline_coverage * 100).toFixed(1)}%</dd></div>
                  <div className="tl-ml-fig"><dt>Width (± share of capacity)</dt><dd>{(d.range.width_share_of_capacity * 100).toFixed(1)}%</dd></div>
                </dl>
                <p className="tl-pn-sub" style={{ marginTop: 8 }}>Target 80%, gate at least 75%. Per-slice coverage is in the table under the chart on the left.</p>
              </Panel>
            )}
            {hasCard && importance.length > 0 && (
              <Panel icon={Cpu} title="What the model relies on" sub={`${d.importance.measure} (${d.importance.rows.toLocaleString()} test rows). Longer = the model leans on it more.`}>
                <BarList items={importance} format={(v) => (card.kind === 'binary' ? v.toFixed(3) : v.toFixed(2))} />
              </Panel>
            )}
            {hasCard && d.examples?.length > 0 && (
              <Panel icon={Cpu} title="Why it scored these" sub={d.explanation_note}>
                {d.examples.map((e) => (
                  <div key={e.which} className="tl-mc-example">
                    <p><b>{e.which}</b>: {card.kind === 'binary' ? `${(e.prediction * 100).toFixed(1)}%` : e.prediction.toFixed(1)} · actual {String(e.actual)}</p>
                    <Reasons reasons={e.reasons} unit={unit} />
                  </div>
                ))}
              </Panel>
            )}
            {hasCard && name === 'fraud' && <LinkAblation card={card} />}
            {hasCard && <Overload card={card} />}
            {hasCard && <Fairness card={card} />}
            <PublicData pub={data.public_data} />
            <RealData real={data.real_data} card={card} />
            <Drift drift={data.drift} />
            {hasCard && card.guards?.length > 0 && (
              <Panel icon={ShieldCheck} title="Must-not-get-worse checks" sub="Fixed before any model was evaluated (ml/gates.py). One failure rejects the model.">
                <table className="tl-ml-table"><tbody>{card.guards.map((g) => (
                  <tr key={g.name}><td>{g.name}</td><td className="num">{g.value}</td><td>{g.limit}</td><td>{g.passed ? <Badge tone="green" icon={CheckCircle2}>passed</Badge> : <Badge tone="rose" icon={XCircle}>failed</Badge>}</td></tr>
                ))}</tbody></table>
              </Panel>
            )}
          </div>
          {name === 'fraud' && <div style={{ marginTop: 16 }}><FraudReviews /></div>}
          <p className="tl-pn-sub" style={{ marginTop: 16 }}>Offline figures come from the evaluation report of the registered model. Live figures look at inputs only. Every model is shadow-only: it never decides checkout, payment, tickets or gate entry.</p>
        </InsightBoundary>
      )}
    </div>
  );
}
