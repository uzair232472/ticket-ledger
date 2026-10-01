import { generateSection, shapeBounds, shapePolygon, bounds } from '@venue-core';

/**
 * Tier colours, seat-state vocabulary and shared helpers for the venue map.
 * Colours follow the site's Eventfrog palette: brand green first, then calm supporting hues.
 */
export const TIER_COLORS = ['#16a34a', '#0d9488', '#2563eb', '#9333ea', '#ea580c', '#ca8a04', '#db2777', '#475569'];

/** Tiers sorted by price (highest first) with a stable colour each. */
export function tierPalette(tiers = []) {
  const sorted = [...tiers].sort((a, b) => Number(b.price) - Number(a.price));
  const byId = {};
  sorted.forEach((t, i) => {
    byId[t.id] = { ...t, price: Number(t.price), color: TIER_COLORS[i % TIER_COLORS.length] };
  });
  return byId;
}

export const formatPkr = (v) => `PKR ${Number(v || 0).toLocaleString('en-PK')}`;

/** Each seat state has a colour AND a symbol/label, so it never relies on colour alone. */
export const SEAT_STATES = {
  available: { label: 'Available', symbol: 'ring' },
  mine: { label: 'Held for you', symbol: 'check' },
  pending: { label: 'Requesting…', symbol: 'dash' },
  held: { label: 'Held by someone else', symbol: 'clock' },
  sold: { label: 'Sold', symbol: 'cross' },
  blocked: { label: 'Not on sale', symbol: 'slash' },
};

// Generated geometry is cached per section object, so unchanged sections are never regenerated
const cache = new WeakMap();
export function generated(section) {
  let g = cache.get(section);
  if (!g) {
    g = generateSection(section);
    cache.set(section, g);
  }
  return g;
}

const boxCache = new WeakMap();
export function sectionBox(section) {
  let b = boxCache.get(section);
  if (!b) {
    b = shapeBounds(section.shape);
    boxCache.set(section, b);
  }
  return b;
}

/** Bounds of the whole plan: the coordinate box, grown to include anything drawn outside it. */
export function layoutBox(layout) {
  const pts = [[0, 0], [layout.coordinate.width, layout.coordinate.height]];
  for (const s of layout.sections || []) pts.push(...shapePolygon(s.shape, 12));
  const b = bounds(pts);
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/**
 * Bounds of what is actually drawn: every section outline plus the ground/stage feature. Used to frame
 * the plan for attendees, so empty design-canvas space doesn't shrink the drawing.
 */
export function geometryBox(layout) {
  const pts = [];
  for (const s of layout.sections || []) pts.push(...shapePolygon(s.shape, 24));
  const f = layout.feature;
  if (f && f.kind && f.kind !== 'none' && Number.isFinite(f.x)) {
    // Rotated features: use the half-diagonal so the frame always contains them
    const rot = ((Number(f.rotation) || 0) % 180) !== 0;
    const hw = rot ? Math.hypot(f.w, f.h) / 2 : f.w / 2;
    const hh = rot ? Math.hypot(f.w, f.h) / 2 : f.h / 2;
    pts.push([f.x - hw, f.y - hh], [f.x + hw, f.y + hh]);
  }
  if (!pts.length) return layoutBox(layout);
  const b = bounds(pts);
  return { x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h) };
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
