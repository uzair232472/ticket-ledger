import React from 'react';
import { DEG, moveShape, polar, rotate, round, shapePath } from '@venue-core';

/**
 * Direct-manipulation handles drawn inside the map's SVG for the selected section (or the stage/pitch).
 * Drags run on window listeners so they keep tracking outside the map; each drag is one undo step.
 */
export default function EditorOverlay({ camera, section, feature, featureSelected, tool, drawPoints, handlePx, onShape, onFeature, onCommit }) {
  const r = handlePx; // handle radius in layout units (constant on screen)

  const drag = (e, apply) => {
    e.stopPropagation();
    e.preventDefault();
    const start = camera.toSvg(e.clientX, e.clientY);
    const move = (ev) => apply(camera.toSvg(ev.clientX, ev.clientY), start, ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onCommit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const H = ({ x, y, onDown, cls = '', label, onDoubleClick }) => (
    <circle className={`tl-ve-handle ${cls}`} data-handle="1" cx={x} cy={y} r={r} onPointerDown={onDown} onDoubleClick={onDoubleClick} aria-hidden="true">
      {label && <title>{label}</title>}
    </circle>
  );

  if (tool === 'draw') {
    if (!drawPoints.length) return null;
    const d = `M${drawPoints.map((p) => `${p[0]} ${p[1]}`).join('L')}`;
    return (
      <g pointerEvents="none">
        <path className="tl-ve-draw" d={drawPoints.length > 2 ? `${d}Z` : d} />
        {drawPoints.map((p, i) => (
          <circle key={i} className="tl-ve-handle" cx={p[0]} cy={p[1]} r={i === 0 ? r * 1.4 : r} />
        ))}
      </g>
    );
  }

  if (featureSelected && feature && feature.kind !== 'none') {
    const { x, y, w, h, rotation = 0 } = feature;
    const corner = (sx, sy) => {
      const [cx, cy] = rotate([(sx * w) / 2, (sy * h) / 2], rotation);
      return (
        <H
          key={`${sx}${sy}`}
          x={x + cx}
          y={y + cy}
          label="Resize"
          onDown={(e) =>
            drag(e, (p) => {
              const [lx, ly] = rotate([p.x - x, p.y - y], -rotation);
              onFeature({ ...feature, w: round(Math.max(20, Math.abs(lx) * 2)), h: round(Math.max(12, Math.abs(ly) * 2)) });
            })
          }
        />
      );
    };
    return (
      <g>
        <rect
          data-handle="1"
          x={x - w / 2}
          y={y - h / 2}
          width={w}
          height={h}
          transform={`rotate(${rotation} ${x} ${y})`}
          fill="transparent"
          className="tl-ve-guide"
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onPointerDown={(e) => drag(e, (p, s) => onFeature({ ...feature, x: round(x + p.x - s.x), y: round(y + p.y - s.y) }))}
        />
        {corner(-1, -1)}
        {corner(1, -1)}
        {corner(1, 1)}
        {corner(-1, 1)}
      </g>
    );
  }

  if (!section || tool !== 'select') return null;
  const { shape } = section;
  const body = (
    <path
      data-handle="1"
      d={shapePath(shape)}
      fill="transparent"
      className="tl-ve-guide"
      style={{ pointerEvents: 'all', cursor: 'move' }}
      onPointerDown={(e) => drag(e, (p, s) => onShape(moveShape(shape, [s.x, s.y], [p.x, p.y])))}
    />
  );

  if (shape.type === 'rect') {
    const { x, y, w, h, rotation = 0 } = shape;
    const corner = (sx, sy) => {
      const [cx, cy] = rotate([(sx * w) / 2, (sy * h) / 2], rotation);
      return (
        <H
          key={`${sx}${sy}`}
          x={x + cx}
          y={y + cy}
          label="Resize"
          onDown={(e) =>
            drag(e, (p) => {
              const [lx, ly] = rotate([p.x - x, p.y - y], -rotation);
              onShape({ ...shape, w: round(Math.max(16, Math.abs(lx) * 2)), h: round(Math.max(16, Math.abs(ly) * 2)) });
            })
          }
        />
      );
    };
    // Rotation knob sits beyond the section's front (the side that faces the stage/pitch)
    const [kx, ky] = rotate([0, -h / 2 - r * 4], rotation);
    return (
      <g>
        {body}
        <line className="tl-ve-guide" x1={x} y1={y} x2={x + kx} y2={y + ky} />
        {corner(-1, -1)}
        {corner(1, -1)}
        {corner(1, 1)}
        {corner(-1, 1)}
        <H
          x={x + kx}
          y={y + ky}
          cls="is-rotate"
          label="Rotate (front faces this way)"
          onDown={(e) =>
            drag(e, (p, _s, ev) => {
              let a = Math.atan2(p.y - y, p.x - x) / DEG + 90;
              if (ev.shiftKey) a = Math.round(a / 15) * 15;
              onShape({ ...shape, rotation: round(((a % 360) + 360) % 360, 1) });
            })
          }
        />
      </g>
    );
  }

  if (shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = shape;
    const mid = (a0 + a1) / 2;
    const rm = (r0 + r1) / 2;
    const angleAt = (p, near) => {
      let a = Math.atan2(p.y - cy, p.x - cx) / DEG;
      while (a - near > 180) a -= 360;
      while (near - a > 180) a += 360;
      return round(a, 1);
    };
    const [ix, iy] = polar(cx, cy, r0, mid);
    const [ox, oy] = polar(cx, cy, r1, mid);
    const [sx, sy] = polar(cx, cy, rm, a0);
    const [ex, ey] = polar(cx, cy, rm, a1);
    const dist = (p) => Math.hypot(p.x - cx, p.y - cy);
    return (
      <g>
        {body}
        <H x={ix} y={iy} label="Inner edge (front row)" onDown={(e) => drag(e, (p) => onShape({ ...shape, r0: round(Math.max(0, Math.min(r1 - 12, dist(p)))) }))} />
        <H x={ox} y={oy} label="Outer edge" onDown={(e) => drag(e, (p) => onShape({ ...shape, r1: round(Math.max(r0 + 12, dist(p))) }))} />
        <H x={sx} y={sy} label="Start angle" onDown={(e) => drag(e, (p) => onShape({ ...shape, a0: Math.min(a1 - 2, angleAt(p, a0)) }))} />
        <H x={ex} y={ey} label="End angle" onDown={(e) => drag(e, (p) => onShape({ ...shape, a1: Math.max(a0 + 2, angleAt(p, a1)) }))} />
      </g>
    );
  }

  // Polygon: drag vertices, "+" on edges inserts a point, double-click a point to remove it
  const pts = shape.points;
  return (
    <g>
      {body}
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return (
          <H
            key={`m${i}`}
            x={(p[0] + q[0]) / 2}
            y={(p[1] + q[1]) / 2}
            cls="is-add"
            label="Add a point"
            onDown={(e) => {
              const next = [...pts.slice(0, i + 1), [round((p[0] + q[0]) / 2), round((p[1] + q[1]) / 2)], ...pts.slice(i + 1)];
              onShape({ ...shape, points: next });
              drag(e, (pt) => onShape({ ...shape, points: next.map((v, k) => (k === i + 1 ? [round(pt.x), round(pt.y)] : v)) }));
            }}
          />
        );
      })}
      {pts.map((p, i) => (
        <H
          key={`v${i}`}
          x={p[0]}
          y={p[1]}
          label="Drag to move · double-click to remove"
          onDown={(e) => drag(e, (pt) => onShape({ ...shape, points: pts.map((v, k) => (k === i ? [round(pt.x), round(pt.y)] : v)) }))}
          onDoubleClick={() => pts.length > 3 && (onShape({ ...shape, points: pts.filter((_, k) => k !== i) }), onCommit())}
        />
      ))}
    </g>
  );
}
