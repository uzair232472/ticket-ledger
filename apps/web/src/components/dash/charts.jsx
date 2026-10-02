import React, { useId, useLayoutEffect, useRef, useState } from 'react';

/*
 * Small static SVG charts for the consoles (no entry animation). Marks follow the console palette in
 * dash.css: series --ds-s1 green, --ds-s2 blue, --ds-s3 amber; hairline grid; text in ink tokens only.
 * Every chart has a hover tooltip and a text alternative (aria-label / legend values).
 */

// Colours come from the theme (dash.css, studio.css), validated per surface
export const SERIES = ['var(--ds-s1)', 'var(--ds-s2)', 'var(--ds-s3)'];
export const NEUTRAL = 'var(--ds-s4)';

const compact = (v) => {
  const n = Number(v) || 0;
  const trim = (v, d) => v.toFixed(d).replace(/\.0$/, '');
  if (Math.abs(n) >= 1e6) return `${trim(n / 1e6, n >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `${trim(n / 1e3, n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};
export const formatPkr = (v) => `PKR ${Math.round(Number(v) || 0).toLocaleString()}`;
export const compactPkr = (v) => `PKR ${compact(v)}`;

// Round the axis maximum up to a clean step (1, 2, 2.5, 5 × 10^n), with four gridlines
function niceScale(max) {
  if (!max || max <= 0) return { top: 4, step: 1 };
  // Whole-number data (counts) never gets fractional steps
  if (Number.isInteger(max) && max <= 4) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: step * 4, step };
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    setWidth(ref.current.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Show at most ~`max` evenly spaced category labels
const labelEvery = (count, max) => Math.max(1, Math.ceil(count / max));

/** Vertical columns from one baseline, 4px rounded tops, value tooltip on hover. data = [{ label, value }]. */
export function ColumnChart({ data, height = 190, color = SERIES[0], format = compact, tipFormat = format, label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="tl-chart-empty">No data for this period yet.</div>;

  const left = 40;
  const bottom = 22;
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom;
  const { top, step } = niceScale(Math.max(...data.map((d) => d.value)));
  const band = plotW / data.length;
  const barW = Math.max(3, Math.min(24, band - 2));
  const every = labelEvery(data.length, Math.max(2, Math.floor(plotW / 64)));
  const y = (v) => plotH - (v / top) * plotH;

  return (
    <div ref={ref} className="tl-chart" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label || `Column chart of ${data.length} values`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line className="tl-chart-grid" x1={left} x2={width} y1={y(step * i)} y2={y(step * i)} />
              <text className="tl-chart-axis" x={0} y={y(step * i) + 3}>{format(step * i)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = left + band * i + (band - barW) / 2;
            const h = Math.max(d.value > 0 ? 2 : 0, plotH - y(d.value));
            const r = Math.min(4, barW / 2, h);
            return (
              <g key={d.key || d.label}>
                <path
                  d={`M${x},${plotH} V${plotH - h + r} Q${x},${plotH - h} ${x + r},${plotH - h} H${x + barW - r} Q${x + barW},${plotH - h} ${x + barW},${plotH - h + r} V${plotH} Z`}
                  style={{ fill: color }}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                />
                {i % every === 0 && (
                  <text className="tl-chart-axis" x={x + barW / 2} y={height - 6} textAnchor="middle">{d.label}</text>
                )}
                {/* Hit target covers the whole band, taller than the mark */}
                <rect x={left + band * i} y={0} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && (
        <div className="tl-chart-tip" style={{ left: left + band * hover + band / 2, top: y(data[hover].value) }}>
          <span>{data[hover].tip || data[hover].label}</span>
          <strong>{tipFormat(data[hover].value)}</strong>
        </div>
      )}
    </div>
  );
}

// Smooth curve through the points (Catmull-Rom → cubic Bézier), clamped to the plot so it never dips below 0
function smoothPath(pts, minY, maxY) {
  if (pts.length < 2) return '';
  const clamp = (v) => Math.min(maxY, Math.max(minY, v));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Multi-series smooth lines on one axis with a crosshair tooltip. series = [{ label, color, values }]. */
export function LineChart({ labels, series, height = 210, format = compact, label, area = false, endDot = false }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  if (!labels.length) return <div className="tl-chart-empty">No data for this period yet.</div>;

  const left = 40;
  const right = 8;
  const bottom = 22;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - bottom;
  const { top, step } = niceScale(Math.max(...series.flatMap((s) => s.values)));
  const x = (i) => left + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const y = (v) => plotH - (v / top) * plotH;
  const every = labelEvery(labels.length, Math.max(2, Math.floor(plotW / 64)));

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left - left;
    const i = labels.length === 1 ? 0 : Math.round((px / plotW) * (labels.length - 1));
    setHover(Math.min(labels.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="tl-chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label || `Line chart, ${series.map((s) => s.label).join(', ')}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line className="tl-chart-grid" x1={left} x2={width - right} y1={y(step * i)} y2={y(step * i)} />
              <text className="tl-chart-axis" x={0} y={y(step * i) + 3}>{format(step * i)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={l} className="tl-chart-axis" x={x(i)} y={height - 6} textAnchor="middle">{l}</text> : null))}
          {hover != null && <line className="tl-chart-cross" x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} />}
          {/* Drawn last-to-first so the first (primary) series stays on top where lines overlap */}
          {[...series].reverse().map((s) => {
            const pts = s.values.map((v, i) => [x(i), y(v)]);
            const line = smoothPath(pts, 0, plotH);
            const primary = s === series[0];
            return (
              <g key={s.label}>
                {/* A 10% wash under the primary series */}
                {area && primary && pts.length > 1 && (
                  <path d={`${line} L${pts[pts.length - 1][0]},${plotH} L${pts[0][0]},${plotH} Z`} style={{ fill: s.color, opacity: 0.12 }} />
                )}
                <path d={line} fill="none" style={{ stroke: s.color }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {endDot && primary && pts.length > 1 && hover == null && (
                  <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" style={{ fill: s.color, stroke: 'var(--ds-card)' }} strokeWidth="2" />
                )}
                {pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="4" style={{ fill: s.color, stroke: 'var(--ds-card)' }} strokeWidth="2" />}
                {hover != null && <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" style={{ fill: s.color, stroke: 'var(--ds-card)' }} strokeWidth="2" />}
              </g>
            );
          })}
          <rect x={left} y={0} width={plotW} height={plotH} fill="transparent" />
        </svg>
      )}
      {hover != null && (
        <div className="tl-chart-tip" style={{ left: x(hover), top: Math.min(...series.map((s) => y(s.values[hover]))) }}>
          <span>{labels[hover]}</span>
          {series.map((s) => (
            <div key={s.label} className="tl-chart-tip-row">
              <span className="tl-legend-swatch" style={{ '--sw': s.color }} />
              <span>{s.label}</span>
              <strong style={{ marginLeft: 'auto', fontSize: 13 }}>{format(s.values[hover])}</strong>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    </div>
  );
}

export function Legend({ items, format }) {
  return (
    <div className="tl-legend">
      {items.map((it) => (
        <span key={it.label} className="tl-legend-item">
          <span className="tl-legend-swatch" style={{ '--sw': it.color }} aria-hidden="true" />
          {it.label}
          {format && it.value != null && <strong>{format(it.value)}</strong>}
        </span>
      ))}
    </div>
  );
}

/** One stacked bar split into parts with 2px gaps, plus a legend. parts = [{ label, value, color }]. */
export function SplitBar({ parts, format = compact }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return null;
  return (
    <>
      <div className="tl-split" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} style={{ '--sw': p.color, flexGrow: p.value }} title={`${p.label}: ${format(p.value)}`} />
        ))}
      </div>
      <Legend items={parts} format={format} />
    </>
  );
}

/** Circle that fills to `value` percent with a still water line. */
export function FillGauge({ value, label }) {
  const id = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const level = 186 - (172 * v) / 100;
  const wave = (offset) => `M0,${level + offset} C40,${level - 9 + offset} 70,${level - 9 + offset} 100,${level + offset} S160,${level + 9 + offset} 200,${level + offset} V200 H0 Z`;
  return (
    <div className="tl-fill">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${label || 'Progress'}: ${v}%`}>
        <defs>
          <clipPath id={`fill-${id}`}><circle cx="100" cy="100" r="86" /></clipPath>
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" style={{ stroke: 'var(--ds-line)' }} strokeWidth="2" />
        <circle cx="100" cy="100" r="86" style={{ fill: 'var(--ds-fill-track)' }} />
        <g clipPath={`url(#fill-${id})`}>
          <path d={wave(-6)} style={{ fill: 'var(--ds-fill-back)' }} />
          <path d={wave(0)} style={{ fill: 'var(--ds-s1)' }} />
        </g>
        <text x="100" y="110" textAnchor="middle" className={`tl-fill-value${v < 45 ? ' is-low' : ''}`}>{Math.round(v)}%</text>
      </svg>
    </div>
  );
}

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arcPath = (cx, cy, r, from, to) => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1},${y1} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`;
};

/** 270° ring split into parts with gaps, figure in the middle. parts = [{ label, value, color }]. */
export function ArcGauge({ parts, value, caption, format = compact }) {
  const [hover, setHover] = useState(null);
  const total = parts.reduce((n, p) => n + p.value, 0);
  const start = -135;
  const sweep = 270;
  const gap = 9; // degrees between segments (round caps eat into it)
  const visible = parts.filter((p) => p.value > 0);
  const usable = sweep - gap * Math.max(0, visible.length - 1);
  let cursor = start;
  const segs = visible.map((p) => {
    const len = Math.max(2, (p.value / total) * usable);
    const seg = { ...p, from: cursor, to: cursor + len };
    cursor += len + gap;
    return seg;
  });
  return (
    <div className="tl-arc">
      <svg viewBox="0 0 240 200" role="img" aria-label={`${caption}: ${value}. ${parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
        {!total && <path d={arcPath(120, 112, 92, start, start + sweep)} fill="none" style={{ stroke: 'var(--ds-grid)' }} strokeWidth="20" strokeLinecap="round" />}
        {segs.map((s) => (
          <path
            key={s.label}
            d={arcPath(120, 112, 92, s.from, s.to)}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={hover === s.label ? 24 : 20}
            strokeLinecap="round"
            onMouseEnter={() => setHover(s.label)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${s.label}: ${format(s.value)}`}</title>
          </path>
        ))}
      </svg>
      <div className="tl-arc-center">
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>
      <Legend items={parts} format={format} />
    </div>
  );
}

/** Inline fill meter for table cells. */
export function Meter({ value, color }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className="tl-meter">
      <span className="tl-meter-track"><span className="tl-meter-fill" style={{ width: `${v}%`, background: color }} /></span>
      <span>{Math.round(v)}%</span>
    </span>
  );
}

/** Group dated rows into the last `days` calendar days (oldest first), summing `pick(row)`. */
export function byDay(rows, { days = 14, dateOf, pick, end = new Date() }) {
  const buckets = [];
  const index = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const bucket = { key, date: d, label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), value: 0 };
    index.set(key, bucket);
    buckets.push(bucket);
  }
  rows.forEach((r) => {
    const d = new Date(dateOf(r));
    d.setHours(0, 0, 0, 0);
    const b = index.get(d.toISOString().slice(0, 10));
    if (b) b.value += pick(r);
  });
  return buckets;
}

/** Circular progress ring with the percentage in the middle. `muted` draws the progress in grey. */
export function Ring({ value, size = 76, stroke = 7, muted = false, label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="tl-ring" role="img" aria-label={`${label || 'Progress'}: ${v}%`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--st-ring-track, var(--ds-line))' }} strokeWidth={stroke} />
        {v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            style={{ stroke: muted ? 'var(--ds-s4)' : 'var(--ds-s2)' }}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
          />
        )}
      </svg>
      <span>{Number.isInteger(v) ? v : v.toFixed(1)}%</span>
    </span>
  );
}
