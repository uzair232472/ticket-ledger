import React, { useEffect, useRef, useState } from 'react';

/*
 * Small SVG charts for the model card (AI monitor). Colour by role, never by rank: the model is always series 1
 * (blue), the current rule series 2 (orange); validated pair (CVD ΔE 26.6). Orange is under 3:1 on white, so
 * every chart also has direct labels or a table view. Hover shows a tooltip; the plot is never the only copy of
 * the numbers.
 */
export const SERIES = { model: '#257de0', rule: '#f47230' };
const INK = '#191919', INK2 = '#666666', GRID = '#e7e7e7', AXIS = '#c2c2c2';
const PAD = { l: 44, r: 92, t: 12, b: 28 };

function useWidth(min = 280) {
  const ref = useRef(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}

const niceTicks = (lo, hi, n = 4) => {
  if (!(hi > lo)) { const d = Math.abs(lo) || 1; lo -= d * 0.1; hi += d * 0.1; }
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), k = step0 / mag;
  const step = (k > 5 ? 10 : k > 2 ? 5 : k > 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v / step) * step);
  return out;
};

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="tl-mc-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <b>{tip.title}</b>
      {tip.rows.map((r) => <span key={r.label}><i style={{ background: r.color }} />{r.label}<em>{r.value}</em></span>)}
    </div>
  );
}

/** Lines over ordered slices. series: [{ key, name, color, values: [number|null] }]; labels: x labels. */
export function LineChart({ labels, series, format = (v) => v, height = 220, ariaLabel }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const vals = series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  if (!vals.length) return <p className="tl-pn-sub">No values to plot.</p>;
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const iw = W - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const x = (i) => PAD.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const path = (values) => values.reduce((d, v, i) => (v === null || !Number.isFinite(v) ? d : `${d}${d && values[i - 1] !== null && Number.isFinite(values[i - 1]) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
  const last = (values) => { for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null && Number.isFinite(values[i])) return i; return -1; };
  // Direct labels at the line ends, nudged apart when they would collide
  const ends = series.map((s) => ({ s, i: last(s.values) })).filter((e) => e.i >= 0).map((e) => ({ ...e, ly: y(e.s.values[e.i]) })).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 14) ends[k].ly = ends[k - 1].ly + 14;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    labels.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };
  const tip = hover === null ? null : {
    x: Math.min(x(hover) + 12, W - 180), y: PAD.t, title: labels[hover],
    rows: series.map((s) => ({ label: s.name, color: s.color, value: s.values[hover] === null || !Number.isFinite(s.values[hover]) ? '—' : format(s.values[hover]) })),
  };
  return (
    <div ref={ref} className="tl-mc-chart">
      <svg width={W} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK2}>{format(t)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih} y2={PAD.t + ih} stroke={AXIS} />
        {labels.map((l, i) => <text key={l + i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={INK2}>{l}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke={AXIS} />}
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={s.color} stroke="#fff" strokeWidth="2" />
            )))}
          </g>
        ))}
        {ends.map((e) => <text key={e.s.key} x={x(e.i) + 10} y={e.ly + 4} fontSize="12" fill={INK}>{e.s.name}</text>)}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Predicted vs actual rate per bin, with the "perfectly calibrated" diagonal. bins: [{predicted, actual, rows}] */
export function CalibrationChart({ bins, height = 240 }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const size = Math.min(W - PAD.l - 24, height - PAD.t - PAD.b);
  const max = Math.min(1, Math.max(0.05, ...bins.map((b) => Math.max(b.predicted, b.actual))) * 1.05);
  const ticks = niceTicks(0, max, 4).filter((t) => t <= max + 1e-9);
  const top = ticks[ticks.length - 1] || max;
  const x = (v) => PAD.l + (v / top) * size, y = (v) => PAD.t + size - (v / top) * size;
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  const tip = hover === null ? null : {
    x: Math.min(x(bins[hover].predicted) + 12, W - 180), y: Math.max(0, y(bins[hover].actual) - 40), title: `Bin ${hover + 1} (${bins[hover].rows.toLocaleString()} rows)`,
    rows: [{ label: 'Predicted', color: SERIES.model, value: pct(bins[hover].predicted) }, { label: 'Actually happened', color: INK2, value: pct(bins[hover].actual) }],
  };
  return (
    <div ref={ref} className="tl-mc-chart">
      <svg width={W} height={size + PAD.t + PAD.b} role="img" aria-label="Calibration: predicted rate against the rate that actually happened">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + size} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK2}>{pct(t)}</text>
            <text x={x(t)} y={PAD.t + size + 16} textAnchor="middle" fontSize="11" fill={INK2}>{pct(t)}</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(top)} y2={y(top)} stroke={AXIS} strokeDasharray="4 4" />
        <text x={x(top) - 4} y={y(top) + 14} textAnchor="end" fontSize="11" fill={INK2}>perfect</text>
        <polyline points={bins.map((b) => `${x(b.predicted)},${y(b.actual)}`).join(' ')} fill="none" stroke={SERIES.model} strokeWidth="2" />
        {bins.map((b, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(b.predicted)} cy={y(b.actual)} r="12" fill="transparent" />
            <circle cx={x(b.predicted)} cy={y(b.actual)} r={hover === i ? 6 : 4.5} fill={SERIES.model} stroke="#fff" strokeWidth="2" />
          </g>
        ))}
        <text x={PAD.l + size + 8} y={PAD.t + 12} fontSize="11" fill={INK2}>actual ↑</text>
        <text x={PAD.l + size} y={PAD.t + size + PAD.b - 2} textAnchor="end" fontSize="11" fill={INK2}>predicted →</text>
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

/** Horizontal bars, one series. items: [{ label, value, note? }] */
export function BarList({ items, format = (v) => v, color = SERIES.model }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return (
    <ul className="tl-mc-bars">
      {items.map((it, k) => (
        <li key={it.label} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} data-hover={hover === k || undefined}>
          <span className="tl-mc-bars-l">{it.label}</span>
          <span className="tl-mc-bars-t"><i style={{ width: `${Math.max(1, (Math.max(0, it.value) / max) * 100)}%`, background: color }} /></span>
          <b>{format(it.value)}</b>
          {hover === k && it.note && <em className="tl-mc-bars-n">{it.note}</em>}
        </li>
      ))}
    </ul>
  );
}

export function Legend({ items }) {
  return (
    <div className="tl-mc-legend">
      {items.map((i) => <span key={i.name}><i style={{ background: i.color }} />{i.name}</span>)}
    </div>
  );
}
