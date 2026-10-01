import { DEG, bounds, pointInPolygon, polar, rotate, round, shapePolygon, widestChord, polygonCentroid } from './geometry.js';

/**
 * Seat generation. A section's configuration (shape + rows/tables/GA settings) deterministically
 * produces its seat positions, row labels, stable keys and capacity figures. The same function runs in
 * the organizer editor, the attendee map and the API (which turns the keys into Seat rows), so the
 * three can never disagree.
 *
 * Positions are placed from the viewer's left to right (facing the stage/pitch). `rows.numbering`
 * decides whether seat 1 is on the left ('ltr') or right ('rtl'). Aisles are gaps after a position
 * (1-based, counted from the left); blocked positions are "rowIndex:position" (0-based).
 */

export const DEFAULT_ROWS = {
  count: 8,
  seatsPerRow: 12,
  perRow: {},
  labelStyle: 'letters',
  labelStart: 'A',
  numbering: 'ltr',
  seatStart: 1,
  seatSpacing: 8,
  rowSpacing: 10,
  aisles: [],
  aisleWidth: 10,
  blocked: [],
  curve: 0,
  inset: 4,
};
export const DEFAULT_TABLES = { count: 6, seatsPerTable: 6, columns: 3, mode: 'seat', seatSpacing: 8, spacing: 0 };
export const DEFAULT_GA = { capacity: 200 };

export const LIMITS = {
  rows: 100,
  seatsPerRow: 200,
  sectionPositions: 5000,
  totalPositions: 60000,
  sections: 150,
  tables: 200,
  seatsPerTable: 16,
  wholeTableSeats: 10, // existing checkout allows at most 10 tickets per booking
  gaCapacity: 50000,
};

export const rowsOf = (section) => ({ ...DEFAULT_ROWS, ...(section.rows || {}) });
export const tablesOf = (section) => ({ ...DEFAULT_TABLES, ...(section.tables || {}) });
export const gaOf = (section) => ({ ...DEFAULT_GA, ...(section.ga || {}) });

export function rowLabel(index, style = 'letters', start = 'A') {
  if (style === 'numbers') return String((Number(start) || 1) + index);
  const base = Math.max(0, (String(start || 'A').toUpperCase().charCodeAt(0) || 65) - 65);
  let n = base + index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export const seatCountForRow = (rows, i) => {
  const v = rows.perRow?.[i] ?? rows.perRow?.[String(i)];
  return Math.max(0, Math.floor(Number(v ?? rows.seatsPerRow) || 0));
};

const aislesBefore = (aisles, p) => aisles.reduce((n, a) => n + (a < p + 1 && a >= 1 ? 1 : 0), 0);

/** Distance along the row of each position (positions are 0-based from the viewer's left). */
function rowOffsets(n, rows) {
  const aisles = (rows.aisles || []).map(Number).filter((a) => a >= 1 && a < n);
  const offsets = [];
  for (let p = 0; p < n; p++) offsets.push(p * rows.seatSpacing + aislesBefore(aisles, p) * rows.aisleWidth);
  const length = n ? offsets[n - 1] : 0;
  return { offsets, length };
}

/**
 * Each row as a "track": the usable length and a function placing a point at distance s from the
 * viewer's left end. Returns null when the row does not fit in the section's depth.
 */
function rowTracks(section, rows) {
  const { shape } = section;
  const tracks = [];
  const inset = rows.inset;

  if (shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = shape;
    for (let i = 0; i < rows.count; i++) {
      const r = r0 + inset + rows.rowSpacing * (i + 0.5);
      if (r > r1 - inset + 1e-6) {
        tracks.push(null);
        continue;
      }
      const margin = inset + rows.seatSpacing / 2;
      const length = Math.max(0, r * (a1 - a0) * DEG - 2 * margin);
      // Viewer faces the centre, so their left is the higher angle
      const at = (s) => {
        const ang = a1 - (margin + s) / r / DEG;
        return { x: cx + r * Math.cos(ang * DEG), y: cy + r * Math.sin(ang * DEG), facing: ang + 180 };
      };
      const labelAt = (side) => {
        const ang = side < 0 ? a1 - (margin * 0.35) / r / DEG : a0 + (margin * 0.35) / r / DEG;
        const [x, y] = polar(cx, cy, r, ang);
        return { x, y };
      };
      tracks.push({ length, at, labelAt });
    }
    return tracks;
  }

  // Rect and polygon: rows are straight (optionally bowed) lines in a local frame facing "up" (-y)
  let localPoly;
  let toWorld;
  let facing;
  if (shape.type === 'rect') {
    facing = shape.rotation || 0;
    localPoly = [
      [-shape.w / 2, -shape.h / 2],
      [shape.w / 2, -shape.h / 2],
      [shape.w / 2, shape.h / 2],
      [-shape.w / 2, shape.h / 2],
    ];
    toWorld = ([x, y]) => {
      const [rx, ry] = rotate([x, y], facing);
      return [shape.x + rx, shape.y + ry];
    };
  } else {
    facing = shape.facing || 0;
    const c = polygonCentroid(shape.points);
    localPoly = shape.points.map((p) => {
      const [x, y] = rotate(p, -facing, c);
      return [x - c[0], y - c[1]];
    });
    toWorld = ([x, y]) => rotate([x + c[0], y + c[1]], facing, c);
  }
  const b = bounds(localPoly);
  const bow = (rows.curve || 0) * rows.rowSpacing * 2.5;
  for (let i = 0; i < rows.count; i++) {
    const y = b.y + inset + rows.rowSpacing * (i + 0.5);
    if (y > b.maxY - inset + 1e-6) {
      tracks.push(null);
      continue;
    }
    const chord = shape.type === 'rect' ? [b.x, b.maxX] : widestChord(localPoly, y);
    if (!chord) {
      tracks.push(null);
      continue;
    }
    const margin = inset + rows.seatSpacing / 2;
    const xa = chord[0] + margin;
    const xb = chord[1] - margin;
    const length = Math.max(0, xb - xa);
    const half = (xb - xa) / 2 || 1;
    const at = (s, total) => {
      // Centre the row's seats inside the chord, then bow the row (ends towards the front)
      const x = xa + (length - total) / 2 + s;
      const u = (x - (xa + half)) / half;
      const [wx, wy] = toWorld([x, y + bow * (1 - u * u) - bow]);
      return { x: wx, y: wy, facing: facing - 90 };
    };
    const labelAt = (side) => {
      const x = side < 0 ? chord[0] + inset * 0.6 : chord[1] - inset * 0.6;
      const u = (x - (xa + half)) / half;
      const [wx, wy] = toWorld([x, y + bow * (1 - Math.min(1, u * u)) - bow]);
      return { x: wx, y: wy };
    };
    tracks.push({ length, at, labelAt, centered: true });
  }
  return tracks;
}

/** The most seats that fit in row i with the current spacing and aisles. */
export function maxSeatsInRow(section, i) {
  const rows = rowsOf(section);
  const track = rowTracks(section, rows)[i];
  if (!track) return 0;
  let n = 1;
  while (n < LIMITS.seatsPerRow && rowOffsets(n + 1, rows).length <= track.length + 1e-6) n++;
  return rowOffsets(n, rows).length <= track.length + 1e-6 ? n : 0;
}

/** Sets every row's seat count to the most that fit (used by templates and "Fit seats to rows"). */
export function fitRows(section, cap = LIMITS.seatsPerRow) {
  const rows = rowsOf(section);
  const perRow = {};
  for (let i = 0; i < rows.count; i++) perRow[i] = Math.min(cap, maxSeatsInRow(section, i));
  const max = Math.max(0, ...Object.values(perRow));
  return { ...section, rows: { ...rows, perRow, seatsPerRow: max } };
}

/** The most rows that fit the section's depth. */
export function maxRows(section) {
  const rows = rowsOf(section);
  const probe = { ...section, rows: { ...rows, count: LIMITS.rows } };
  const tracks = rowTracks(probe, rowsOf(probe));
  const first = tracks.findIndex((t) => !t);
  return first === -1 ? LIMITS.rows : first;
}

function generateRows(section) {
  const rows = rowsOf(section);
  const seats = [];
  const rowLabels = [];
  const issues = [];
  const blocked = new Set((rows.blocked || []).map(String));
  const tracks = rowTracks(section, rows);
  const outline = shapePolygon(section.shape);
  const usedLabels = new Set();

  for (let i = 0; i < rows.count; i++) {
    const label = rowLabel(i, rows.labelStyle, rows.labelStart);
    if (usedLabels.has(label)) issues.push({ level: 'error', message: `Row label ${label} is used twice.` });
    usedLabels.add(label);
    const n = seatCountForRow(rows, i);
    const track = tracks[i];
    if (!track) {
      issues.push({ level: 'error', rowIndex: i, message: `Row ${label} does not fit inside the section. Reduce rows or row spacing, or make the section deeper.` });
      continue;
    }
    if (!n) continue;
    if (n > LIMITS.seatsPerRow) {
      issues.push({ level: 'error', rowIndex: i, message: `Row ${label} has more than ${LIMITS.seatsPerRow} seats.` });
      continue;
    }
    const { offsets, length } = rowOffsets(n, rows);
    if (length > track.length + 1e-6) {
      const fits = maxSeatsInRow(section, i);
      issues.push({ level: 'error', rowIndex: i, message: `Row ${label}: ${n} seats don't fit (at most ${fits} with this spacing and these aisles).` });
      continue;
    }
    const start = track.centered ? 0 : (track.length - length) / 2;
    let outside = 0;
    for (let p = 0; p < n; p++) {
      const pos = track.centered ? track.at(offsets[p], length) : track.at(start + offsets[p]);
      const number = String((Number(rows.seatStart) || 1) + (rows.numbering === 'rtl' ? n - 1 - p : p));
      if (section.shape.type !== 'arc' && !pointInPolygon([pos.x, pos.y], outline)) outside++;
      seats.push({
        key: `${section.id}/${label}/${number}`,
        rowIndex: i,
        position: p,
        row: label,
        number,
        x: round(pos.x),
        y: round(pos.y),
        blocked: blocked.has(`${i}:${p}`),
      });
    }
    if (outside) issues.push({ level: 'error', rowIndex: i, message: `Row ${label}: ${outside} seat(s) fall outside the section boundary.` });
    const left = track.labelAt(-1);
    const right = track.labelAt(1);
    rowLabels.push({ label, x: round(left.x), y: round(left.y), x2: round(right.x), y2: round(right.y) });
  }
  return { seats, rowLabels, issues };
}

function generateTables(section) {
  const t = tablesOf(section);
  const seats = [];
  const tables = [];
  const issues = [];
  const { shape } = section;
  if (shape.type === 'arc') {
    return { seats, tables, issues: [{ level: 'error', message: 'Tables need a block or custom-shape section.' }] };
  }
  const chairs = Math.floor(t.seatsPerTable);
  if (chairs < 2 || chairs > LIMITS.seatsPerTable) issues.push({ level: 'error', message: `Seats per table must be between 2 and ${LIMITS.seatsPerTable}.` });
  if (t.mode === 'whole' && chairs > LIMITS.wholeTableSeats) {
    issues.push({ level: 'error', message: `Whole-table booking allows at most ${LIMITS.wholeTableSeats} seats per table (the checkout limit per booking).` });
  }
  const pitch = t.seatSpacing;
  const ring = Math.max((chairs * pitch) / (2 * Math.PI), pitch * 1.15);
  const tableR = Math.max(ring - pitch * 0.72, pitch * 0.6);
  const minSpacing = 2 * ring + pitch * 1.1;
  const spacing = Math.max(Number(t.spacing) || 0, minSpacing);
  if (t.spacing && t.spacing < minSpacing) issues.push({ level: 'warning', message: `Table spacing was raised to ${round(minSpacing, 0)} so chairs don't overlap.` });

  const facing = shape.type === 'rect' ? shape.rotation || 0 : shape.facing || 0;
  const center = shape.type === 'rect' ? [shape.x, shape.y] : polygonCentroid(shape.points);
  const outline = shapePolygon(shape);
  const cols = Math.max(1, Math.floor(t.columns));
  const count = Math.max(0, Math.floor(t.count));
  const lines = Math.ceil(count / cols);
  let outside = 0;
  for (let k = 0; k < count; k++) {
    const r = Math.floor(k / cols);
    const c = k % cols;
    const inRow = Math.min(cols, count - r * cols);
    const lx = (c - (inRow - 1) / 2) * spacing;
    const ly = (r - (lines - 1) / 2) * spacing;
    const [x, y] = rotate([center[0] + lx, center[1] + ly], facing, center);
    const number = k + 1;
    const tableKey = `${section.id}/T${number}`;
    const label = `Table ${number}`;
    const chairKeys = [];
    for (let s = 0; s < chairs; s++) {
      const ang = -90 + facing + (360 * s) / chairs;
      const [sx, sy] = polar(x, y, ring, ang);
      if (!pointInPolygon([sx, sy], outline)) outside++;
      const key = `${section.id}/${label}/${s + 1}`;
      chairKeys.push(key);
      seats.push({ key, rowIndex: k, position: s, row: label, number: String(s + 1), x: round(sx), y: round(sy), tableKey, blocked: false });
    }
    tables.push({ key: tableKey, label, number, x: round(x), y: round(y), r: round(tableR), seatKeys: chairKeys });
  }
  if (outside) issues.push({ level: 'error', message: `${outside} table seat(s) fall outside the section. Reduce tables, columns or spacing, or enlarge the section.` });
  return { seats, tables, issues, seatRadius: pitch * 0.38 };
}

/**
 * Generates a section. `stats.positions` counts every position, `blocked` the blocked ones and
 * `sellable` what can be booked. For whole tables `sellableUnits` is the number of tables.
 */
export function generateSection(section) {
  const booking = section.booking || 'seats';
  if (booking === 'ga') {
    const capacity = Math.max(0, Math.floor(gaOf(section).capacity));
    const issues = [];
    if (capacity < 1 || capacity > LIMITS.gaCapacity) issues.push({ level: 'error', message: `Capacity must be between 1 and ${LIMITS.gaCapacity}.` });
    return { seats: [], rowLabels: [], tables: [], issues, seatRadius: 0, stats: { positions: capacity, blocked: 0, sellable: capacity, guests: capacity, tables: 0, sellableUnits: capacity, unit: 'ticket' } };
  }
  if (booking === 'tables') {
    const out = generateTables(section);
    const mode = tablesOf(section).mode;
    return {
      ...out,
      rowLabels: [],
      stats: {
        positions: out.seats.length,
        blocked: 0,
        sellable: out.seats.length,
        guests: out.seats.length,
        tables: out.tables.length,
        sellableUnits: mode === 'whole' ? out.tables.length : out.seats.length,
        unit: mode === 'whole' ? 'table' : 'seat',
      },
    };
  }
  const rows = rowsOf(section);
  const out = generateRows(section);
  if (rows.count > LIMITS.rows) out.issues.push({ level: 'error', message: `At most ${LIMITS.rows} rows per section.` });
  const blocked = out.seats.filter((s) => s.blocked).length;
  if (out.seats.length > LIMITS.sectionPositions) out.issues.push({ level: 'error', message: `At most ${LIMITS.sectionPositions} seats per section; split it into smaller sections.` });
  return {
    ...out,
    tables: [],
    seatRadius: Math.min(rows.seatSpacing, rows.rowSpacing) * 0.4,
    stats: { positions: out.seats.length, blocked, sellable: out.seats.length - blocked, guests: out.seats.length - blocked, tables: 0, sellableUnits: out.seats.length - blocked, unit: 'seat' },
  };
}
