/**
 * Plain 2D geometry in the layout's coordinate system (SVG convention: x right, y down, angles in
 * degrees measured clockwise from +x). Shared by the organizer editor, the attendee map and the API.
 */

export const DEG = Math.PI / 180;
export const ARC_SEGMENTS = 48;

export const polar = (cx, cy, r, deg) => [cx + r * Math.cos(deg * DEG), cy + r * Math.sin(deg * DEG)];

export function rotate([x, y], deg, [cx, cy] = [0, 0]) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

export const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

/** Outline of a section shape as a closed polygon (arcs are sampled). */
export function shapePolygon(shape, segments = ARC_SEGMENTS) {
  if (shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = shape;
    const n = Math.max(4, Math.ceil((segments * (a1 - a0)) / 90));
    const outer = [];
    const inner = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      outer.push(polar(cx, cy, r1, a));
      inner.push(polar(cx, cy, r0, a));
    }
    return [...outer, ...inner.reverse()];
  }
  if (shape.type === 'rect') {
    const { x, y, w, h, rotation = 0 } = shape;
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map((p) => {
      const [rx, ry] = rotate(p, rotation);
      return [x + rx, y + ry];
    });
  }
  return shape.points.map((p) => [p[0], p[1]]);
}

/** Crisp SVG path for a section outline (true arcs for arc sections). */
export function shapePath(shape) {
  if (shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = shape;
    const large = a1 - a0 > 180 ? 1 : 0;
    const [ox0, oy0] = polar(cx, cy, r1, a0);
    const [ox1, oy1] = polar(cx, cy, r1, a1);
    const [ix1, iy1] = polar(cx, cy, r0, a1);
    const [ix0, iy0] = polar(cx, cy, r0, a0);
    return `M${round(ox0)} ${round(oy0)}A${r1} ${r1} 0 ${large} 1 ${round(ox1)} ${round(oy1)}L${round(ix1)} ${round(iy1)}A${r0} ${r0} 0 ${large} 0 ${round(ix0)} ${round(iy0)}Z`;
  }
  const pts = shapePolygon(shape);
  return `M${pts.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
}

export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, maxX, maxY };
}

export const boxesOverlap = (a, b) => a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY;

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = bounds(poly);
    return [b.x + b.w / 2, b.y + b.h / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Where the section's name sits, and the angle that keeps it readable. */
export function shapeAnchor(shape) {
  if (shape.type === 'arc') {
    const mid = (shape.a0 + shape.a1) / 2;
    const [x, y] = polar(shape.cx, shape.cy, (shape.r0 + shape.r1) / 2, mid);
    let angle = mid + 90;
    angle = ((angle % 360) + 360) % 360;
    if (angle > 90 && angle < 270) angle -= 180;
    return { x, y, angle };
  }
  if (shape.type === 'rect') {
    let angle = ((shape.rotation || 0) % 360 + 360) % 360;
    if (angle > 90 && angle < 270) angle -= 180;
    return { x: shape.x, y: shape.y, angle };
  }
  const [x, y] = polygonCentroid(shape.points);
  return { x, y, angle: 0 };
}

/** Moves a shape by a drag from `from` to `to`; arc sections slide around their centre. */
export function moveShape(shape, from, to) {
  if (shape.type === 'arc') {
    const before = Math.atan2(from[1] - shape.cy, from[0] - shape.cx) / DEG;
    const after = Math.atan2(to[1] - shape.cy, to[0] - shape.cx) / DEG;
    let d = after - before;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return { ...shape, a0: round(shape.a0 + d), a1: round(shape.a1 + d) };
  }
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (shape.type === 'rect') return { ...shape, x: round(shape.x + dx), y: round(shape.y + dy) };
  return { ...shape, points: shape.points.map(([x, y]) => [round(x + dx), round(y + dy)]) };
}

/** Rectangle-ish edit handles for resizing (rect: corner; arc: radii/angles; polygon: vertices). */
export function shapeBounds(shape) {
  return bounds(shapePolygon(shape));
}

/** For a horizontal line y, the widest interval of x inside the polygon (or null). */
export function widestChord(poly, y) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  }
  return best;
}
