import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX_SEATS, DEG, bounds, polygonCentroid, rotate, rowsOf, sectionView3d, shapePolygon, view3dOf, widestChord } from '@venue-core';
import { ArrowUpRight, ChevronDown, ChevronLeft, Eye, Info, Lightbulb, Maximize2, Moon, ShoppingBag, Sparkles, Sun, Trash2, Plus } from 'lucide-react';
import { SeatTicketCard } from './BookingSummary';
import { formatPkr, generated } from './venueTheme';
import { canvasTex, gradientTex, quad, toGeo } from './scene3dUtils';
import { buildHallShell, buildHallStage, theatreSeatGeometry } from './hallScene';
import { VENUE_WORDS, venue3dKind } from './venue3dKind';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';
import './venue3d.css';

/**
 * 3D stadium view of an organizer's venue plan. Nothing here is hand-made per stadium: every stand is built
 * from the plan's sections (shape, rows, level) and every seat is placed where venue-core generates it, with
 * the same key the booking API uses. So whatever ground an organizer draws in the venue editor appears here.
 *
 * The parent (VenueBooking) stays the source of truth: it gives the seat states and holds, and does the
 * hold / release / checkout calls. This component only draws, flies the camera and reports clicks.
 */

const LEATHER = '#7a4a2a'; // hospitality box seats
const PULSE_TO = new THREE.Color('#cfe0ff');
const COLORS = { mine: '#1e66f5', pending: '#8fb3ff', held: '#f5a524', sold: '#9aa3ab', blocked: '#2a2f35', none: '#c7ccd1' };
// The 2D palette has a blue tier; in 3D blue means "your seat", so that tier is drawn in rose instead
export const tier3dColor = (c) => (String(c).toLowerCase() === '#2563eb' ? '#e11d48' : c);
const boxOf = (seat) => Math.floor(seat.position / BOX_SEATS) + 1;
const STATE_LABEL = { available: 'Available', mine: 'Held for you (not paid yet)', pending: 'Reserving…', held: 'Held by another fan (up to 10 min)', sold: 'Sold', blocked: 'Not on sale' };

// ─── Small geometry helpers (plan coordinates in, world coordinates out) ─────────────────────────────────────
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Local frame of a block or custom-shape section (same transform as venue-core's seat generator). */
function frameOf(sh) {
  if (sh.type === 'rect') {
    const facing = sh.rotation || 0;
    const local = [[-sh.w / 2, -sh.h / 2], [sh.w / 2, -sh.h / 2], [sh.w / 2, sh.h / 2], [-sh.w / 2, sh.h / 2]];
    return { facing, local, rect: true, toPlan: ([x, y]) => { const [rx, ry] = rotate([x, y], facing); return [sh.x + rx, sh.y + ry]; }, toLocal: ([x, y]) => rotate([x - sh.x, y - sh.y], -facing) };
  }
  const facing = sh.facing || 0;
  const c = polygonCentroid(sh.points);
  const local = sh.points.map((p) => { const [x, y] = rotate(p, -facing, c); return [x - c[0], y - c[1]]; });
  return { facing, local, rect: false, toPlan: ([x, y]) => rotate([x + c[0], y + c[1]], facing, c), toLocal: (p) => { const [x, y] = rotate(p, -facing, c); return [x - c[0], y - c[1]]; } };
}

/** Number of rows of a section that fit (as the generator decides). */
function fittingRows(sec) {
  const R = rowsOf(sec);
  if (sec.shape.type === 'arc') {
    let n = 0;
    for (let i = 0; i < R.count; i++) if (sec.shape.r0 + R.inset + R.rowSpacing * (i + 0.5) <= sec.shape.r1 - R.inset + 1e-6) n = i + 1;
    return n;
  }
  const b = bounds(frameOf(sec.shape).local);
  let n = 0;
  for (let i = 0; i < R.count; i++) if (b.y + R.inset + R.rowSpacing * (i + 0.5) <= b.maxY - R.inset + 1e-6) n = i + 1;
  return n;
}

/** Stepped terrace for a seated section: front wall, a tread + riser per row, back wall, side walls. */
function terraceGeometry(sec, W, lv) {
  const R = rowsOf(sec), rs = R.rowSpacing, n = Math.max(1, fittingRows(sec));
  // lv.trimBack (halls): the stepped floor ends just behind the last row instead of filling the drawn shape
  const h = (i) => lv.h0 + Math.min(i, n - 1) * lv.rise;
  const top = h(n - 1) + lv.parapet;
  const pos = [];
  if (sec.shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = sec.shape;
    const P = (r, a, y) => W(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG), y);
    const rf = (i) => (i === 0 ? r0 : r0 + R.inset + rs * i);
    const rEnd = lv.trimBack ? Math.min(r1, r0 + R.inset * 2 + rs * n) : r1;
    const rb = (i) => (i === n - 1 ? rEnd : r0 + R.inset + rs * (i + 1));
    const segs = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 1.5));
    for (let s = 0; s < segs; s++) {
      const aa = a0 + ((a1 - a0) * s) / segs, ab = a0 + ((a1 - a0) * (s + 1)) / segs;
      quad(pos, P(r0, aa, 0), P(r0, ab, 0), P(r0, ab, h(0)), P(r0, aa, h(0)));
      for (let i = 0; i < n; i++) {
        quad(pos, P(rf(i), aa, h(i)), P(rf(i), ab, h(i)), P(rb(i), ab, h(i)), P(rb(i), aa, h(i)));
        if (i < n - 1) quad(pos, P(rb(i), aa, h(i)), P(rb(i), ab, h(i)), P(rb(i), ab, h(i + 1)), P(rb(i), aa, h(i + 1)));
      }
      quad(pos, P(rEnd, aa, 0), P(rEnd, aa, top), P(rEnd, ab, top), P(rEnd, ab, 0));
    }
    for (const a of [a0, a1]) for (let i = 0; i < n; i++) quad(pos, P(rf(i), a, 0), P(rb(i), a, 0), P(rb(i), a, h(i)), P(rf(i), a, h(i)));
    return toGeo(pos);
  }
  const F = frameOf(sec.shape), b = bounds(F.local);
  const L = (x, y, yy) => { const [px, py] = F.toPlan([x, y]); return W(px, py, yy); };
  const yf = (i) => (i === 0 ? b.y : b.y + R.inset + rs * i);
  const yEnd = lv.trimBack ? Math.min(b.maxY, b.y + R.inset * 2 + rs * n) : b.maxY;
  const yb = (i) => (i === n - 1 ? yEnd : b.y + R.inset + rs * (i + 1));
  const chord = (i) => (F.rect ? [b.x, b.maxX] : widestChord(F.local, b.y + R.inset + rs * (i + 0.5)) || [b.x, b.maxX]);
  for (let i = 0; i < n; i++) {
    const [c0, c1] = chord(i);
    if (i === 0) quad(pos, L(c0, yf(0), 0), L(c1, yf(0), 0), L(c1, yf(0), h(0)), L(c0, yf(0), h(0)));
    quad(pos, L(c0, yf(i), h(i)), L(c1, yf(i), h(i)), L(c1, yb(i), h(i)), L(c0, yb(i), h(i)));
    if (i < n - 1) quad(pos, L(c0, yb(i), h(i)), L(c1, yb(i), h(i)), L(c1, yb(i), h(i + 1)), L(c0, yb(i), h(i + 1)));
    else quad(pos, L(c0, yb(i), 0), L(c0, yb(i), top), L(c1, yb(i), top), L(c1, yb(i), 0));
    for (const c of [c0, c1]) quad(pos, L(c, yf(i), 0), L(c, yb(i), 0), L(c, yb(i), h(i)), L(c, yf(i), h(i)));
  }
  return toGeo(pos);
}

/** Flat raised floor for standing zones and table sections. */
function platformGeometry(sec, W, y1) {
  const poly = shapePolygon(sec.shape, 32);
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const pos = [];
  for (const [a, b, c] of tris) pos.push(...W(...poly[a], y1), ...W(...poly[b], y1), ...W(...poly[c], y1));
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; quad(pos, W(...p, 0), W(...q, 0), W(...q, y1), W(...p, y1)); }
  return toGeo(pos);
}

function seatGeometry(P) {
  return mergeGeometries([
    new THREE.BoxGeometry(0.48, 0.08, 0.42).translate(0, 0.42, 0.04),
    new THREE.BoxGeometry(0.48, 0.5, 0.07).translate(0, 0.68, -0.18),
    new THREE.BoxGeometry(0.07, 0.38, 0.28).translate(0, 0.19, 0),
  ]).scale(P, P, P);
}

function chairGeometry(P) {
  const k = P * 0.62, armL = new THREE.BoxGeometry(0.12, 0.24, 0.66).translate(-0.3, 0.54, 0);
  return mergeGeometries([
    new THREE.BoxGeometry(0.72, 0.42, 0.7).translate(0, 0.21, 0),
    new THREE.BoxGeometry(0.56, 0.1, 0.56).translate(0, 0.47, 0.04),
    new THREE.BoxGeometry(0.72, 0.66, 0.16).translate(0, 0.64, -0.29),
    armL, armL.clone().translate(0.6, 0, 0),
  ]).scale(k, k, k);
}

/**
 * Hospitality boxes over a seated section: a wooden ledge and a glass front along the front row, a ceiling,
 * end walls, and a partition every BOX_SEATS seats along the rows. The seats inside stay the section's real seats.
 */
function buildBoxShell(scene, sec, seats, W, lv, n, mats) {
  const ceil = lv.h0 + (n - 1) * lv.rise + 2.9, ledge = lv.h0 + 0.75;
  const pos = { glass: [], wood: [], wall: [], ceil: [] };
  const row0 = seats.filter((s) => s.rowIndex === 0).sort((a, b) => a.position - b.position);
  const cuts = []; // plan points where partitions stand, between box groups of the front row
  for (let i = 1; i < row0.length; i++) if (boxOf(row0[i]) !== boxOf(row0[i - 1])) cuts.push([(row0[i].x + row0[i - 1].x) / 2, (row0[i].y + row0[i - 1].y) / 2]);
  if (sec.shape.type === 'arc') {
    const { cx, cy, r0, r1, a0, a1 } = sec.shape;
    const P = (r, a, y) => W(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG), y);
    const segs = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 1.5));
    for (let k = 0; k < segs; k++) {
      const aa = a0 + ((a1 - a0) * k) / segs, ab = a0 + ((a1 - a0) * (k + 1)) / segs;
      quad(pos.wood, P(r0, aa, lv.h0 - 0.05), P(r0, ab, lv.h0 - 0.05), P(r0, ab, ledge), P(r0, aa, ledge));
      quad(pos.glass, P(r0, aa, ledge), P(r0, ab, ledge), P(r0, ab, ceil), P(r0, aa, ceil));
      quad(pos.ceil, P(r0, aa, ceil), P(r0, ab, ceil), P(r1, ab, ceil), P(r1, aa, ceil));
      quad(pos.ceil, P(r0, aa, ceil + 0.3), P(r1, aa, ceil + 0.3), P(r1, ab, ceil + 0.3), P(r0, ab, ceil + 0.3));
    }
    const radial = (a) => quad(pos.wall, P(r0, a, lv.h0 - 0.05), P(r1, a, lv.h0 - 0.05), P(r1, a, ceil), P(r0, a, ceil));
    radial(a0); radial(a1);
    for (const [x, y] of cuts) radial(Math.atan2(y - cy, x - cx) / DEG);
  } else {
    const F = frameOf(sec.shape), b = bounds(F.local);
    const L = (x, yy, h) => { const [px, py] = F.toPlan([x, yy]); return W(px, py, h); };
    const [c0, c1] = F.rect ? [b.x, b.maxX] : widestChord(F.local, b.y + rowsOf(sec).inset + rowsOf(sec).rowSpacing / 2) || [b.x, b.maxX];
    quad(pos.wood, L(c0, b.y, lv.h0 - 0.05), L(c1, b.y, lv.h0 - 0.05), L(c1, b.y, ledge), L(c0, b.y, ledge));
    quad(pos.glass, L(c0, b.y, ledge), L(c1, b.y, ledge), L(c1, b.y, ceil), L(c0, b.y, ceil));
    quad(pos.ceil, L(c0, b.y, ceil), L(c1, b.y, ceil), L(c1, b.maxY, ceil), L(c0, b.maxY, ceil));
    const across = (x) => quad(pos.wall, L(x, b.y, lv.h0 - 0.05), L(x, b.maxY, lv.h0 - 0.05), L(x, b.maxY, ceil), L(x, b.y, ceil));
    across(c0); across(c1);
    for (const p of cuts) across(F.toLocal(p)[0]);
  }
  const add = (arr, mat, cast) => { if (!arr.length) return; const m = new THREE.Mesh(toGeo(arr), mat); m.castShadow = cast; m.receiveShadow = true; scene.add(m); };
  add(pos.wood, mats.wood, true); add(pos.glass, mats.glass, false); add(pos.wall, mats.boxWall, true); add(pos.ceil, mats.white, true);
  return ceil;
}

/** The ground in the middle: a cricket oval with pitch, creases, stumps, rope, 30-yard circle and sight screens. */
function buildFeature(scene, feature, W, S, mats) {
  if (!feature || !feature.kind || feature.kind === 'none' || !Number.isFinite(feature.x)) return;
  const rot = -(Number(feature.rotation) || 0) * DEG;
  const [cx, , cz] = W(feature.x, feature.y, 0);
  const rx = (feature.w / 2) * S, rz = (feature.h / 2) * S;
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rot; scene.add(g);
  const flat = (geo, mat, y) => { const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), mat); m.position.y = y; m.receiveShadow = true; g.add(m); return m; };
  if (feature.kind === 'cricket') {
    const stripes = canvasTex(1024, 1024, (c, w, h) => {
      const n = 18; for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#3f9b3d' : '#49aa45'; c.fillRect((i * w) / n, 0, w / n + 1, h); }
      for (let k = 0; k < 9000; k++) { c.fillStyle = `rgba(${k % 2 ? '255,255,255' : '0,40,0'},0.035)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    const oval = flat(new THREE.CircleGeometry(1, 128), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.95 }), 0.02);
    oval.scale.set(rx, 1, rz);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 220).rotateX(Math.PI / 2), mats.rope);
    rope.scale.set(rx * 0.94, 1, rz * 0.94); rope.position.y = 0.12; rope.castShadow = true; g.add(rope);
    const L = Math.min(rx, rz) * 2 * 0.135; // 22 yards on a ~150 m ground
    const k = L / 20.12;
    flat(new THREE.PlaneGeometry(16 * k, 26 * k), new THREE.MeshStandardMaterial({ color: 0x8fb05e, roughness: 0.95 }), 0.06);
    flat(new THREE.PlaneGeometry(3.05 * k, 22.6 * k), new THREE.MeshStandardMaterial({ color: 0xcdb27c, roughness: 1 }), 0.1);
    const line = (w, l, x, z) => { const m = flat(new THREE.PlaneGeometry(w, l), mats.line, 0.14); m.position.x = x; m.position.z = z; };
    const lw = Math.max(0.06 * k, 0.03);
    for (const s of [-1, 1]) {
      line(2.64 * k, lw, 0, s * 10.06 * k); line(3.66 * k, lw, 0, s * 8.84 * k);
      for (const x of [-1.32, 1.32]) line(lw, 2.44 * k, x * k, s * 10.06 * k);
      for (const x of [-0.114, 0, 0.114]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * k, 0.03 * k, 0.71 * k, 8), mats.stump); st.position.set(x * k, 0.1 + 0.355 * k, s * 10.06 * k); st.castShadow = true; g.add(st); }
    }
    const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15 * k, 1.3 * k).rotateX(-Math.PI / 2), mats.line, 72), d = new THREE.Object3D();
    const cr = 27.43 / 75; // 30-yard circle on a 75 m radius ground
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; d.position.set(Math.cos(a) * rx * cr, 0.06, Math.sin(a) * rz * cr); d.rotation.set(0, -a, 0); d.updateMatrix(); dashes.setMatrixAt(i, d.matrix); }
    g.add(dashes);
    for (const s of [-1, 1]) { // sight screens behind the bowler's arm, just outside the rope
      const sc = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.3, rz * 0.12, rz * 0.012), mats.white);
      sc.position.set(0, rz * 0.06, s * rz * 0.975); sc.castShadow = true; sc.receiveShadow = true; g.add(sc);
    }
  } else {
    const color = { football: 0x3f9b3d, hockey: 0x2f7fc1, court: 0xc98a4b, stage: 0x2b2f36 }[feature.kind] || 0x6b7280;
    const m = flat(new THREE.PlaneGeometry(rx * 2, rz * 2), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), 0.03);
    if (feature.kind === 'stage') { m.position.y = 1.2; m.castShadow = true; }
  }
}

/**
 * Roofs over the stands the organizer marked (section.view3d.roof), on columns at the back, and the team name
 * (layout.view3d.teamName) on the front edge of the widest roof, readable from the pitch.
 */
function buildRoofs(scene, layout, sections, W, mats) {
  const v3 = view3dOf(layout);
  const roofed = [...sections.values()].filter((e) => sectionView3d(e.sec).roof);
  if (!roofed.length) return;
  const center = new THREE.Vector3(0, 0, 0);
  let named = null;
  for (const e of roofed) {
    const sec = e.sec, y = e.top + 4.2, thick = 0.35;
    const pos = [];
    let front; // [world points along the front edge, left-to-right order decided below]
    let backPts;
    if (sec.shape.type === 'arc') {
      const { cx, cy, r0, r1, a0, a1 } = sec.shape;
      const ri = r0 - (r1 - r0) * 0.12, ro = r1 + 2;
      const P = (r, a, yy) => W(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG), yy);
      const segs = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 1.5));
      for (let k = 0; k < segs; k++) {
        const aa = a0 + ((a1 - a0) * k) / segs, ab = a0 + ((a1 - a0) * (k + 1)) / segs;
        quad(pos, P(ri, aa, y + thick), P(ro, aa, y + thick), P(ro, ab, y + thick), P(ri, ab, y + thick));
        quad(pos, P(ri, aa, y), P(ri, ab, y), P(ro, ab, y), P(ro, aa, y));
        quad(pos, P(ro, aa, y), P(ro, ab, y), P(ro, ab, y + thick), P(ro, aa, y + thick));
      }
      front = Array.from({ length: segs + 1 }, (_, k) => P(ri, a0 + ((a1 - a0) * k) / segs, 0));
      const nCols = Math.max(2, Math.round(Math.abs(a1 - a0) / 7) + 1);
      backPts = Array.from({ length: nCols }, (_, k) => P(r1, a0 + ((a1 - a0) * k) / (nCols - 1), 0));
    } else {
      const F = frameOf(sec.shape), b = bounds(F.local);
      const L = (x, yy, h) => { const [px, py] = F.toPlan([x, yy]); return W(px, py, h); };
      const fy = b.y - (b.maxY - b.y) * 0.12;
      const corners = [[b.x, fy], [b.maxX, fy], [b.maxX, b.maxY + 2], [b.x, b.maxY + 2]];
      quad(pos, ...corners.map(([x, yy]) => L(x, yy, y + thick)));
      quad(pos, ...[...corners].reverse().map(([x, yy]) => L(x, yy, y)));
      front = [L(b.x, fy, 0), L(b.maxX, fy, 0)];
      backPts = [L(b.x, b.maxY, 0), L((b.x + b.maxX) / 2, b.maxY, 0), L(b.maxX, b.maxY, 0)];
    }
    const roof = new THREE.Mesh(toGeo(pos), mats.white);
    roof.material.side = THREE.DoubleSide; roof.castShadow = true; roof.receiveShadow = true; scene.add(roof);
    for (const [x, , z] of backPts) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, y, 10), mats.white);
      col.position.set(x, y / 2, z); col.castShadow = true; scene.add(col);
    }
    // Front edge (fascia); the widest one carries the team name
    const fpts = front.map(([x, , z]) => new THREE.Vector3(x, 0, z));
    const width = fpts.reduce((n, p, i) => (i ? n + p.distanceTo(fpts[i - 1]) : 0), 0);
    if (!named || width > named.width) named = { fpts, y, width };
    scene.add(fascia(fpts, y - 1.4, y + thick, mats.white.color, null));
  }
  // Neighbouring roofed stands on the same ring (cricket grounds): one banner across all of them
  const arcs = roofed.filter((e) => e.sec.shape.type === 'arc').map((e) => ({ e, ...e.sec.shape })).sort((a, b) => a.a0 - b.a0);
  let best = null;
  for (let i = 0; i < arcs.length; i++) {
    let j = i;
    while (j + 1 < arcs.length && arcs[j + 1].cx === arcs[i].cx && arcs[j + 1].cy === arcs[i].cy && arcs[j + 1].a0 - arcs[j].a1 <= 3) j++;
    const span = arcs[j].a1 - arcs[i].a0;
    if (j > i && (!best || span > best.span)) best = { i, j, span };
  }
  if (best) {
    const chain = arcs.slice(best.i, best.j + 1), { cx, cy } = chain[0];
    const ri = Math.min(...chain.map((a) => a.r0 - (a.r1 - a.r0) * 0.12)), a0 = chain[0].a0, a1 = chain[chain.length - 1].a1;
    const segs = Math.max(12, Math.ceil((a1 - a0) / 1.5));
    const fpts = Array.from({ length: segs + 1 }, (_, k) => { const [x, , z] = W(cx + ri * Math.cos((a0 + ((a1 - a0) * k) / segs) * DEG), cy + ri * Math.sin((a0 + ((a1 - a0) * k) / segs) * DEG), 0); return new THREE.Vector3(x, 0, z); });
    named = { fpts, y: Math.min(...chain.map((a) => a.e.top + 4.2)), width: 0 };
  }
  if (named && v3.teamName) {
    // Text left-to-right as seen from the middle of the ground
    const { fpts } = named;
    const mid = fpts[Math.floor(fpts.length / 2)].clone();
    const forward = mid.clone().sub(center).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const ordered = right.dot(fpts[fpts.length - 1].clone().sub(fpts[0])) >= 0 ? fpts : [...fpts].reverse();
    const pts = ordered.map((p) => p.clone().addScaledVector(forward, -0.05)); // just in front of the plain fascia
    const [c1, c2] = v3.teamColors;
    const tex = canvasTex(2048, 256, (g, w, h) => {
      g.fillStyle = c2; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.fillRect(0, h - 26, w, 26); g.fillRect(0, 0, w, 14);
      g.fillStyle = '#ffffff'; g.font = '800 150px system-ui, Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const text = v3.teamName.toUpperCase();
      const fit = Math.min(1, (w * 0.9) / g.measureText(text).width);
      g.save(); g.translate(w / 2, h / 2 + 4); g.scale(fit, 1); g.fillText(text, 0, 0); g.restore();
    });
    scene.add(fascia(pts, named.y - 1.4, named.y + 0.35, null, tex));
  }
}

/** A vertical band along a polyline (roof front edge), with u running along it for a texture. */
function fascia(pts, y0, y1, color, map) {
  const pos = [], uv = [];
  const len = pts.reduce((n, p, i) => (i ? n + p.distanceTo(pts[i - 1]) : 0), 0) || 1;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], ua = acc / len; acc += a.distanceTo(b); const ub = acc / len;
    pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
    uv.push(ua, 0, ub, 0, ub, 1, ua, 0, ub, 1, ua, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial(map ? { map, roughness: 0.6, side: THREE.DoubleSide } : { color, roughness: 0.55, side: THREE.DoubleSide }));
  m.castShadow = !map; m.receiveShadow = true;
  return m;
}

// ─── Scene ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Weaker phones and large grounds start in lower detail (no shadows, 1× pixels, fewer trees). The view also
 * switches to it by itself if the frame rate stays low (see the render loop).
 */
function startsLowDetail(layout) {
  if (typeof navigator === 'undefined') return false;
  const seats = (layout.sections || []).reduce((n, s) => n + (generated(s).seats?.length || 0), 0);
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const phone = window.matchMedia('(hover: none)').matches;
  return Boolean(weak || (phone && seats > 15000));
}

function buildScene(host, layout, { low = false, board = null, kind = 'stadium' } = {}) {
  const hall = kind === 'hall'; // theatre / auditorium / conference room instead of a ground
  const renderer = new THREE.WebGLRenderer({ antialias: !low });
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !low; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = hall ? gradientTex('#1c1412', '#070505') : gradientTex('#3c82d4', '#d8e9f6');

  // Plan units → world: one seat pitch ≈ one world unit; seats and people are drawn ~1.5× life size so the
  // plan's proportions (pitch vs stands) stay exactly as the organizer drew them
  const spacings = layout.sections.filter((s) => (s.booking || 'seats') === 'seats').map((s) => rowsOf(s).seatSpacing).sort((a, b) => a - b);
  const S = 1 / (spacings[Math.floor(spacings.length / 2)] || 8);
  const P = 1.5;
  const f = layout.feature;
  const allPts = layout.sections.flatMap((s) => shapePolygon(s.shape, 16));
  const pb = bounds(allPts.length ? allPts : [[0, 0], [layout.coordinate.width, layout.coordinate.height]]);
  const ox = f && f.kind && f.kind !== 'none' && Number.isFinite(f.x) ? f.x : pb.x + pb.w / 2;
  const oy = f && f.kind && f.kind !== 'none' && Number.isFinite(f.y) ? f.y : pb.y + pb.h / 2;
  const W = (x, y, h) => [(x - ox) * S, h, (y - oy) * S];
  const R = Math.max(...allPts.map(([x, y]) => Math.hypot(x - ox, y - oy)), 100) * S;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.08, R * 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.47;
  controls.minDistance = 4; controls.maxDistance = R * 5; controls.screenSpacePanning = false;
  scene.fog = hall ? new THREE.Fog(0x0b0807, R * 3, R * 9) : new THREE.Fog(0xd8e9f6, R * 4, R * 10);

  const hemi = hall ? new THREE.HemisphereLight(0xffe8d2, 0x2a1a14, 0.85) : new THREE.HemisphereLight(0xd3e8ff, 0x4d6b36, 0.95); scene.add(hemi);
  // Indoors the "sun" is the house lighting, from high above the room
  const sun = new THREE.DirectionalLight(hall ? 0xffe6c8 : 0xfff0d4, hall ? 1.5 : 2.7);
  if (hall) sun.position.set(R * 0.2, R * 1.8, R * 0.6); else sun.position.set(-R * 1.3, R * 1.25, R * 0.85);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -R * 1.5, right: R * 1.5, top: R * 1.5, bottom: -R * 1.5, near: 1, far: R * 5 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const mats = {
    grass: new THREE.MeshStandardMaterial({ color: 0x5b8a42, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ color: 0xb8b1a3, roughness: 0.95 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.92, side: THREE.DoubleSide }),
    platform: new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.9, side: THREE.DoubleSide }),
    line: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    rope: new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.5 }),
    stump: new THREE.MeshStandardMaterial({ color: 0xf1e4c6, roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf5f7f9, roughness: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.45, metalness: 0.6 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x23344a, roughness: 0.95, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.55, side: THREE.DoubleSide }),
    boxWall: new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.8, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    gold: new THREE.MeshStandardMaterial({ color: 0xb8904f, roughness: 0.35, metalness: 0.65 }),
  };
  let stage = null;
  if (hall) {
    // Carpeted steps and floors; the stage, its curtains or screen, and the lighting truss
    mats.concrete.color.set(0x4a1f26); mats.platform.color.set(0x4a1f26);
    stage = buildHallStage(scene, layout, W, S, mats, board);
  } else {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R * 9, 64).rotateX(-Math.PI / 2), mats.grass); ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
    const paving = new THREE.Mesh(new THREE.CircleGeometry(R * 1.14, 128).rotateX(-Math.PI / 2), mats.paving); paving.receiveShadow = true; scene.add(paving);
    buildFeature(scene, f, W, S, mats);
  }

  // Stands: level by level, each level starting above the one in front of it
  const sections = new Map(), terraces = [];
  const levels = [...new Set(layout.sections.map((s) => s.level || 1))].sort((a, b) => a - b);
  let base = 0;
  const seatGeo = hall ? theatreSeatGeometry(P) : seatGeometry(P), chairGeo = chairGeometry(P);
  const dummy = new THREE.Object3D();
  for (const level of levels) {
    let top = base;
    for (const sec of layout.sections.filter((s) => (s.level || 1) === level)) {
      const booking = sec.booking || 'seats';
      const rs = rowsOf(sec).rowSpacing * S;
      // A hall's stalls are gently raked; its balconies are steeper. A ground's stands are steep throughout
      const lv = hall ? { h0: base + 0.25, rise: rs * (level === levels[0] ? 0.22 : 0.45), parapet: 0.7, trimBack: true } : { h0: base + 0.6, rise: rs * 0.5, parapet: 0.9 };
      const g = generated(sec);
      const tables = new Map((g.tables || []).map((t) => [t.key, t]));
      let mesh;
      const geo = booking === 'seats' ? terraceGeometry(sec, W, lv) : platformGeometry(sec, W, base + 0.6);
      const hosp = sectionView3d(sec).hospitality;
      const terrace = new THREE.Mesh(geo, (hosp ? mats.carpet : mats.concrete).clone());
      terrace.castShadow = true; terrace.receiveShadow = true; terrace.userData.sectionId = sec.id;
      scene.add(terrace); terraces.push(terrace);
      const n = Math.max(1, fittingRows(sec));
      top = Math.max(top, booking === 'seats' ? lv.h0 + (n - 1) * lv.rise + lv.parapet : base + 0.6);
      const seats = g.seats.map((s, idx) => {
        let dx, dy;
        if (s.tableKey && tables.get(s.tableKey)) { const t = tables.get(s.tableKey); dx = t.x - s.x; dy = t.y - s.y; }
        else if (sec.shape.type === 'arc') { dx = sec.shape.cx - s.x; dy = sec.shape.cy - s.y; }
        else { const [vx, vy] = rotate([0, -1], frameOf(sec.shape).facing); dx = vx; dy = vy; }
        const y = booking === 'seats' ? lv.h0 + s.rowIndex * lv.rise : base + 0.6;
        const [x, , z] = W(s.x, s.y, 0);
        return { ...s, idx, sectionId: sec.id, pos: new THREE.Vector3(x, y, z), rot: Math.atan2(dx, dy) };
      });
      if (seats.length) {
        mesh = new THREE.InstancedMesh(hosp ? chairGeo : seatGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: hosp ? 0.42 : 0.5 }), seats.length);
        for (const s of seats) { dummy.position.copy(s.pos); dummy.rotation.set(0, s.rot, 0); dummy.updateMatrix(); mesh.setMatrixAt(s.idx, dummy.matrix); mesh.setColorAt(s.idx, new THREE.Color(COLORS.none)); }
        mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.userData.sectionId = sec.id; scene.add(mesh);
      }
      if (hosp && seats.length) buildBoxShell(scene, sec, seats, W, lv, n, mats);
      const box = new THREE.Box3().setFromObject(terrace);
      const secTop = booking === 'seats' ? lv.h0 + (n - 1) * lv.rise + lv.parapet : base + 0.6;
      sections.set(sec.id, { sec, terrace, mesh, seats, seatByKey: new Map(seats.map((s) => [s.key, s])), box, rowDepth: rs, top: secTop, hosp });
    }
    base = top + (hall ? 3.5 : 2.2);
  }

  if (hall) {
    const shell = buildHallShell(scene, stage, sections, mats, R);
    const boxLight = new THREE.PointLight(0xffe2b8, 0, 12, 2); scene.add(boxLight);
    const labels = buildLabels(scene, sections);
    const setLow = () => {
      renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; sun.castShadow = false;
      scene.traverse((o) => { const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.needsUpdate = true; }); });
    };
    return {
      kind, renderer, scene, camera, controls, sun, hemi, floods: stage.spots, glow: [...stage.glow, ...shell.glow], sections, terraces, R, P, boxLight, labels, setLow, low,
      overviewPose: shell.overviewPose, sectionPose: shell.sectionPose, seatLook: stage.seatLook,
      // House lights up, or dimmed for the show (stage spotlights on)
      lighting: { day: { sun: 1.5, hemi: 0.85, flood: 0.5, fog: 0x0b0807 }, night: { sun: 0.1, hemi: 0.16, flood: 4, fog: 0x050303 } },
      sky: { day: scene.background, night: gradientTex('#070404', '#000000') },
    };
  }

  buildRoofs(scene, layout, sections, W, mats);

  // Floodlights and trees around the stadium
  const lampTex = canvasTex(256, 144, (g, w, h) => { g.fillStyle = '#1b1f24'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let y = 0; y < 5; y++) for (let x = 0; x < 9; x++) { g.beginPath(); g.arc(16 + x * 28, 16 + y * 28, 10, 0, Math.PI * 2); g.fill(); } });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveMap: lampTex, emissiveIntensity: 0.12 });
  const floods = [];
  for (let k = 0; k < 4; k++) {
    const a = (45 + 90 * k) * DEG, x = Math.cos(a) * R * 1.1, z = Math.sin(a) * R * 1.1, hgt = R * 0.62;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.005, R * 0.009, hgt, 10), mats.metal); pole.position.set(x, hgt / 2, z); pole.castShadow = true; scene.add(pole);
    const head = new THREE.Group(); head.position.set(x, hgt, z); head.lookAt(0, 0, 0); scene.add(head);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(R * 0.11, R * 0.065, R * 0.008), mats.metal); frame.castShadow = true; head.add(frame);
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.1, R * 0.056), lampMat); lamps.position.z = R * 0.0042; head.add(lamps);
    const spot = new THREE.SpotLight(0xf3f6ff, 0, 0, 0.62, 0.6, 0); spot.position.set(x, hgt, z); spot.target.position.set(0, 0, 0); scene.add(spot, spot.target); floods.push(spot);
  }
  {
    const n = low ? 60 : 170, tr = mulberry32(7), dm = new THREE.Object3D();
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.38, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x6d4c33, roughness: 1 }), n);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), n);
    const greens = ['#2f6b2a', '#3b7d30', '#477f2c', '#2a5e2f', '#55893a'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      let x, z;
      do { const a = tr() * Math.PI * 2, r = R * (1.22 + tr() * 0.7); x = Math.cos(a) * r; z = Math.sin(a) * r; } while (floods.some((fl) => Math.hypot(fl.position.x - x, fl.position.z - z) < R * 0.08));
      const s = 1.8 + tr() * 2.2;
      dm.position.set(x, 0, z); dm.rotation.set(0, tr() * 6, 0); dm.scale.set(1, 0.8 + s * 0.15, 1); dm.updateMatrix(); trunks.setMatrixAt(i, dm.matrix);
      dm.position.set(x, 2.6 + s * 0.9, z); dm.scale.set(s, s * 1.15, s); dm.updateMatrix(); crowns.setMatrixAt(i, dm.matrix); crowns.setColorAt(i, greens[i % greens.length]);
    }
    for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
  }
  // Warm light inside a hospitality box while the camera is in one
  const boxLight = new THREE.PointLight(0xffe2b8, 0, 12, 2); scene.add(boxLight);
  const labels = buildLabels(scene, sections);
  if (board) buildScoreboard(scene, sections, R, board, mats);
  // Lower detail after the fact (the render loop calls this when frames are slow)
  const setLow = () => {
    renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; sun.castShadow = false;
    scene.traverse((o) => { const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.needsUpdate = true; }); });
  };
  return {
    kind, renderer, scene, camera, controls, sun, hemi, floods, glow: [{ mat: lampMat, day: 0.12, show: 3 }], sections, terraces, R, P, boxLight, labels, setLow, low,
    overviewPose: null, seatLook: new THREE.Vector3(0, 0.6, 0),
    lighting: { day: { sun: 2.7, hemi: 0.95, flood: 0, fog: 0xd8e9f6 }, night: { sun: 0.12, hemi: 0.22, flood: 1.5, fog: 0x16263f } },
    sky: { day: scene.background, night: gradientTex('#02050d', '#16263f') },
  };
}

/** Stand names floating above each stand in the whole-ground view. Fixed on-screen size: they never grow with zoom. */
function buildLabels(scene, sections) {
  const group = new THREE.Group(); scene.add(group);
  for (const e of sections.values()) {
    const text = e.sec.name;
    const tex = canvasTex(512, 96, (g, w, h) => {
      g.font = '700 44px system-ui, Segoe UI, Arial, sans-serif';
      const tw = Math.min(w - 16, g.measureText(text).width + 44);
      g.fillStyle = 'rgba(15, 23, 42, 0.78)';
      const x = (w - tw) / 2, r = 30;
      g.beginPath(); g.moveTo(x + r, 12); g.arcTo(x + tw, 12, x + tw, h - 12, r); g.arcTo(x + tw, h - 12, x, h - 12, r); g.arcTo(x, h - 12, x, 12, r); g.arcTo(x, 12, x + tw, 12, r); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2, w - 40);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
    const c = e.box.getCenter(new THREE.Vector3());
    sp.position.set(c.x, e.box.max.y + 2.5, c.z); sp.scale.set(0.16, 0.03, 1); sp.renderOrder = 10;
    group.add(sp);
  }
  return group;
}

/**
 * A big screen behind the stand named "Scoreboard…" (or at the far end of the ground) showing the match, venue
 * and date. It never shows a score: there is no live score feed.
 */
function buildScoreboard(scene, sections, R, board, mats) {
  const host = [...sections.values()].find((e) => /scoreboard/i.test(e.sec.name));
  const dir = new THREE.Vector3(0, 0, 1);
  let dist = R * 1.02, base = 0;
  if (host) {
    const c = host.box.getCenter(new THREE.Vector3());
    dir.set(c.x, 0, c.z).normalize();
    dist = Math.hypot(c.x, c.z) + (host.box.getSize(new THREE.Vector3()).length() * 0.3) + 4;
    base = host.box.max.y;
  }
  const w = R * 0.26, h = w * 0.45;
  const y = base + h / 2 + 3;
  const tex = canvasTex(1024, 460, (g, W, H) => {
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#16a34a'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = '#86efac'; g.font = '700 34px system-ui, Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('TICKETLEDGER', W / 2, 62);
    const [a, b] = String(board.name || '').split(/\s+vs\.?\s+/i);
    g.fillStyle = '#fff';
    const fit = (t, size, yy) => { g.font = `800 ${size}px system-ui, Segoe UI, Arial, sans-serif`; g.fillText(t, W / 2, yy, W - 80); };
    if (b) { fit(a.toUpperCase(), 64, 160); g.fillStyle = '#94a3b8'; fit('VS', 38, 222); g.fillStyle = '#fff'; fit(b.toUpperCase(), 64, 290); }
    else fit(String(board.name || '').toUpperCase(), 60, 210);
    g.fillStyle = '#cbd5e1'; g.font = '500 34px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText([board.venue, board.when].filter(Boolean).join('  ·  '), W / 2, 395, W - 80);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, h + 1.2, 0.8), mats.metal);
  const pos = dir.clone().multiplyScalar(dist).setY(y);
  for (const m of [frame, screen]) { m.position.copy(pos); m.lookAt(0, y, 0); scene.add(m); }
  screen.position.addScaledVector(dir, -0.45);
  frame.castShadow = true;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, y - h / 2, 0.8), mats.metal);
    const across = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side * w * 0.35);
    leg.position.copy(pos).add(across).setY((y - h / 2) / 2); leg.castShadow = true; scene.add(leg);
  }
}

// Each scene build gets a new number, so effects that paint seats or move the camera run again after a rebuild
let buildSeq = 0;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ─── Component ───────────────────────────────────────────────────────────────────────────────────────────────
export default function Venue3D({
  layout, tiers, event, focusId, stateOf, sectionInfo, mineCount, maxTickets, secondsLeft, busy,
  onOpenSection, onBackToVenue, onSelectSeat, onRemoveSeat, onGetTickets, onReady, heldKeys = [], onShowHeld, onSeatCard,
}) {
  const hostRef = useRef(null);
  const tipRef = useRef(null);
  const ctxRef = useRef(null);
  const props = useRef({});
  props.current = { stateOf, sectionInfo, onOpenSection, onBackToVenue, onSelectSeat, focusId, tiers, colorOf: null };
  const [view, setView] = useState({ mode: 'overview', seatKey: null });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [night, setNight] = useState(false);
  const [legendOpen, setLegendOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 640px)').matches);
  const [ready, setReady] = useState(0); // 0 = no scene; otherwise the build number
  const [rebuild, setRebuild] = useState(0);
  const lastFocus = useRef(null);
  // A seat just reserved by a click: its view stays open while the page catches up with the server (the seat can
  // read as free for a moment between the hold and the refreshed seat states)
  const confirming = useRef(null); // { key, until }
  const [recheck, setRecheck] = useState(0);
  const liveRef = useRef(null);
  const boardKey = [event?.name, event?.venue, event?.city, event?.date, event?.time].join('|');
  const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const v3 = useMemo(() => view3dOf(layout), [layout]);
  // Cricket ground or indoor hall (theatre, auditorium, conference room): same seats and booking, different room
  const kind = venue3dKind(layout) || 'stadium';
  const words = VENUE_WORDS[kind];
  // Seat colour for a ticket type: its own colour, or the team colour when the organizer chose team colours
  // Ticket types sold only in hospitality boxes show as leather seats
  const boxOnlyTiers = useMemo(() => {
    const ids = new Set();
    for (const s of layout.sections) if (s.tierId && sectionView3d(s).hospitality) ids.add(s.tierId);
    for (const s of layout.sections) if (s.tierId && !sectionView3d(s).hospitality) ids.delete(s.tierId);
    return ids;
  }, [layout]);
  const tierColor = useCallback((t) => (boxOnlyTiers.has(t.id) ? LEATHER : v3.seatColors === 'team' ? v3.teamColors[0] : tier3dColor(t.color)), [v3, boxOnlyTiers]);
  const colorOf = useCallback((sec, state) => {
    if (state === 'available') { const t = tiers[sec.tierId]; return t ? tierColor(t) : COLORS.none; }
    return COLORS[state] || COLORS.none;
  }, [tiers, tierColor]);
  props.current.colorOf = colorOf;

  // Build the stadium once per plan
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !layout) return undefined;
    let ctx;
    try {
      const when = [event?.date ? formatEventDate(event.date) : '', formatEventTime(event?.time)].filter(Boolean).join(' · ');
      ctx = buildScene(host, layout, { kind, low: startsLowDetail(layout), board: event?.name ? { name: event.name, venue: [event.venue, event.city].filter(Boolean).join(', '), when } : null });
    } catch (e) {
      console.error('[Venue3D] could not build the 3D view', e);
      return undefined;
    }
    ctxRef.current = ctx;
    const { renderer, scene, camera, controls, sections, terraces, R } = ctx;
    const canvas = renderer.domElement;
    const look = new THREE.Vector3(), eye = new THREE.Vector3(), lookBase = new THREE.Vector3(0, 0.6, 0);
    const sph = new THREE.Spherical(), tmp = new THREE.Vector3();
    let flight = null, yaw = 0, pitch = 0, hoverSec = null, hoverSeat = null, pointer = null, pointerDirty = false, down = null, raf = 0;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const size = () => { const w = host.clientWidth || 800, h = host.clientHeight || 500; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);

    const portrait = () => camera.aspect < 1;
    const overviewPose = () => { if (ctx.overviewPose) return ctx.overviewPose(portrait()); const k = portrait() ? 1.7 : 1; return { pos: new THREE.Vector3(0, R * 1.35 * k, R * 1.15 * k), target: new THREE.Vector3(0, 0, R * 0.04) }; };
    const sectionPose = (entry) => {
      if (ctx.sectionPose) return ctx.sectionPose(entry.box, portrait()); // hall: stays inside the room
      const c = entry.box.getCenter(new THREE.Vector3()), sz = entry.box.getSize(new THREE.Vector3());
      const toCenter = new THREE.Vector3(-c.x, 0, -c.z); if (toCenter.lengthSq() < 1e-6) toCenter.set(0, 0, 1); toCenter.normalize();
      const D = Math.max(sz.x, sz.z) * (portrait() ? 1.25 : 0.85) + 6;
      return { pos: c.clone().addScaledVector(toCenter, D).add(new THREE.Vector3(0, D * 0.42 + sz.y * 0.4, 0)), target: c.clone().setY(c.y * 0.8) };
    };
    const seatEye = (s) => s.pos.clone().add(new THREE.Vector3(0, 1.18 * ctx.P, 0));

    const setFov = (f) => { camera.fov = f; camera.updateProjectionMatrix(); };
    const flyTo = (pos, target, { lift = 0, dur = 2000, done } = {}) => { controls.enabled = false; flight = { from: camera.position.clone(), to: pos.clone(), tf: look.clone(), tt: target.clone(), t0: performance.now(), dur, lift, done }; };
    const toOrbit = (p) => () => { controls.target.copy(p.target); controls.enabled = true; };
    ctx.goOverview = () => { setFov(50); ctx.labels.visible = true; ctx.boxLight.intensity = 0; const p = overviewPose(); setView({ mode: 'overview', seatKey: null }); flyTo(p.pos, p.target, { lift: R * 0.25, done: toOrbit(p) }); };
    ctx.goSection = (id, from) => { setFov(50); ctx.labels.visible = false; ctx.boxLight.intensity = 0; const e = sections.get(id); if (!e) return; const p = sectionPose(e); setView({ mode: 'section', seatKey: null }); flyTo(p.pos, p.target, { lift: from === 'overview' ? R * 0.15 : 2, done: toOrbit(p) }); };
    // A seat's own view ('seat'), or a hospitality box seat previewed as an upgrade from seat `from` ('box')
    ctx.goSeat = (key, { from } = {}) => {
      const e = sections.get(key.split('/')[0]); const s = e?.seatByKey.get(key); if (!s) return;
      // In a box, look slightly down so the ledge, glass and seats in front are in view too
      yaw = 0; pitch = e.hosp ? 0.3 : 0; eye.copy(seatEye(s)); lookBase.copy(ctx.seatLook);
      setFov(62); // closer to what a person sees from a seat
      ctx.labels.visible = false;
      ctx.boxLight.intensity = e.hosp ? 7 : 0; ctx.boxLight.position.copy(eye).add(new THREE.Vector3(0, 1.1, 0));
      setView(from ? { mode: 'box', seatKey: from, boxKey: key } : { mode: 'seat', seatKey: key });
      const t = lookBase.clone().sub(eye); sph.setFromVector3(t); sph.phi = THREE.MathUtils.clamp(sph.phi + pitch, 0.25, Math.PI - 0.25); t.setFromSpherical(sph);
      flyTo(eye, eye.clone().add(t), { lift: 2 });
    };
    // Night match (ground) or show lighting (hall)
    ctx.setNight = (on) => {
      const L = on ? ctx.lighting.night : ctx.lighting.day;
      scene.background = on ? ctx.sky.night : ctx.sky.day; scene.fog.color.set(L.fog);
      ctx.sun.intensity = L.sun; ctx.hemi.intensity = L.hemi;
      for (const fl of ctx.floods) fl.intensity = L.flood;
      for (const g of ctx.glow) { const k = on ? g.show : g.day; if (g.basic) g.mat.color.setScalar(k); else g.mat.emissiveIntensity = k; }
    };

    const setNdc = (e) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
    const pickSection = () => { const h = ray.intersectObjects(terraces, false)[0]; return h ? sections.get(h.object.userData.sectionId) : null; };
    const pickSeat = (entry) => {
      if (!entry?.mesh) return null;
      const h = ray.intersectObject(entry.mesh, false)[0];
      if (h) return entry.seats[h.instanceId];
      // Pointer on the steps between seats: take the nearest seat, so a slightly-off click still picks one
      const t = ray.intersectObject(entry.terrace, false)[0];
      if (!t) return null;
      let best = null, bd = Infinity;
      for (const s of entry.seats) { const dx = s.pos.x - t.point.x, dy = s.pos.y - t.point.y, dz = s.pos.z - t.point.z; const d = dx * dx + dz * dz + dy * dy; if (d < bd) { bd = d; best = s; } }
      return bd <= (entry.rowDepth * 0.9) ** 2 ? best : null;
    };
    const tint = (entry, on) => { if (!entry) return; const t = props.current.tiers[entry.sec.tierId]; entry.terrace.material.emissive.set(on && t ? props.current.colorOf(entry.sec, 'available') : '#000').multiplyScalar(on ? 0.3 : 1); if (entry.mesh) entry.mesh.material.emissive.set(on ? '#303030' : '#000'); };
    const paintSeat = (s, hover) => {
      const e = sections.get(s.sectionId); const c = new THREE.Color(props.current.colorOf(e.sec, props.current.stateOf(s.key, s)));
      if (hover) c.lerp(new THREE.Color('#fff'), 0.45);
      e.mesh.setColorAt(s.idx, c); e.mesh.instanceColor.needsUpdate = true;
    };
    const tip = (html, x, y) => {
      const el = tipRef.current; if (!el) return;
      if (!html) { el.style.display = 'none'; return; }
      const r = host.getBoundingClientRect();
      el.innerHTML = html; el.style.display = 'block';
      el.style.left = `${Math.min(x - r.left + 14, r.width - 250)}px`; el.style.top = `${Math.min(y - r.top + 14, r.height - 80)}px`;
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clearHover = () => { if (hoverSec) { tint(hoverSec, false); hoverSec = null; } if (hoverSeat) { paintSeat(hoverSeat, false); hoverSeat = null; } tip(null); canvas.style.cursor = ''; };
    ctx.clearHover = clearHover;

    const hoverTest = () => {
      if (!pointer || pointer.type === 'touch' || flight) return;
      setNdc(pointer);
      const mode = viewRef.current.mode;
      if (mode === 'overview' || mode === 'section') {
        const focused = mode === 'section' ? sections.get(props.current.focusId) : null;
        const s = focused ? pickSeat(focused) : null;
        if (s !== hoverSeat) { if (hoverSeat) paintSeat(hoverSeat, false); hoverSeat = s; if (s) paintSeat(s, true); }
        if (s) {
          const st = props.current.stateOf(s.key, s), t = props.current.tiers[focused.sec.tierId];
          const label = s.tableKey ? `${esc(s.row)} · Seat ${esc(s.number)}` : `Row ${esc(s.row)} · Seat ${esc(s.number)}`;
          tip(`<b>${label}</b><span>${st === 'available' && t ? `<em>${esc(t.name)} · ${formatPkr(t.price)}</em>` : STATE_LABEL[st]}</span>`, pointer.x, pointer.y);
          canvas.style.cursor = st === 'available' || st === 'mine' ? 'pointer' : 'not-allowed';
          if (hoverSec) { tint(hoverSec, false); hoverSec = null; }
          return;
        }
        const e = pickSection();
        const hov = e && e !== focused ? e : null;
        if (hov !== hoverSec) { tint(hoverSec, false); hoverSec = hov; tint(hov, true); }
        if (hov) {
          const m = props.current.sectionInfo(hov.sec);
          const avail = m.status === 'soldout' ? 'Sold out' : m.status === 'unavailable' ? 'Not on sale' : `${m.available.toLocaleString('en-PK')} ${m.unit}${m.available === 1 ? '' : 's'} left`;
          tip(`<b>${esc(hov.sec.name)}</b><span><em>${esc(m.tier?.name || '')}${m.price ? ` · ${esc(m.price)}` : ''}</em></span><span>${avail}</span>`, pointer.x, pointer.y);
          canvas.style.cursor = 'pointer';
        } else { tip(null); canvas.style.cursor = ''; }
      }
    };
    const onClick = async (e) => {
      if (flight) return;
      setNdc(e);
      const mode = viewRef.current.mode;
      if (mode === 'seat' || mode === 'box') return;
      const focused = mode === 'section' ? sections.get(props.current.focusId) : null;
      const s = focused ? pickSeat(focused) : null;
      if (s) {
        const st = props.current.stateOf(s.key, s);
        if (st === 'mine') { clearHover(); ctx.goSeat(s.key); return; }
        if (st !== 'available') return;
        clearHover();
        const ok = await props.current.onSelectSeat(s.key, s.tableKey ? `${s.row}, seat ${s.number}` : `Row ${s.row}, seat ${s.number}`);
        if (ok) { confirming.current = { key: s.key, until: performance.now() + 6000 }; ctx.goSeat(s.key); }
        return;
      }
      const hit = pickSection();
      if (hit && hit !== focused) { clearHover(); props.current.onOpenSection(hit.sec); }
    };
    const onMove = (e) => {
      pointer = { x: e.clientX, y: e.clientY, type: e.pointerType, clientX: e.clientX, clientY: e.clientY }; pointerDirty = true;
      if (down && e.isPrimary && (viewRef.current.mode === 'seat' || viewRef.current.mode === 'box') && !flight) {
        yaw = THREE.MathUtils.clamp(yaw + (e.clientX - down.lx) * 0.0045, -1.3, 1.3);
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - down.ly) * 0.0035, -0.6, 0.5);
        down.lx = e.clientX; down.ly = e.clientY;
      }
    };
    const onDown = (e) => { down = e.isPrimary ? { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now() } : null; };
    const onUp = (e) => { if (down && e.isPrimary && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 600) onClick(e); down = null; };
    const onLeave = () => { pointer = null; clearHover(); };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);

    // Keyboard: arrows move between stands (whole ground) or seats (inside a stand), Enter opens or reserves,
    // Escape goes back (handled by the component). Each step is described in a live region for screen readers.
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', `${words.view}. Use the arrow keys to move between ${words.part}s and seats, Enter to choose, Escape to go back.`);
    const say = (t) => { if (liveRef.current) liveRef.current.textContent = t; };
    const order = [...sections.values()].sort((a, b) => { const ca = a.box.getCenter(new THREE.Vector3()), cb = b.box.getCenter(new THREE.Vector3()); return Math.atan2(ca.z, ca.x) - Math.atan2(cb.z, cb.x); });
    let kSec = null, kSeat = null;
    const describeSec = (e) => {
      const m = props.current.sectionInfo(e.sec);
      const avail = m.status === 'soldout' ? 'sold out' : m.status === 'unavailable' ? 'not on sale' : `${m.available} ${m.unit}${m.available === 1 ? '' : 's'} left`;
      return `${e.sec.name}. ${m.tier?.name || ''} ${m.price || ''}. ${avail}. Press Enter to open.`;
    };
    const describeSeat = (st, s, e) => {
      const t = props.current.tiers[e.sec.tierId];
      return `Row ${s.row}, seat ${s.number}. ${st === 'available' ? `${t?.name || ''} ${t ? formatPkr(t.price) : ''}. Press Enter to reserve it for 10 minutes.` : STATE_LABEL[st]}.`;
    };
    const onKey = async (e) => {
      if (flight) return;
      const mode = viewRef.current.mode;
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = dirs[e.key];
      if (mode === 'seat' || mode === 'box') {
        if (d) { e.preventDefault(); yaw = THREE.MathUtils.clamp(yaw - d[0] * 0.12, -1.3, 1.3); pitch = THREE.MathUtils.clamp(pitch - d[1] * 0.08, -0.6, 0.5); }
        return;
      }
      if (mode === 'overview') {
        if (d) {
          e.preventDefault();
          const i = kSec ? order.indexOf(kSec) : -1;
          const next = order[(i + (d[0] || d[1]) + order.length) % order.length];
          tint(kSec, false); kSec = next; tint(kSec, true); say(describeSec(kSec));
        } else if (e.key === 'Enter' && kSec) { e.preventDefault(); tint(kSec, false); props.current.onOpenSection(kSec.sec); }
        return;
      }
      const entry = sections.get(props.current.focusId);
      if (!entry?.mesh) return;
      if (d) {
        e.preventDefault();
        if (!kSeat || kSeat.sectionId !== entry.sec.id) kSeat = entry.seats.find((s) => props.current.stateOf(s.key, s) === 'available') || entry.seats[0];
        else {
          let next;
          if (d[0]) next = entry.seats.find((s) => s.rowIndex === kSeat.rowIndex && s.position === kSeat.position - d[0]); // left/right as seen from the pitch
          else {
            const row = entry.seats.filter((s) => s.rowIndex === kSeat.rowIndex + d[1]);
            if (row.length) next = row.reduce((b, s) => (Math.abs(s.position - kSeat.position) < Math.abs(b.position - kSeat.position) ? s : b));
          }
          if (next) { paintSeat(kSeat, false); kSeat = next; }
        }
        paintSeat(kSeat, true);
        say(describeSeat(props.current.stateOf(kSeat.key, kSeat), kSeat, entry));
      } else if (e.key === 'Enter' && kSeat && kSeat.sectionId === entry.sec.id) {
        e.preventDefault();
        const st = props.current.stateOf(kSeat.key, kSeat), s = kSeat;
        paintSeat(s, false); kSeat = null;
        if (st === 'mine') ctx.goSeat(s.key);
        else if (st === 'available' && (await props.current.onSelectSeat(s.key, `Row ${s.row}, seat ${s.number}`))) { confirming.current = { key: s.key, until: performance.now() + 6000 }; ctx.goSeat(s.key); }
        else say(`Row ${s.row}, seat ${s.number} is ${STATE_LABEL[st].toLowerCase()}.`);
      }
    };
    canvas.addEventListener('keydown', onKey);

    // The browser dropped the 3D context (GPU reset, too many 3D pages open): rebuild instead of staying blank
    const onLost = (e) => { e.preventDefault(); cancelAnimationFrame(raf); console.warn('[Venue3D] 3D context lost; rebuilding when the browser restores it'); };
    const onRestored = () => setRebuild((n) => n + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    let frames = 0, slowSince = null, last = 0;
    const pulse = new THREE.Color(), reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      // Slow frames for 3 seconds in a row (not during the first second): switch to lower detail once
      if (!ctx.low && last) {
        frames++;
        const dt = now - last;
        if (frames > 60 && dt > 45 && document.visibilityState === 'visible') { slowSince = slowSince ?? now; if (now - slowSince > 3000) { ctx.low = true; ctx.setLow(); } }
        else if (dt < 30) slowSince = null;
      }
      last = now;
      if (flight) {
        const fl = flight, t = Math.min(1, (now - fl.t0) / fl.dur), k = ease(t);
        camera.position.lerpVectors(fl.from, fl.to, k); camera.position.y += Math.sin(Math.PI * k) * fl.lift;
        look.lerpVectors(fl.tf, fl.tt, k); camera.lookAt(look);
        if (t >= 1) { flight = null; fl.done?.(); }
      } else if (viewRef.current.mode === 'seat' || viewRef.current.mode === 'box') {
        tmp.subVectors(lookBase, eye); sph.setFromVector3(tmp);
        sph.theta += yaw; sph.phi = THREE.MathUtils.clamp(sph.phi + pitch, 0.25, Math.PI - 0.25);
        tmp.setFromSpherical(sph); camera.position.copy(eye); look.copy(eye).add(tmp); camera.lookAt(look);
      } else { controls.update(); look.copy(controls.target); }
      if (pointerDirty) { pointerDirty = false; hoverTest(); }
      // Seats held for you pulse between blue and pale blue: reserved, but not paid for yet
      if (ctx.heldSeats?.length && !reduceMotion) {
        const k = 0.5 + 0.5 * Math.sin(now / 320);
        pulse.set(COLORS.mine).lerp(PULSE_TO, 0.15 + 0.55 * k);
        const touched = new Set();
        for (const { e, s } of ctx.heldSeats) { if (s === hoverSeat) continue; e.mesh.setColorAt(s.idx, pulse); touched.add(e.mesh); }
        for (const m of touched) m.instanceColor.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    const p0 = overviewPose();
    camera.position.copy(p0.pos); controls.target.copy(p0.target); look.copy(p0.target); camera.lookAt(look);
    raf = requestAnimationFrame(tick);
    // A fresh scene starts over the whole ground; the focus effect below flies back to the open stand
    lastFocus.current = null;
    setView({ mode: 'overview', seatKey: null });
    setReady(++buildSeq);
    // For automated checks and embedding: lets a caller move the camera like a click would
    onReady?.({ goSeat: ctx.goSeat, goSection: ctx.goSection, goOverview: ctx.goOverview, sections });
    if (import.meta.env.DEV) window.__tl3d = { ctx, sections, camera, THREE, terraces }; // development only: inspect the scene from the console

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('keydown', onKey);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.emissiveMap?.dispose?.(); x.dispose?.(); }); });
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      // Give the 3D context back to the browser now (browsers allow only a few at once and drop the oldest)
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); ctxRef.current = null; setReady(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, boardKey, rebuild]);

  // Seat colours follow the live states (holds, sales, other fans' holds)
  useEffect(() => {
    const ctx = ctxRef.current; if (!ctx || !ready) return;
    const c = new THREE.Color();
    const held = [];
    for (const e of ctx.sections.values()) {
      if (!e.mesh) continue;
      for (const s of e.seats) { const st = stateOf(s.key, s); c.set(colorOf(e.sec, st)); e.mesh.setColorAt(s.idx, c); if (st === 'mine') held.push({ e, s }); }
      e.mesh.instanceColor.needsUpdate = true;
    }
    ctx.heldSeats = held; // pulsed by the render loop: held for you, not paid yet
  }, [ready, stateOf, colorOf]);

  // The parent decides which section is open (shared with the 2D plan)
  useEffect(() => {
    const ctx = ctxRef.current; if (!ctx || !ready) return;
    const was = lastFocus.current; lastFocus.current = focusId;
    if (focusId && (focusId !== was || viewRef.current.mode === 'overview')) { ctx.clearHover(); if ((viewRef.current.mode !== 'seat' && viewRef.current.mode !== 'box') || focusId !== was) ctx.goSection(focusId, viewRef.current.mode); }
    else if (!focusId && viewRef.current.mode !== 'overview') { ctx.clearHover(); ctx.goOverview(); }
  }, [focusId, ready]);

  useEffect(() => { ctxRef.current?.setNight?.(night); }, [night, ready]);

  // Show a stand. If it isn't the stand the page has open (after a box switch, say), tell the page: the focus
  // effect then flies there, and seat clicks go to the right stand
  const toSection = useCallback((sec) => {
    if (sec.id !== focusId) onOpenSection(sec);
    else ctxRef.current?.goSection(sec.id, 'seat');
  }, [focusId, onOpenSection]);

  // A seat that stops being yours (expired, released elsewhere) closes its view
  const seatEntry = useMemo(() => {
    if (!view.seatKey || !ctxRef.current) return null;
    const e = ctxRef.current.sections.get(view.seatKey.split('/')[0]);
    const s = e?.seatByKey.get(view.seatKey);
    return s ? { sec: e.sec, seat: s } : null;
  }, [view.seatKey, ready]);
  const seatState = seatEntry ? stateOf(seatEntry.seat.key, seatEntry.seat) : null;
  useEffect(() => {
    if (!((view.mode === 'seat' || view.mode === 'box') && seatEntry)) return undefined;
    if (seatState === 'mine' || seatState === 'pending') { if (confirming.current?.key === seatEntry.seat.key && seatState === 'mine') confirming.current = null; return undefined; }
    const c = confirming.current;
    if (c && c.key === seatEntry.seat.key && performance.now() < c.until) {
      const id = setTimeout(() => setRecheck((n) => n + 1), c.until - performance.now() + 50); // still not yours by then: close
      return () => clearTimeout(id);
    }
    confirming.current = null;
    toSection(seatEntry.sec);
    return undefined;
  }, [view.mode, seatEntry, seatState, toSection, recheck]);

  // Upgrade offer: the best free seat in a hospitality box: second row first (the box, its glass and the seats in
  // front are in view), then the front row, then further back; middle of the row first
  const boxOffer = useMemo(() => {
    const ctx = ctxRef.current;
    if (!ctx || !seatEntry || sectionView3d(seatEntry.sec).hospitality) return null;
    let best = null;
    for (const e of ctx.sections.values()) {
      if (!e.hosp || !e.mesh) continue;
      const rowLen = new Map();
      for (const s of e.seats) rowLen.set(s.rowIndex, Math.max(rowLen.get(s.rowIndex) || 0, s.position + 1));
      for (const s of e.seats) {
        if (stateOf(s.key, s) !== 'available') continue;
        const rowRank = s.rowIndex === 1 ? 0 : s.rowIndex === 0 ? 1 : s.rowIndex;
        const edge = s.position % BOX_SEATS === 0 || s.position % BOX_SEATS === BOX_SEATS - 1 ? 100 : 0; // not against a partition
        const score = rowRank * 1000 + edge + Math.abs(s.position - (rowLen.get(s.rowIndex) - 1) / 2);
        if (!best || score < best.score) best = { score, sec: e.sec, seat: s };
      }
    }
    return best;
  }, [seatEntry, stateOf, ready]);
  const boxEntry = useMemo(() => {
    if (view.mode !== 'box' || !view.boxKey || !ctxRef.current) return null;
    const e = ctxRef.current.sections.get(view.boxKey.split('/')[0]);
    const s = e?.seatByKey.get(view.boxKey);
    return s ? { sec: e.sec, seat: s } : null;
  }, [view.mode, view.boxKey, ready]);
  // The previewed box seat was taken meanwhile: back to the customer's own seat
  const boxState = boxEntry ? stateOf(boxEntry.seat.key, boxEntry.seat) : null;
  useEffect(() => {
    if (view.mode === 'box' && boxEntry && boxState !== 'available' && boxState !== 'pending' && boxState !== 'mine' && seatEntry) ctxRef.current?.goSeat(seatEntry.seat.key);
  }, [view.mode, boxEntry, boxState, seatEntry]);
  const reserveBox = async () => {
    if (!boxEntry || !seatEntry) return;
    const b = boxEntry.seat, label = `${boxEntry.sec.name}, box ${boxOf(b)}, row ${b.row}, seat ${b.number}`;
    if (!(await onSelectSeat(b.key, label))) return;
    await onRemoveSeat(seatEntry.seat.key);
    ctxRef.current?.goSeat(b.key);
  };


  const back = useCallback(() => {
    if (view.mode === 'box' && seatEntry) ctxRef.current?.goSeat(seatEntry.seat.key);
    else if (view.mode === 'seat' && seatEntry) toSection(seatEntry.sec);
    else onBackToVenue();
  }, [view.mode, seatEntry, onBackToVenue, toSection]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && view.mode !== 'overview') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, view.mode]);

  const nextSeat = () => {
    if (!seatEntry) return null;
    const ctx = ctxRef.current, e = ctx.sections.get(seatEntry.sec.id);
    const row = e.seats.filter((s) => s.rowIndex === seatEntry.seat.rowIndex && !s.tableKey);
    const mineHere = row.filter((s) => stateOf(s.key, s) === 'mine').map((s) => s.position);
    const tries = mineHere.length ? [Math.max(...mineHere) + 1, Math.min(...mineHere) - 1] : [seatEntry.seat.position + 1, seatEntry.seat.position - 1];
    for (const p of tries) { const s = row.find((x) => x.position === p); if (s && stateOf(s.key, s) === 'available') return s; }
    return null;
  };
  const addNext = async () => {
    const s = nextSeat();
    if (!s) return;
    const ok = await onSelectSeat(s.key, `Row ${s.row}, seat ${s.number}`);
    if (ok) ctxRef.current?.goSeat(s.key);
  };

  // Entry gates that accept a ticket type (from the event's gate setup; empty list = the type isn't restricted)
  const gatesFor = useCallback((tierId) => (event?.gates || []).filter((g) => !g.allowedTierIds?.length || g.allowedTierIds.includes(tierId)).map((g) => g.name), [event]);
  const tierList = useMemo(() => Object.values(tiers).filter((t) => layout.sections.some((s) => s.tierId === t.id)), [tiers, layout]);
  const inSeat = view.mode === 'seat' && seatEntry;
  const inBox = view.mode === 'box' && seatEntry && boxEntry;
  const boxTier = inBox ? tiers[boxEntry.sec.tierId] : boxOffer ? tiers[boxOffer.sec.tierId] : null;
  const tier = (inSeat || inBox) ? tiers[seatEntry.sec.tierId] : null;
  const diff = (boxTier?.price || 0) - (tier?.price || 0);
  const diffText = `${diff >= 0 ? '+' : '−'}${formatPkr(Math.abs(diff))}`;
  // The page's My Tickets button opens and closes this card, so it needs to know whether one is open
  const cardKey = inSeat ? seatEntry.seat.key : null;
  useEffect(() => { onSeatCard?.(cardKey); }, [cardKey, onSeatCard]);
  const seatLabel = inSeat ? (seatEntry.seat.tableKey ? `${seatEntry.seat.row} · Seat ${seatEntry.seat.number}` : `Row ${seatEntry.seat.row} · Seat ${seatEntry.seat.number}`) : '';
  const focusedName = focusId ? layout.sections.find((s) => s.id === focusId)?.name : '';
  const hint = view.mode === 'overview' ? (touch ? `Tap a ${words.part} to fly in · drag to rotate · pinch to zoom` : `Hover a ${words.part} for prices · click to fly in · drag to rotate`)
    : view.mode === 'section' ? `${touch ? 'Tap' : 'Click'} a coloured seat to reserve it for 10 minutes`
      : view.mode === 'box' ? 'Hospitality box view · drag to look around' : 'Your view from this seat · drag to look around';

  return (
    <div className={`tl-v3${inSeat || inBox ? ' is-seat' : ''}`}>
      <div className="tl-v3-canvas" ref={hostRef} />
      <div className="tl-v3-tip" ref={tipRef} />

      {view.mode !== 'overview' && (
        <div className="tl-v3-nav">
          {(inSeat || inBox) && (
            <button type="button" className="tl-v3-pill" onClick={back}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /> <span>{inBox ? 'Back to my seat' : seatEntry.sec.name}</span>
            </button>
          )}
          <button type="button" className="tl-v3-pill is-ground" onClick={onBackToVenue} aria-label={`Show the whole ${words.venue}`}>
            <span className="tl-v3-pill-ico"><Maximize2 className="w-4 h-4" aria-hidden="true" /></span>
            <span className="tl-v3-pill-txt"><b>{words.whole}</b>{!inSeat && !inBox && focusedName && <small>Leave {focusedName}</small>}</span>
          </button>
        </div>
      )}
      <button type="button" className="tl-v3-pill tl-v3-night" onClick={() => setNight((n) => !n)} aria-pressed={night}>
        {kind === 'hall'
          ? <>{night ? <Lightbulb className="w-4 h-4" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />} {night ? 'House lights' : 'Show lighting'}</>
          : <>{night ? <Sun className="w-4 h-4" aria-hidden="true" /> : <Moon className="w-4 h-4" aria-hidden="true" />} {night ? 'Day match' : 'Night match'}</>}
      </button>

      {!inSeat && !inBox && (
        <div className={`tl-v3-legend${legendOpen ? '' : ' is-closed'}`} aria-label="Seat colours">
          <button type="button" className="tl-v3-legend-head" onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}>
            <span className="tl-v3-legend-ico"><Info className="w-3.5 h-3.5" aria-hidden="true" /></span>
            <span className="tl-v3-legend-title">Seat key</span>
            <ChevronDown className="tl-v3-legend-chev w-4 h-4" aria-hidden="true" />
          </button>
          {legendOpen && (
            <>
              <ul className="tl-v3-prices" aria-label="Ticket types">
                {tierList.map((t) => (
                  <li key={t.id} style={{ '--tc': tierColor(t) }}>
                    <i className="tl-v3-seat-ico" aria-hidden="true" />
                    <span>{t.name}</span>
                    <b>{formatPkr(t.price)}</b>
                  </li>
                ))}
              </ul>
              <ul className="tl-v3-states" aria-label="Seat states">
                {['mine', 'held', 'sold', 'blocked'].map((k) => (
                  <li key={k} style={{ '--tc': COLORS[k] }}>
                    <i className="tl-v3-seat-ico" aria-hidden="true" /> {k === 'mine' ? 'Held · not paid' : k === 'held' ? 'Held' : k === 'sold' ? 'Sold' : 'Not on sale'}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {inSeat && (
        <SeatTicketCard
          className="tl-v3-seatcard"
          section={seatEntry.sec.name}
          title={seatLabel}
          tierName={tier?.name}
          tierColor={tier ? tierColor(tier) : COLORS.none}
          price={formatPkr(tier?.price)}
          extra={{ label: 'Your tickets', value: `${mineCount} of ${maxTickets}` }}
          nav={heldKeys.length > 1 && onShowHeld ? (() => {
            const i = Math.max(0, heldKeys.indexOf(seatEntry.seat.key)), n = heldKeys.length;
            return { index: i, count: n, prev: () => onShowHeld(heldKeys[(i - 1 + n) % n]), next: () => onShowHeld(heldKeys[(i + 1) % n]) };
          })() : null}
          gates={gatesFor(seatEntry.sec.tierId)}
          secondsLeft={secondsLeft}
          note="Held for you for 10 minutes. It stays in My Tickets when you close this card."
          onClose={back}
          closeLabel="Close: the seat stays in My Tickets"
        >
          <div className="tl-v3-actions">
            <button type="button" className="tl-v3-btn is-primary" onClick={addNext} disabled={!nextSeat() || mineCount >= maxTickets || busy}><Plus className="w-4 h-4" aria-hidden="true" /> Add next seat</button>
            <button type="button" className="tl-v3-btn" onClick={back}><Eye className="w-4 h-4" aria-hidden="true" /> See another seat</button>
          </div>
          <div className="tl-v3-actions">
            <button type="button" className="tl-v3-btn is-dark" onClick={onGetTickets}><ShoppingBag className="w-4 h-4" aria-hidden="true" /> Get tickets ({mineCount})</button>
            <button type="button" className="tl-v3-btn is-ghost" onClick={() => onRemoveSeat(seatEntry.seat.key)} disabled={busy}><Trash2 className="w-4 h-4" aria-hidden="true" /> Remove</button>
          </div>
          {boxOffer && boxTier && (
            <div className="tl-v3-actions">
              <button type="button" className="tl-v3-btn is-gold" onClick={() => ctxRef.current?.goSeat(boxOffer.seat.key, { from: seatEntry.seat.key })} disabled={busy}>
                <ArrowUpRight className="w-4 h-4" aria-hidden="true" /> {diff > 0 ? `Upgrade to a box · ${diffText}` : diff === 0 ? 'See a hospitality box · same price' : `See a hospitality box · ${diffText}`}
              </button>
            </div>
          )}
        </SeatTicketCard>
      )}

      {/* Hospitality box offer: its own card (no ticket or QR preview is shown before payment) */}
      {inBox && (
        <section className="tl-v3-card tl-v3-boxcard" aria-label="Hospitality box upgrade">
          <div className="tl-v3-card-head">
            <div><small>{boxEntry.sec.name}</small><b>Box {boxOf(boxEntry.seat)} · Row {boxEntry.seat.row} · Seat {boxEntry.seat.number}</b></div>
            <span className="tl-v3-badge is-gold">Hospitality</span>
          </div>
          <ul className="tl-v3-perks"><li>Glass-fronted box with leather seats</li><li>This is the view from this box seat</li></ul>
          <div className="tl-v3-facts is-3">
            <div><small>Box seat</small><b>{formatPkr(boxTier?.price)}</b></div>
            <div><small>Your seat</small><b>{formatPkr(tier?.price)}</b></div>
            <div><small>Difference</small><b>{diff === 0 ? 'Same price' : diffText}</b></div>
          </div>
          <p className="tl-v3-note">Switching reserves this box seat for 10 minutes and then releases your current seat.</p>
          <div className="tl-v3-actions">
            <button type="button" className="tl-v3-btn is-gold" onClick={reserveBox} disabled={busy || boxState !== 'available'}>Switch to this box seat</button>
          </div>
          <div className="tl-v3-actions">
            <button type="button" className="tl-v3-btn" onClick={back}><ChevronLeft className="w-4 h-4" aria-hidden="true" /> Back to my seat</button>
          </div>
        </section>
      )}

      <p className="tl-v3-hint">{hint}</p>
      <p className="tl-sr" aria-live="polite" ref={liveRef} />
    </div>
  );
}
