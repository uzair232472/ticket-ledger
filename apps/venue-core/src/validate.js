import { boxesOverlap, bounds, pointInPolygon, shapePolygon } from './geometry.js';
import { LIMITS, gaOf, generateSection, tablesOf } from './generate.js';

const BOOKINGS = ['seats', 'ga', 'tables'];
const finite = (...vals) => vals.every((v) => typeof v === 'number' && Number.isFinite(v));

function shapeError(shape) {
  if (!shape || typeof shape !== 'object') return 'missing shape';
  if (shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = shape;
    if (!finite(cx, cy, r0, r1, a0, a1)) return 'arc values must be numbers';
    if (r0 < 0 || r1 <= r0) return 'outer radius must be larger than inner radius';
    if (a1 <= a0 || a1 - a0 > 360) return 'end angle must be after start angle (at most 360°)';
    return null;
  }
  if (shape.type === 'rect') {
    const { x, y, w, h, rotation = 0 } = shape;
    if (!finite(x, y, w, h, rotation)) return 'block values must be numbers';
    if (w <= 0 || h <= 0) return 'width and depth must be positive';
    return null;
  }
  if (shape.type === 'polygon') {
    if (!Array.isArray(shape.points) || shape.points.length < 3 || shape.points.length > 200) return 'a custom shape needs 3–200 points';
    if (!shape.points.every((p) => Array.isArray(p) && finite(p[0], p[1]))) return 'points must be numbers';
    return null;
  }
  return 'unknown shape type';
}

function segmentsCross([a, b], [c, d]) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function polygonsOverlap(p, q) {
  if (p.some((pt) => pointInPolygon(pt, q)) || q.some((pt) => pointInPolygon(pt, p))) return true;
  for (let i = 0; i < p.length; i++) {
    const e1 = [p[i], p[(i + 1) % p.length]];
    for (let j = 0; j < q.length; j++) if (segmentsCross(e1, [q[j], q[(j + 1) % q.length]])) return true;
  }
  return false;
}

/**
 * Validates a whole layout. With `requireTiers` every section must reference one of `tierIds`
 * (publishing); drafts may be incomplete. Returns errors/warnings plus each section's generated seats.
 */
export function validateLayout(layout, { tierIds = null, requireTiers = false } = {}) {
  const errors = [];
  const warnings = [];
  const generated = new Map();
  const totals = { positions: 0, blocked: 0, sellable: 0, tables: 0, guests: 0 };
  const err = (message, sectionId) => errors.push({ message, sectionId });

  if (!layout || typeof layout !== 'object') return { errors: [{ message: 'Layout is missing.' }], warnings, generated, totals };
  const { coordinate, sections } = layout;
  if (!coordinate || !finite(coordinate.width, coordinate.height) || coordinate.width <= 0 || coordinate.height <= 0 || coordinate.width > 5000 || coordinate.height > 5000) {
    err('The layout size is invalid.');
  }
  if (!Array.isArray(sections)) return { errors: [...errors, { message: 'Sections are missing.' }], warnings, generated, totals };
  if (sections.length > LIMITS.sections) err(`At most ${LIMITS.sections} sections.`);
  if (requireTiers && !sections.length) err('Add at least one section before publishing.');

  const ids = new Set();
  const names = new Set();
  const outlines = [];
  for (const s of sections) {
    const label = s?.name ? `“${s.name}”` : 'A section';
    if (!s || typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(s.id) || ids.has(s.id)) {
      err(`${label} has a missing or duplicate identifier.`, s?.id);
      continue;
    }
    ids.add(s.id);
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 60) err(`${label}: name must be 1–60 characters.`, s.id);
    else if (names.has(name.toLowerCase())) err(`Two sections are named “${name}”. Section names must be unique.`, s.id);
    names.add(name.toLowerCase());
    if (!BOOKINGS.includes(s.booking)) err(`${label}: unknown booking type.`, s.id);
    const se = shapeError(s.shape);
    if (se) {
      err(`${label}: ${se}.`, s.id);
      continue;
    }
    if (requireTiers && !s.tierId) err(`${label}: choose a pricing tier.`, s.id);
    if (s.tierId && tierIds && !tierIds.includes(s.tierId)) err(`${label}: its pricing tier no longer exists.`, s.id);
    if (s.booking === 'tables' && tablesOf(s).mode !== 'whole' && tablesOf(s).mode !== 'seat') err(`${label}: unknown table booking mode.`, s.id);
    if (s.booking === 'ga' && !Number.isFinite(Number(gaOf(s).capacity))) err(`${label}: capacity must be a number.`, s.id);

    const g = generateSection(s);
    generated.set(s.id, g);
    g.issues.forEach((i) => (i.level === 'error' ? err(`${label}: ${i.message}`, s.id) : warnings.push({ message: `${label}: ${i.message}`, sectionId: s.id })));
    totals.positions += g.stats.positions;
    totals.blocked += g.stats.blocked;
    totals.sellable += g.stats.sellable;
    totals.tables += g.stats.tables;
    totals.guests += g.stats.guests;

    const poly = shapePolygon(s.shape, 24);
    const box = bounds(poly);
    if (coordinate && (box.x < -1 || box.y < -1 || box.maxX > coordinate.width + 1 || box.maxY > coordinate.height + 1)) {
      warnings.push({ message: `${label} extends beyond the edge of the plan.`, sectionId: s.id });
    }
    outlines.push({ id: s.id, name, poly, box });
  }

  for (let i = 0; i < outlines.length; i++) {
    for (let j = i + 1; j < outlines.length; j++) {
      const a = outlines[i];
      const b = outlines[j];
      if (boxesOverlap(a.box, b.box) && polygonsOverlap(a.poly, b.poly)) err(`“${a.name}” overlaps “${b.name}”. Move or resize one of them.`, a.id);
    }
  }
  if (totals.positions > LIMITS.totalPositions) err(`The venue has ${totals.positions} positions; the maximum is ${LIMITS.totalPositions}.`);

  return { errors, warnings, generated, totals };
}
