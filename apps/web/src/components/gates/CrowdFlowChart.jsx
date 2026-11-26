import React, { useMemo, useState } from 'react';
import { useWidth } from '../ml/charts';
import { SOURCES, availableSources, chartSeries, gatesOf, ruleNote, slotLabel, slotText } from '../../lib/crowdFlow';

/*
 * Crowd-flow chart (Gates -> Live, inside "Expected arrivals per gate"). Arrivals per gate per 5-minute slot, never
 * cumulative, from the same crowd insight as the 3D view. All gates together (one colour per gate, capacity dashed in
 * the gate's colour) or one gate (rule, AI with its 80% range, actual scans, capacity, and the AI's chance of going
 * over capacity underneath). Missing values are gaps, never 0. Clicking a slot (or arrow keys) selects it: the 3D
 * view's slider and seat colours follow, and moving the slider moves the selection here.
 */
const INK = '#191919', INK2 = '#666666', GRID = '#e7e7e7', AXIS = '#c2c2c2', SEL = '#0f3a23';
const PAD = { l: 44, r: 96, t: 22, b: 26 };
const H = 260, STRIP = 40;
const fmt = (v) => (v === null || v === undefined ? '—' : Math.round(v * 10) / 10);
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function path(values, x, y) {
  let d = '', open = false;
  values.forEach((v, i) => {
    if (v === null) { open = false; return; }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}

function bandPath([lo, hi], x, y) {
  // One closed shape per run of slots that have both ends
  const runs = [];
  let cur = [];
  lo.forEach((l, i) => { if (l !== null && hi[i] !== null) cur.push(i); else if (cur.length) { runs.push(cur); cur = []; } });
  if (cur.length) runs.push(cur);
  return runs.map((r) => `M${r.map((i) => `${x(i).toFixed(1)},${y(hi[i]).toFixed(1)}`).join('L')}L${[...r].reverse().map((i) => `${x(i).toFixed(1)},${y(lo[i]).toFixed(1)}`).join('L')}Z`).join('');
}

const niceMax = (v) => { if (!(v > 0)) return 10; const m = 10 ** Math.floor(Math.log10(v)); const k = v / m; return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * m; };

export default function CrowdFlowChart({ data, slot, onSlot, source, onSource, gateId, onGate }) {
  const [ref, W] = useWidth(300);
  const [hover, setHover] = useState(null);
  const gates = useMemo(() => gatesOf(data), [data]);
  const avail = useMemo(() => availableSources(data), [data]);
  const { minutes, series, pOver, source: shownSource, truncated, gate } = useMemo(() => chartSeries(data, { gateId, source }), [data, gateId, source]);
  if (!minutes.length || !series.length) return null;

  const iw = Math.max(120, W - PAD.l - PAD.r), ih = H - PAD.t - PAD.b;
  const all = series.flatMap((s) => [...s.values, ...(s.band ? s.band[1] : [])]).filter((v) => v !== null);
  const top = niceMax(Math.max(1, ...all) * 1.08);
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const x = (i) => PAD.l + (minutes.length === 1 ? iw / 2 : (i / (minutes.length - 1)) * iw);
  const y = (v) => PAD.t + ih - (v / top) * ih;
  const sel = minutes.indexOf(slot);
  const at = (i) => (i === null || i < 0 ? null : i);
  const shown = at(hover) ?? at(sel);
  const idxAt = (clientX, el) => {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    minutes.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    return best;
  };
  const step = (d) => { const i = Math.max(0, Math.min(minutes.length - 1, (sel < 0 ? 0 : sel) + d)); onSlot(minutes[i]); };
  // Direct labels at the right edge for the main lines (gaps skipped), nudged apart
  const main = series.filter((s) => !s.quiet && s.kind !== 'capacity');
  const ends = main.map((s) => { let i = s.values.length - 1; while (i >= 0 && s.values[i] === null) i -= 1; return i < 0 ? null : { s, i, ly: y(s.values[i]) }; })
    .filter(Boolean).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 14) ends[k].ly = ends[k - 1].ly + 14;
  const capSeries = series.filter((s) => s.kind === 'capacity');

  return (
    <div className="tl-cf">
      <div className="tl-cf-controls">
        <div className="tl-ch3-seg" role="radiogroup" aria-label="Gates shown">
          <button type="button" role="radio" aria-checked={!gateId} onClick={() => onGate(null)}>All gates</button>
          {gates.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={gateId === g.id} onClick={() => onGate(g.id)}>
              <i className="tl-cf-dot" style={{ background: g.color }} aria-hidden="true" />{g.name}
            </button>
          ))}
        </div>
        {!gateId && (
          <div className="tl-ch3-seg" role="radiogroup" aria-label="Numbers shown">
            {Object.entries(SOURCES).filter(([k]) => avail[k]).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={shownSource === k} onClick={() => onSource(k)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="tl-cf-legend">
        {gateId
          ? series.map((s) => <span key={s.key}><i className={s.dashed ? 'is-dashed' : ''} style={{ background: s.dashed ? 'none' : s.color, borderColor: s.color }} />{s.name}</span>)
          : gates.slice(0, 8).map((g) => <span key={g.id}><i style={{ background: g.color }} />{g.name}</span>)}
        {!gateId && capSeries.length > 0 && <span><i className="is-dashed" style={{ borderColor: INK2 }} />dashed: that gate&apos;s capacity per 5 min</span>}
        {gateId && series.find((s) => s.band) && <span><i style={{ background: 'rgba(244,114,48,0.22)' }} />AI 80% range</span>}
      </div>

      <div ref={ref} className="tl-cf-plot">
        <svg
          width={W} height={H + (pOver ? STRIP + 18 : 0)} role="img" tabIndex={0}
          aria-label={`Arrivals per 5 minutes ${gate ? `at ${gate.name}` : 'per gate'}. Selected: ${slotText(slot)}. Use the left and right arrow keys to move the selection.`}
          onMouseMove={(e) => setHover(idxAt(e.clientX, e.currentTarget))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => onSlot(minutes[idxAt(e.clientX, e.currentTarget)])}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } }}
          style={{ cursor: 'pointer', outline: 'none' }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK2}>{Math.round(t)}</text>
            </g>
          ))}
          <text x={PAD.l} y={12} fontSize="11" fill={INK2}>people per 5 min</text>
          <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih} y2={PAD.t + ih} stroke={AXIS} />
          {minutes.map((m, i) => (m % 15 === 0 ? <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={m === 0 ? INK : INK2} fontWeight={m === 0 ? 600 : 400}>{slotLabel(m)}</text> : null))}
          {minutes.includes(0) && <line x1={x(minutes.indexOf(0))} x2={x(minutes.indexOf(0))} y1={PAD.t} y2={PAD.t + ih} stroke={AXIS} strokeDasharray="2 3" />}
          {sel >= 0 && (
            <g>
              <rect x={x(sel) - Math.max(4, iw / minutes.length / 2)} y={PAD.t} width={Math.max(8, iw / minutes.length)} height={ih} fill={SEL} opacity="0.07" />
              <line x1={x(sel)} x2={x(sel)} y1={PAD.t} y2={PAD.t + ih} stroke={SEL} strokeWidth="1.5" />
            </g>
          )}
          {hover !== null && hover !== sel && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke={AXIS} />}
          {series.filter((s) => s.band).map((s) => <path key={`${s.key}-band`} d={bandPath(s.band, x, y)} fill={s.color} opacity="0.18" />)}
          {series.map((s) => (
            <path key={s.key} d={path(s.values, x, y)} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" opacity={s.quiet ? 0.7 : 1} />
          ))}
          {/* Actual scans also as dots, so a single recorded slot is visible */}
          {series.filter((s) => s.kind === 'actual').map((s) => s.values.map((v, i) => (v === null ? null : <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r="3.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />)))}
          {sel >= 0 && main.map((s) => (s.values[sel] === null ? null : <circle key={`sel-${s.key}`} cx={x(sel)} cy={y(s.values[sel])} r="5" fill={s.color} stroke="#fff" strokeWidth="2" />))}
          {ends.map((e) => <text key={`end-${e.s.key}`} x={x(e.i) + 8} y={e.ly + 4} fontSize="12" fill={INK}>{e.s.name}</text>)}
          {pOver && (
            <g transform={`translate(0, ${H})`}>
              <text x={PAD.l} y={10} fontSize="11" fill={INK2}>AI: chance of going over capacity</text>
              {pOver.map((p, i) => (p === null ? null : (
                <rect key={i} x={x(i) - Math.max(2, iw / minutes.length / 2 - 1)} y={14 + STRIP - p * STRIP} width={Math.max(3, iw / minutes.length - 2)} height={Math.max(1, p * STRIP)}
                  fill="#f47230" opacity={i === sel ? 1 : 0.55} rx="1.5" />
              )))}
              <line x1={PAD.l} x2={PAD.l + iw} y1={14 + STRIP} y2={14 + STRIP} stroke={AXIS} />
              {sel >= 0 && pOver[sel] !== null && <text x={PAD.l + iw + 8} y={14 + STRIP - 4} fontSize="12" fill={INK}>{pct(pOver[sel])}</text>}
            </g>
          )}
        </svg>
        {shown !== null && (
          <div className="tl-mc-tip" style={{ left: Math.min(x(shown) + 14, W - 220), top: PAD.t }}>
            <b>{slotText(minutes[shown])}</b>
            {series.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} />{s.name}<em>{fmt(s.values[shown])}{s.band && s.band[0][shown] !== null ? ` (${fmt(s.band[0][shown])}–${fmt(s.band[1][shown])})` : ''}</em></span>
            ))}
            {pOver && <span><i style={{ background: '#f47230' }} />Chance over capacity<em>{pct(pOver[shown])}</em></span>}
          </div>
        )}
      </div>
      {truncated && <p className="tl-pn-sub">Showing the first 8 gates together; choose a gate to see any other.</p>}
      {(gateId ? series.some((s) => s.kind === 'rule') : shownSource === 'rule') && <p className="tl-cf-note">{ruleNote(data)}</p>}
      <p className="tl-pn-sub" style={{ margin: '4px 0 0' }}>
        Selected: <b>{slotText(slot)}</b>. Click the chart (or use the arrow keys) to choose a slot: the 3D view below follows. Missing values are left blank, never counted as 0.
      </p>
      <details className="tl-mc-table">
        <summary>Show as a table</summary>
        <div className="tl-ml-scroll">
          <table className="tl-ml-table">
            <thead><tr><th>Slot</th>{series.map((s) => <th key={s.key} className="num">{s.name}</th>)}{pOver && <th className="num">Chance over capacity</th>}</tr></thead>
            <tbody>{minutes.map((m, i) => (
              <tr key={m} style={i === sel ? { background: '#f3faf4' } : undefined}>
                <td>{slotLabel(m)}</td>
                {series.map((s) => <td key={s.key} className="num">{fmt(s.values[i])}{s.band && s.band[0][i] !== null ? ` (${fmt(s.band[0][i])}–${fmt(s.band[1][i])})` : ''}</td>)}
                {pOver && <td className="num">{pct(pOver[i])}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
