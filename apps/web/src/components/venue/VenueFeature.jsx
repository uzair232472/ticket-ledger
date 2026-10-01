import React from 'react';

/**
 * The playing area or stage, drawn from the organizer's configured position, size and rotation.
 * Markings are generic (proportional to the configured size) and purely visual.
 */
export default function VenueFeature({ feature, uid }) {
  if (!feature || feature.kind === 'none' || !feature.kind) return null;
  const { x, y, w, h, rotation = 0, kind, label } = feature;
  const hw = w / 2;
  const hh = h / 2;
  const line = { fill: 'none', stroke: 'rgba(255,255,255,0.85)', strokeWidth: Math.max(1, Math.min(w, h) * 0.006) };
  const stripes = `url(#${uid}-turf)`;

  let body;
  if (kind === 'cricket') {
    body = (
      <>
        <ellipse rx={hw} ry={hh} fill={stripes} stroke="#a7d3b1" strokeWidth={2} />
        <ellipse rx={hw * 0.94} ry={hh * 0.94} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} />
        <ellipse rx={hw * 0.48} ry={hh * 0.5} {...line} strokeDasharray="6 6" />
        <rect x={-hw * 0.035} y={-hh * 0.17} width={hw * 0.07} height={hh * 0.34} rx={2} fill="#e9dcbf" stroke="#d6c39b" />
      </>
    );
  } else if (kind === 'football' || kind === 'hockey') {
    const box = kind === 'football';
    body = (
      <>
        <rect x={-hw} y={-hh} width={w} height={h} rx={4} fill={stripes} stroke="#a7d3b1" strokeWidth={2} />
        <rect x={-hw * 0.95} y={-hh * 0.92} width={w * 0.95} height={h * 0.92} {...line} />
        <line x1={0} y1={-hh * 0.92} x2={0} y2={hh * 0.92} {...line} />
        {box ? (
          <>
            <circle r={Math.min(w, h) * 0.13} {...line} />
            <rect x={-hw * 0.95} y={-hh * 0.4} width={w * 0.15} height={h * 0.8} {...line} />
            <rect x={hw * 0.95 - w * 0.15} y={-hh * 0.4} width={w * 0.15} height={h * 0.8} {...line} />
          </>
        ) : (
          <>
            <path d={`M${-hw * 0.95} ${-hh * 0.45} A${h * 0.45} ${h * 0.45} 0 0 1 ${-hw * 0.95} ${hh * 0.45}`} {...line} />
            <path d={`M${hw * 0.95} ${-hh * 0.45} A${h * 0.45} ${h * 0.45} 0 0 0 ${hw * 0.95} ${hh * 0.45}`} {...line} />
            <line x1={-hw * 0.48} y1={-hh * 0.92} x2={-hw * 0.48} y2={hh * 0.92} {...line} strokeDasharray="5 5" />
            <line x1={hw * 0.48} y1={-hh * 0.92} x2={hw * 0.48} y2={hh * 0.92} {...line} strokeDasharray="5 5" />
          </>
        )}
      </>
    );
  } else if (kind === 'ring' || kind === 'court') {
    body =
      kind === 'ring' ? (
        <>
          <rect x={-hw} y={-hh} width={w} height={h} rx={3} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={2} />
          {[0.86, 0.72].map((k) => (
            <rect key={k} x={-hw * k} y={-hh * k} width={w * k} height={h * k} fill="none" stroke="#dc2626" strokeWidth={1.4} opacity={0.7} />
          ))}
        </>
      ) : (
        <>
          <rect x={-hw} y={-hh} width={w} height={h} rx={3} fill="#f3e2c3" stroke="#d6b98a" strokeWidth={2} />
          <line x1={0} y1={-hh} x2={0} y2={hh} stroke="#b45309" strokeWidth={1.4} />
        </>
      );
  } else if (kind === 'screen') {
    body = (
      <>
        <rect x={-hw} y={-hh} width={w} height={h} rx={6} fill={`url(#${uid}-stage)`} />
        <rect x={-hw * 0.8} y={-hh * 0.75} width={w * 0.8 * 2 / 2} height={h * 0.18} rx={2} fill="#cbd5e1" opacity={0.9} transform={`translate(${hw * 0.0},0)`} />
      </>
    );
  } else {
    body = <rect x={-hw} y={-hh} width={w} height={h} rx={Math.min(w, h) * 0.12} fill={`url(#${uid}-stage)`} />;
  }

  const dark = kind === 'stage' || kind === 'screen';
  return (
    <g className="tl-vm-feature" transform={`translate(${x} ${y}) rotate(${rotation})`} aria-hidden="true">
      {body}
      {label && (
        <text className="tl-vm-feature-label" y={kind === 'screen' ? hh * 0.35 : 0} fill={dark ? '#f8fafc' : 'rgba(21,83,45,0.75)'} fontSize={Math.max(10, Math.min(w, h) * (dark ? 0.26 : 0.09))}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Shared <defs>: turf stripes, stage gradient, sold-out hatching, section shadow. */
export function VenueDefs({ uid }) {
  return (
    <defs>
      <pattern id={`${uid}-turf`} width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
        <rect width="28" height="28" fill="#cfe9d4" />
        <rect width="14" height="28" fill="#c5e3cb" />
      </pattern>
      <linearGradient id={`${uid}-stage`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2b3743" />
        <stop offset="1" stopColor="#1b232c" />
      </linearGradient>
      <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="#eef2f6" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="2" />
      </pattern>
      <filter id={`${uid}-lift`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#0f172a" floodOpacity="0.18" />
      </filter>
    </defs>
  );
}
