import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Cpu, FlaskConical, RefreshCw, ServerCrash, ShieldCheck, Sparkles, ToggleLeft } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, StatCard, Panel, Badge } from '../components/dash/Studio';
import { ExperimentalTag, RuleTag, EvaluationLine, InsightBoundary } from '../components/ml/InsightPanels';
import { fetchInsight, num } from '../lib/mlInsights';
import '../components/ml/ml.css';

/*
 * Step 6: AI monitor (SUPER_ADMIN). Health and coverage of the eight AI features in shadow mode: registered
 * models, logged rows, shadow failures, outcome coverage against the approval-gate minimums, job runs, the ML
 * service, the recommendation experiment and the switches. Counts only; nothing here changes anything.
 */

const when = (d) => (d ? new Date(d).toLocaleString() : '—');
const FEATURE_NAMES = { A: 'Purchase intent', B: 'Abandoned checkout', C: 'Fraud', D: 'Customer behaviour', E: 'Recommendations', F: 'Demand', G: 'Attendance', H: 'Crowd flow' };

// Offline measures are shares (0..1) or counts; shares are shown as percentages
const isShare = (measure) => /share|precision|%|rate/i.test(measure || '');
const fmtMeasure = (v, measure) => (v == null ? '—' : isShare(measure) ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toFixed(1));

/** The offline test: the model against the current rule on the newest 15% of the training history. */
function OfflineResult({ r }) {
  if (!r) return null;
  const aiBetter = r.higher_is_better ? r.model > r.rule : r.model < r.rule;
  const passed = r.status === 'PASSED';
  const [lo, hi] = r.improvement_95ci || [];
  return (
    <div className={`tl-ml-vs ${passed ? 'is-pass' : 'is-fail'}`}>
      <p className="tl-ml-vs-head">
        <b>Tested offline: AI vs rule</b>
        <Badge tone={passed ? 'green' : 'rose'}>{passed ? 'Passed' : 'Rejected'}</Badge>
      </p>
      <p className="tl-ml-vs-measure">{r.measure} ({r.higher_is_better ? 'higher' : 'lower'} is better)</p>
      <div className="tl-ml-vs-grid">
        <div className={aiBetter ? 'win' : ''}><span>AI model</span><strong>{fmtMeasure(r.model, r.measure)}</strong></div>
        <div className={!aiBetter ? 'win' : ''}><span>Current rule</span><strong>{fmtMeasure(r.rule, r.measure)}</strong></div>
      </div>
      <p className="tl-ml-vs-note">
        {passed
          ? `The AI is better, and stays better in 95% of re-tests (improvement ${fmtMeasure(lo, r.measure)} to ${fmtMeasure(hi, r.measure)}).`
          : (r.reasons[0] ? `Not good enough: ${r.reasons[0].replace(/^not clearly better than the baseline: /, 'not reliably better than the rule; ')}.` : 'Did not pass every check.')}
        {' '}On synthetic data; real-data accuracy comes later.
      </p>
    </div>
  );
}

function ModelCard({ m }) {
  const reg = m.registered;
  const sh = m.rows.shadow;
  return (
    <Panel icon={Cpu} title={`${m.feature}. ${m.title}`} sub={reg.status ? `${reg.version} · ${reg.source} · ${reg.sha256_12}` : 'No model registered'} action={reg.status ? <Badge tone="grey">{reg.status}</Badge> : <Badge tone="amber">Rules only</Badge>}>
      <div className="tl-ml-scroll">
        <table className="tl-ml-table">
          <thead><tr><th scope="col">Rows</th><th scope="col" className="num">Total</th><th scope="col" className="num">Last 24 h</th><th scope="col">Last logged</th></tr></thead>
          <tbody>
            <tr><th scope="row">Rules</th><td className="num">{num(m.rows.rules.total)}</td><td className="num">{num(m.rows.rules.last_24h)}</td><td>{when(m.rows.rules.last_at)}</td></tr>
            <tr><th scope="row">Shadow</th><td className="num">{num(sh.total)}</td><td className="num">{num(sh.last_24h)}</td><td>{when(sh.last_at)}</td></tr>
          </tbody>
        </table>
      </div>
      {reg.status && (
        <p className="tl-pn-sub" style={{ marginTop: 8 }}>
          Shadow: {num(sh.predicted)} scored, {num(sh.skipped)} skipped, {num(sh.errors)} failed ({num(sh.errors_24h)} in 24 h). Offline check: {reg.offline_evaluation}. Never serves decisions.
        </p>
      )}
      <OfflineResult r={m.offline_result} />
      {m.when && <p className="tl-pn-sub" style={{ marginTop: 8 }}><b>When it runs:</b> {m.when}</p>}
      {m.artifact_in_ml_service && <p className="tl-pn-sub">ML service artifact: {m.artifact_in_ml_service.fingerprint_ok ? 'fingerprint verified' : m.artifact_in_ml_service.problem}</p>}
      {m.rows.reasons.length > 0 && (
        <ul className="tl-pn-sub" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {m.rows.reasons.map((r) => <li key={r.reason}>{r.reason} ({num(r.count)})</li>)}
        </ul>
      )}
      <EvaluationLine evaluation={m.evaluation} />
      <Link className="tl-st-btn tl-st-btn--light" style={{ marginTop: 10 }} to={`/admin/ai-models?model=${m.name}`}>Open model card: charts, reasons, drift</Link>
    </Panel>
  );
}

export default function AiMonitor() {
  const [data, setData] = useState(null);
  const [fraud, setFraud] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, f] = await Promise.all([fetchInsight(api, '/ml/monitor'), fetchInsight(api, '/ml/insights/fraud')]);
    setData(m);
    setFraud(f);
    setFailed(!m);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const svc = data?.ml_service;
  const recs = data?.recommendations;
  return (
    <div>
      <StudioHead
        crumbs={['Admin', 'AI']}
        title="AI monitor"
        intro="All eight AI features run in shadow mode: the rules make every decision. This page shows what the experimental models logged and how far each one is from having enough real outcomes to be evaluated."
        controls={(
          <>
            <Link className="tl-st-btn tl-st-btn--light" to="/admin/ai-readiness">Go-live readiness</Link>
            <Link className="tl-st-btn tl-st-btn--light" to="/admin/ai-report">Governance report</Link>
            <button type="button" className="tl-st-btn tl-st-btn--light" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh</button>
          </>
        )}
        actions={<RuleTag />}
      />

      {failed && !loading && (
        <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />The monitor is unavailable (switched off with ML_INSIGHTS_ENABLED, or the request failed). The application and its rules are not affected.</div>
      )}

      {data && (
        <InsightBoundary>
          {data.warnings.map((w) => (
            <div key={w.message} className={`tl-ml-warn${w.level === 'error' ? ' tl-ml-warn--error' : ''}`} role="status">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span>{w.model ? <b>{w.model}: </b> : null}{w.message}</span>
            </div>
          ))}

          <div className="tl-sc-grid tl-sc-grid--3" style={{ marginTop: 8 }}>
            <StatCard icon={svc?.reachable ? Activity : ServerCrash} tone={svc?.reachable ? 'green' : 'amber'} label="ML service" value={svc?.reachable ? 'Reachable' : 'Unavailable'} note={svc?.reachable ? `scikit-learn ${svc.sklearn} · ${svc.ml_env}` : `${svc?.reason}. Rules keep answering.`} />
            <StatCard icon={RefreshCw} tone="ink" label="Background jobs" value={data.jobs.last_finished_at ? when(data.jobs.last_finished_at) : 'Not run yet'} note={`${data.jobs.runs} run(s) since this server started; every ${data.jobs.interval_minutes} minutes.`} />
            <StatCard icon={ToggleLeft} tone="ink" label="Switches" value={data.flags.shadow ? 'Shadow on' : 'Shadow off'} note={`Snapshots ${data.flags.snapshots ? 'on' : 'off'} · organizer insights ${data.flags.organizerInsights ? 'on' : 'off'} · recommendations ${data.flags.recommendations ? 'shown' : 'hidden'}`} />
          </div>

          <h2 className="tl-df-section">Models (shadow only)</h2>
          <div className="tl-ml-models">
            {data.models.map((m) => <ModelCard key={m.name} m={m} />)}
          </div>

          <h2 className="tl-df-section">Recommendations and customer behaviour</h2>
          <div className="tl-ml-models">
            <Panel icon={Sparkles} title={`E. ${FEATURE_NAMES.E}`} sub="Rule-based ranking with a control group. Both groups see the same layout." action={<Badge tone={data.flags.recommendations ? 'green' : 'amber'}>{data.flags.recommendations ? 'Shown' : 'Switched off'}</Badge>}>
              {!data.flags.recommendations && (
                <p className="tl-ml-warn" role="note" style={{ marginTop: 0 }}>
                  Switched off: customers do not see recommendation rows, so every count below stays 0. Turn on with
                  ML_REC_DISPLAY=true in the API settings to start the experiment.
                </p>
              )}
              <div className="tl-ml-scroll">
                <table className="tl-ml-table">
                  <thead><tr><th scope="col">Group</th><th scope="col" className="num">Lists served</th><th scope="col" className="num">Seen on screen</th><th scope="col" className="num">Clicks</th></tr></thead>
                  <tbody>
                    {[['Control (popular)', recs.control], ['Personalised', recs.personalised]].map(([label, g]) => (
                      <tr key={label}><th scope="row">{label}</th><td className="num">{num(g.served_lists)}</td><td className="num">{num(g.rendered_lists)}</td><td className="num">{num(g.clicks)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <EvaluationLine evaluation={recs.evaluation} />
            </Panel>
            <Panel icon={Activity} title={`D. ${FEATURE_NAMES.D}`} sub={data.behaviour.note}>
              <p className="tl-pn-sub" style={{ marginTop: 0 }}>Genuine use start: {data.genuine_use_from || 'not set (no genuine customers yet)'}.</p>
              <Link className="tl-st-btn tl-st-btn--light" to="/admin/behavior-profile">Open the behaviour report</Link>
            </Panel>
          </div>

          {fraud && (
            <>
              <h2 className="tl-df-section">C. Fraud (totals only; reviewers never see this)</h2>
              <Panel icon={ShieldCheck} title="Checkout security rules and the shadow fraud model" action={<ExperimentalTag />}>
                <div className="tl-ml-scroll">
                  <table className="tl-ml-table">
                    <thead><tr><th scope="col">Rule decision</th><th scope="col" className="num">Count</th></tr></thead>
                    <tbody>
                      {Object.entries(fraud.rules.by_decision).map(([k, v]) => <tr key={k}><td>{k.replace(':', ' · ')}</td><td className="num">{num(v)}</td></tr>)}
                      <tr><td>Checkouts blocked by the rules</td><td className="num">{num(fraud.rules.checkout_blocks)}</td></tr>
                    </tbody>
                  </table>
                </div>
                {fraud.experimental?.value && (
                  <p className="tl-pn-sub" style={{ marginTop: 8 }}>
                    <FlaskConical className="w-3 h-3" aria-hidden="true" style={{ display: 'inline' }} /> Shadow model (rejected offline; kept in shadow only): would flag {num(fraud.experimental.value.would_flag)}, would not flag {num(fraud.experimental.value.would_not_flag)}, failed {num(fraud.experimental.value.errors)}.
                  </p>
                )}
                <EvaluationLine evaluation={fraud.evaluation} />
              </Panel>
            </>
          )}
          <p className="tl-pn-sub" style={{ marginTop: 16 }}>Generated {when(data.generated_at)}. Counts include internal and test activity; models are evaluated offline on genuine-customer exports only.</p>
        </InsightBoundary>
      )}
    </div>
  );
}
