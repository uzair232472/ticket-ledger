import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, FileText, Lock, Printer, RefreshCw, XCircle } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, Panel, Badge } from '../components/dash/Studio';
import { RuleTag } from '../components/ml/InsightPanels';
import '../components/ml/ml.css';

/*
 * Go-live readiness (/admin/ai-readiness) and the AI governance report (/admin/ai-report, printable: Save as PDF).
 * Both read GET /api/ml/governance. Every condition a model would need before it could make a decision, shown as
 * met / not met / pending / not available. Nothing here grants anything: there is no promotion path, so every
 * verdict is "stays in shadow".
 */
const STATUS = {
  MET: { tone: 'green', icon: CheckCircle2, label: 'Met' },
  NOT_MET: { tone: 'rose', icon: XCircle, label: 'Not met' },
  PENDING: { tone: 'amber', icon: CircleDashed, label: 'Pending' },
  NOT_AVAILABLE: { tone: 'grey', icon: Lock, label: 'Not available' },
};
const isShare = (m) => /share|precision|%|rate/i.test(m || '');
const fmt = (v, m) => (v == null || !Number.isFinite(Number(v)) ? '—' : isShare(m) ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toFixed(1));

function useGovernance() {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.get('/ml/governance');
      setData(r.data.data);
      setState(r.data.data.enabled === false ? 'off' : 'ok');
    } catch {
      setState('failed');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, state, load };
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.PENDING;
  return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>;
}

export default function AiReadiness() {
  const { data, state, load } = useGovernance();
  return (
    <div>
      <StudioHead
        crumbs={['Admin', 'AI', 'Go-live readiness']}
        title="Go-live readiness"
        intro="Everything a model would have to meet before it could make a real decision. None can today: there is no promotion path in the code, so every model stays in shadow and the rules decide."
        controls={(
          <>
            <Link className="tl-st-btn tl-st-btn--light" to="/admin/ai-report"><FileText className="w-4 h-4" /> Governance report</Link>
            <button type="button" className="tl-st-btn tl-st-btn--light" onClick={load} disabled={state === 'loading'}><RefreshCw className={`w-4 h-4 ${state === 'loading' ? 'tl-dash-spin' : ''}`} /> Refresh</button>
          </>
        )}
        actions={<RuleTag />}
      />
      {state === 'failed' && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />Readiness could not be loaded (is the ML service running?). The rules are not affected.</div>}
      {state === 'off' && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />AI insights are switched off (ML_INSIGHTS_ENABLED).</div>}
      {data?.models && (
        <div className="tl-ml-models" style={{ marginTop: 12 }}>
          {data.models.map((m) => (
            <Panel key={m.name} title={`${m.feature}. ${m.title}`} sub={`${m.readiness.met} of ${m.readiness.total} conditions met`} action={<Badge tone="ink" icon={Lock}>Stays in shadow</Badge>}>
              <ul className="tl-gv-list">
                {m.readiness.items.map((i) => (
                  <li key={i.key}>
                    <StatusBadge status={i.status} />
                    <div><b>{i.label}</b><span>{i.detail}</span></div>
                  </li>
                ))}
              </ul>
              <Link className="tl-st-btn tl-st-btn--light" style={{ marginTop: 10 }} to={`/admin/ai-models?model=${m.name}`}>Open model card</Link>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

/** Printable governance report: one page per section, Save as PDF from the browser's print dialog. */
export function AiReport() {
  const { data, state } = useGovernance();
  const when = data ? new Date(data.generated_at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : '';
  return (
    <div className="tl-gv-report">
      <div className="tl-gv-bar">
        <Link to="/admin/ai-readiness">← Back to readiness</Link>
        <button type="button" className="tl-st-btn tl-st-btn--green" onClick={() => window.print()} disabled={state !== 'ok'}><Printer className="w-4 h-4" /> Print / save as PDF</button>
      </div>
      {state === 'loading' && <p>Loading…</p>}
      {state === 'failed' && <p>The report could not be loaded (is the ML service running?).</p>}
      {state === 'ok' && data && (
        <article>
          <header className="tl-gv-cover">
            <p className="tl-gv-eyebrow">TicketLedger · AI governance report</p>
            <h1>How the AI is tested, and why it decides nothing</h1>
            <p>Generated {when}. Decision source for every customer, payment, ticket and gate: <b>the rules</b>.</p>
          </header>

          <section>
            <h2>1. Principles</h2>
            <ol>{data.principles.map((p) => <li key={p}>{p}</li>)}</ol>
          </section>

          <section>
            <h2>2. Offline test results</h2>
            <p>Each model against the rule the app uses today, on the newest 15% of its data (never seen in training). A model passes only if the 95% interval of its improvement is above zero and every must-not-get-worse check holds. Training data is synthetic.</p>
            <table>
              <thead><tr><th>Model</th><th>Measure</th><th>AI</th><th>Rule</th><th>95% interval of the improvement</th><th>Result</th></tr></thead>
              <tbody>{data.models.map((m) => (
                <tr key={m.name}>
                  <td>{m.title}</td><td>{m.offline?.measure || '—'}</td>
                  <td>{fmt(m.offline?.result?.model, m.offline?.measure)}</td><td>{fmt(m.offline?.result?.baseline, m.offline?.measure)}</td>
                  <td>{m.offline?.result?.improvement_95ci ? `${fmt(m.offline.result.improvement_95ci[0], m.offline.measure)} to ${fmt(m.offline.result.improvement_95ci[1], m.offline.measure)}` : '—'}</td>
                  <td><b>{m.offline?.status || '—'}</b></td>
                </tr>
              ))}</tbody>
            </table>
            {data.models.filter((m) => m.offline?.status === 'REJECTED').map((m) => (
              <p key={m.name}><b>{m.title} rejected:</b> {m.offline.reasons.join('; ')}.</p>
            ))}
          </section>

          <section>
            <h2>3. Fairness</h2>
            <p>The offline test split by city, event type, payment method and first-time vs returning customers. Groups the model serves clearly worse are listed for review; they do not change a result.</p>
            <table>
              <thead><tr><th>Model</th><th>Groups to review</th></tr></thead>
              <tbody>{data.models.map((m) => <tr key={m.name}><td>{m.title}</td><td>{m.offline?.fairness_watch?.length ? m.offline.fairness_watch.join(', ') : 'none flagged'}</td></tr>)}</tbody>
            </table>
          </section>

          <section>
            <h2>4. Live monitoring</h2>
            <p>Models score live traffic in shadow only. Their inputs are compared with the training data (PSI drift check); accuracy is never computed from live traffic.</p>
            <table>
              <thead><tr><th>Model</th><th>Registered</th><th>Input drift (14 days)</th></tr></thead>
              <tbody>{data.models.map((m) => <tr key={m.name}><td>{m.title}</td><td>{m.registered.status ? `${m.registered.status} · ${m.registered.version} · ${m.registered.sha256_12}` : 'not registered'}</td><td>{m.drift.status.replace(/_/g, ' ').toLowerCase()}{m.drift.drifted?.length ? `: ${m.drift.drifted.join(', ')}` : ''}</td></tr>)}</tbody>
            </table>
          </section>

          <section>
            <h2>5. Evidence beyond synthetic data</h2>
            <ul>
              {data.models.filter((m) => m.public_data).map((m) => <li key={m.name}><b>{m.title}:</b> {m.public_data.banner}</li>)}
              <li><b>TicketLedger's own data:</b> {data.models.some((m) => m.real_data && m.real_data.status !== 'WAITING_FOR_LIVE_DATA' && !m.real_data.unavailable_reason)
                ? data.models.filter((m) => m.real_data?.stamp).map((m) => `${m.title}: ${m.real_data.status}`).join('; ')
                : 'none yet. Models are evaluated on exported real data once the platform is live.'}</li>
            </ul>
          </section>

          <section>
            <h2>6. Go-live readiness</h2>
            <p>What each model would still need before it could make a decision. Two conditions cannot be met by design today: a live shadow check sign-off and an admin approval path do not exist in the code.</p>
            <table>
              <thead><tr><th>Model</th><th>Met</th><th>Still missing</th><th>Verdict</th></tr></thead>
              <tbody>{data.models.map((m) => (
                <tr key={m.name}><td>{m.title}</td><td>{m.readiness.met}/{m.readiness.total}</td>
                  <td>{m.readiness.items.filter((i) => i.status !== 'MET').map((i) => i.label).join('; ')}</td><td><b>Stays in shadow</b></td></tr>
              ))}</tbody>
            </table>
          </section>
          <footer className="tl-gv-foot">TicketLedger AI governance report · generated {when} · every model shadow-only (may_serve_decisions: false)</footer>
        </article>
      )}
    </div>
  );
}
