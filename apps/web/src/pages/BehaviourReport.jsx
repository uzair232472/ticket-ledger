import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, RefreshCw, Repeat, Users } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, StatCard, Panel } from '../components/dash/Studio';
import { ColumnChart } from '../components/dash/charts';
import { RuleTag, EvaluationLine, InsightBoundary } from '../components/ml/InsightPanels';
import { fetchInsight, num } from '../lib/mlInsights';
import '../components/ml/ml.css';

/*
 * Step 6 (feature D): a description of customer behaviour across the platform. No model, no score and no
 * individual customer: totals and shares only, first-time and returning buyers apart.
 */
export default function BehaviourReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    setData(await fetchInsight(api, '/ml/insights/behaviour'));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const r = data?.rules;

  return (
    <div>
      <StudioHead
        crumbs={['Admin', 'AI', 'Customer behaviour']}
        title="Customer behaviour"
        intro="What customers did on the platform, in totals. There is no model behind this page and nothing here is used to make a decision about anyone."
        controls={<button type="button" className="tl-st-btn tl-st-btn--light" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh</button>}
        actions={<RuleTag />}
      />
      {!data && !loading && <div className="tl-ml-warn" role="status"><AlertTriangle className="w-4 h-4" aria-hidden="true" />The report is unavailable right now.</div>}
      {r && (
        <InsightBoundary>
          <div className="tl-sc-grid tl-sc-grid--3">
            <StatCard icon={Users} tone="ink" label="Customer accounts" value={num(r.customers)} />
            <StatCard icon={Activity} tone="green" label="Buyers" value={num(r.buyers)} note={`${num(r.first_time_buyers)} first-time · ${num(r.returning_buyers)} returning`} />
            <StatCard icon={Repeat} tone="ink" label="Orders per buyer" value={r.orders_per_buyer ?? '—'} />
          </div>
          <div className="tl-ml-models" style={{ marginTop: 16 }}>
            <Panel icon={BarChart3} title="Activity in the last 30 days">
              {r.activity_last_30_days.length
                ? <ColumnChart data={r.activity_last_30_days.map((a) => ({ label: a.action.replace(/_/g, ' '), value: a.events }))} label="Activity in the last 30 days" />
                : <p className="tl-pn-sub">No activity recorded in the last 30 days.</p>}
            </Panel>
            <Panel icon={BarChart3} title="Event categories viewed (30 days)">
              {r.categories_viewed_last_30_days.length
                ? <ColumnChart data={r.categories_viewed_last_30_days.map((c) => ({ label: c.category.replace(/_/g, ' ').toLowerCase(), value: c.views }))} label="Event categories viewed" />
                : <p className="tl-pn-sub">No event views in the last 30 days.</p>}
            </Panel>
          </div>
          <EvaluationLine evaluation={data.evaluation} />
          {data.notes.map((n) => <p key={n} className="tl-pn-sub">{n}</p>)}
        </InsightBoundary>
      )}
    </div>
  );
}
