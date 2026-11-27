import React, { useMemo, useState } from 'react';
import { AlertTriangle, Network, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { DashCard, Notice } from '../dash/DashShell';

/*
 * Linked accounts (SUPER_ADMIN investigations): accounts that had the same phone number (solid line) or used the
 * same browser (dashed line). Rings around the account: one step away, then two. Status is never colour alone:
 * confirmed-fraud accounts are red AND marked "!" AND listed with a label; frozen ones get a ring and a label.
 * Loaded only on request, because viewing it counts as seeing detector output for every account it shows.
 */
const C = { root: '#0f3a23', node: '#84b9f3', fraud: '#dc3c3d', frozen: '#f18a59', edge: '#9aa59e', ink: '#191919', ink2: '#666666' };

function layout(graph, W, H) {
  const cx = W / 2, cy = H / 2, R1 = Math.min(W, H) * 0.24, R2 = Math.min(W, H) * 0.43;
  const pos = new Map();
  const rings = [[], [], []];
  for (const n of graph.nodes) rings[Math.min(2, n.depth)].push(n);
  pos.set(graph.root, { x: cx, y: cy });
  // First ring evenly; second ring placed near the first-ring account it hangs off
  rings[1].forEach((n, i) => { const a = (i / Math.max(1, rings[1].length)) * Math.PI * 2 - Math.PI / 2; pos.set(n.id, { x: cx + R1 * Math.cos(a), y: cy + R1 * Math.sin(a), a }); });
  const parentAngle = (id) => {
    const e = graph.edges.find((x) => (x.a === id && pos.get(x.b)?.a !== undefined) || (x.b === id && pos.get(x.a)?.a !== undefined));
    return e ? pos.get(e.a === id ? e.b : e.a).a : 0;
  };
  const outer = rings[2].map((n) => ({ n, a: parentAngle(n.id) })).sort((p, q) => p.a - q.a);
  outer.forEach(({ n, a }, i) => { const spread = a + ((i % 3) - 1) * 0.18; pos.set(n.id, { x: cx + R2 * Math.cos(spread), y: cy + R2 * Math.sin(spread) }); });
  return pos;
}

export default function AccountGraph({ userId }) {
  const [graph, setGraph] = useState(null);
  const [state, setState] = useState('idle');
  const [hover, setHover] = useState(null);
  const W = 560, H = 380;
  const load = async () => {
    setState('loading');
    try {
      const r = await api.get(`/ml/account-graph/${userId}`);
      setGraph(r.data.data);
      setState('ok');
    } catch {
      setState('failed');
    }
  };
  const pos = useMemo(() => (graph ? layout(graph, W, H) : null), [graph]);
  const nodeById = useMemo(() => new Map((graph?.nodes || []).map((n) => [n.id, n])), [graph]);
  const h = hover && nodeById.get(hover);

  return (
    <DashCard title="Linked accounts" aside={state === 'ok' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 inline" /> Refresh</button>}>
      {state === 'idle' && (
        <div className="grid gap-2">
          <p className="text-sm text-slate-600">Accounts that shared a phone number or a browser with this one, up to two steps away. Opening it is recorded: your later blind reviews of any account shown will not count as blind.</p>
          <div><button type="button" className="tl-st-btn tl-st-btn--sm" onClick={load}><Network className="w-3.5 h-3.5 inline" /> Show linked accounts</button></div>
        </div>
      )}
      {state === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
      {state === 'failed' && <Notice tone="bad">The linked accounts could not be loaded.</Notice>}
      {state === 'ok' && graph && (
        <div className="grid gap-3">
          <p className="text-sm">
            <b>{graph.summary.accounts}</b> linked account{graph.summary.accounts === 1 ? '' : 's'}
            {' · '}<b>{graph.summary.confirmedFraud}</b> with confirmed fraud
            {' · '}{graph.summary.viaPhone} phone link{graph.summary.viaPhone === 1 ? '' : 's'}, {graph.summary.viaBrowser} browser link{graph.summary.viaBrowser === 1 ? '' : 's'}
            {graph.truncated ? ' · showing the first 40 accounts' : ''}
          </p>
          {graph.summary.accounts === 0 ? <p className="text-sm text-slate-500">No account shared a phone number or browser with this one.</p> : (
            <div style={{ position: 'relative', overflowX: 'auto' }}>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block', margin: '0 auto' }} role="img" aria-label="Graph of linked accounts">
                {graph.edges.map((e) => {
                  const a = pos.get(e.a), b = pos.get(e.b);
                  if (!a || !b) return null;
                  const on = hover && (e.a === hover || e.b === hover);
                  return <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? C.ink : C.edge} strokeWidth={on ? 2 : 1.5} strokeDasharray={e.via.includes('phone') ? undefined : '5 4'} />;
                })}
                {graph.nodes.map((n) => {
                  const p = pos.get(n.id);
                  if (!p) return null;
                  const r = n.root ? 13 : 9;
                  const fill = n.root ? C.root : n.confirmedFraud ? C.fraud : C.node;
                  return (
                    <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
                      <circle cx={p.x} cy={p.y} r={r + 8} fill="transparent" />
                      {n.frozen && <circle cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={C.frozen} strokeWidth="2.5" />}
                      <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke="#fff" strokeWidth="2" />
                      {n.confirmedFraud && <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">!</text>}
                      {(n.root || hover === n.id) && <text x={p.x} y={p.y - r - 7} textAnchor="middle" fontSize="11" fill={C.ink}>{n.root ? 'This account' : n.name}</text>}
                    </g>
                  );
                })}
              </svg>
              {h && (
                <div className="text-xs" style={{ position: 'absolute', left: 8, top: 8, background: '#fff', border: '1px solid #e2e8e1', borderRadius: 8, padding: '6px 10px', boxShadow: '0 6px 20px rgba(15,30,20,.12)' }}>
                  <b>{h.name}</b><div>{h.email}</div><div>{h.orders} order{h.orders === 1 ? '' : 's'} · joined {new Date(h.createdAt).toLocaleDateString()}</div>
                  <div>{h.confirmedFraud ? 'Fraud confirmed by a review' : 'No confirmed fraud'}{h.frozen ? ` · ${h.status.toLowerCase()}` : ''}{h.phone ? ` · phone ${h.phone}` : ''}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-slate-600 mt-2">
                <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={C.edge} strokeWidth="2" /></svg> same phone number</span>
                <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={C.edge} strokeWidth="2" strokeDasharray="5 4" /></svg> same browser</span>
                <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={C.fraud} /></svg> ! fraud confirmed</span>
                <span><svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke={C.frozen} strokeWidth="2" /></svg> frozen / suspended</span>
              </div>
            </div>
          )}
          {graph.nodes.length > 1 && (
            <details className="text-sm"><summary className="cursor-pointer text-slate-600">List the accounts</summary>
              <table className="tl-dash-table mt-2"><thead><tr><th>Account</th><th>Steps away</th><th>Orders</th><th>Status</th></tr></thead>
                <tbody>{graph.nodes.filter((n) => !n.root).map((n) => (
                  <tr key={n.id}><td><b>{n.name}</b><div className="text-xs text-slate-500">{n.email}</div></td><td>{n.depth}</td><td>{n.orders}</td>
                    <td>{n.confirmedFraud && <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle className="w-3.5 h-3.5" /> fraud confirmed</span>} {n.frozen ? n.status.toLowerCase() : ''}{!n.confirmedFraud && !n.frozen ? '—' : ''}</td></tr>
                ))}</tbody>
              </table>
            </details>
          )}
          <p className="text-xs text-slate-500">{graph.note}</p>
        </div>
      )}
    </DashCard>
  );
}
