import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapePolygon } from '@venue-core';
import { canvasTex } from './scene3dUtils';

/**
 * Indoor hall for the 3D view: theatres, auditoriums and conference rooms (venue3dKind 'hall'). As with the
 * stadium, nothing is hand-made per venue: the stage comes from the plan's feature (position, width, depth) and
 * the room is sized around the organizer's sections. Venue3D builds the seats and keeps all the interaction.
 *
 *   feature.kind 'stage'  → theatre: raised stage, gold proscenium, red velvet curtains, backdrop, footlights
 *   feature.kind 'screen' → conference: low stage, large screen with the event, lectern, panel table, speakers
 */

/** Padded theatre seat: cushion, tall back, an arm on each side. Instance colour = ticket type or seat state. */
export function theatreSeatGeometry(P) {
  return mergeGeometries([
    new THREE.BoxGeometry(0.5, 0.11, 0.44).translate(0, 0.44, 0.05),
    new THREE.BoxGeometry(0.5, 0.64, 0.11).translate(0, 0.8, -0.19),
    new THREE.BoxGeometry(0.5, 0.08, 0.13).translate(0, 1.13, -0.2),
    new THREE.BoxGeometry(0.05, 0.52, 0.44).translate(-0.275, 0.26, 0),
    new THREE.BoxGeometry(0.05, 0.52, 0.44).translate(0.275, 0.26, 0),
  ]).scale(P, P, P);
}

// ─── Textures ───────────────────────────────────────────────────────────────────────────────────────────────
const velvetTex = () => canvasTex(512, 512, (g, w, h) => {
  for (let x = 0; x < w; x++) {
    const f = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 16) ** 2;
    g.fillStyle = `rgb(${Math.round(70 + 105 * f)},${Math.round(6 + 14 * f)},${Math.round(16 + 20 * f)})`;
    g.fillRect(x, 0, 1, h);
  }
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.25, 'rgba(0,0,0,0)'); gr.addColorStop(0.9, 'rgba(0,0,0,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

const planksTex = (tint) => canvasTex(512, 512, (g, w, h) => {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const l = 0.82 + ((i * 37) % 11) / 55;
    g.fillStyle = `rgb(${Math.round(tint[0] * l)},${Math.round(tint[1] * l)},${Math.round(tint[2] * l)})`;
    g.fillRect(0, (i * h) / n, w, h / n);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, (i * h) / n, w, 1.5);
    for (let k = 0; k < 3; k++) { const x = ((i * 131 + k * 197) % w); g.fillRect(x, (i * h) / n, 1.5, h / n); }
  }
  for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${k % 2 ? '255,230,200' : '0,0,0'},0.04)`; g.fillRect(Math.random() * w, Math.random() * h, 6, 1); }
});

const wallTex = () => canvasTex(512, 512, (g, w, h) => {
  // Upper: soft acoustic fabric panels; lower: wood dado with a gold rail
  g.fillStyle = '#3a2a2c'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 128) {
    const gr = g.createLinearGradient(x, 0, x + 128, 0);
    gr.addColorStop(0, '#2d1f22'); gr.addColorStop(0.5, '#4a3437'); gr.addColorStop(1, '#2d1f22');
    g.fillStyle = gr; g.fillRect(x + 6, 10, 116, h * 0.62);
  }
  g.fillStyle = '#5b3b26'; g.fillRect(0, h * 0.68, w, h * 0.32);
  for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, h * 0.68, 2, h * 0.32); }
  g.fillStyle = '#c9a15a'; g.fillRect(0, h * 0.665, w, 7);
});

const wrap = (g, text, maxW) => {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const wd of words) { const t = line ? `${line} ${wd}` : wd; if (g.measureText(t).width > maxW && line) { lines.push(line); line = wd; } else line = t; }
  if (line) lines.push(line);
  return lines.slice(0, 3);
};

/** The event on the conference screen or the theatre backdrop. */
function eventTex(board, theatre) {
  return canvasTex(1600, 900, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    if (theatre) { gr.addColorStop(0, '#0b1533'); gr.addColorStop(1, '#2a0f2c'); } else { gr.addColorStop(0, '#0f4c6e'); gr.addColorStop(0.55, '#0e6e74'); gr.addColorStop(1, '#0a3d4f'); }
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (theatre) { for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(255,240,210,${0.15 + Math.random() * 0.5})`; g.fillRect(Math.random() * w, Math.random() * h * 0.7, 2.5, 2.5); } }
    else {
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; for (let x = 0; x < w + 300; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 300, h); g.stroke(); }
      g.fillStyle = 'rgba(0,237,114,0.9)'; g.fillRect(0, h - 22, w, 22);
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = theatre ? '#e8c77e' : '#00ed72'; g.font = '700 46px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText('TICKETLEDGER', w / 2, 140);
    g.fillStyle = '#ffffff'; g.font = `800 ${theatre ? 118 : 108}px ${theatre ? 'Georgia, serif' : 'system-ui, Segoe UI, Arial, sans-serif'}`;
    const lines = wrap(g, board?.name || (theatre ? 'Tonight' : 'Welcome'), w - 200);
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 - ((lines.length - 1) * 130) / 2 + i * 130));
    g.fillStyle = theatre ? '#f3dfb0' : '#b9e9f2'; g.font = '500 44px system-ui, Segoe UI, Arial, sans-serif';
    g.fillText([board?.venue, board?.when].filter(Boolean).join('  ·  '), w / 2, h - 130, w - 160);
  });
}

const exitTex = () => canvasTex(256, 96, (g, w, h) => { g.fillStyle = '#0b7a3b'; g.fillRect(0, 0, w, h); g.fillStyle = '#eafff1'; g.font = '800 58px system-ui, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', w / 2, h / 2 + 2); });

/** A curtain: a plane with folds pushed in and out. */
function drape(w, h, mat) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * 3)), 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2.6) * 0.32);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ─── Stage ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The stage, built in a group facing the audience (local +z points at the seats). Returns what the shell and
 * the component need: the group, its size, lights for "show lighting" and the glowing materials.
 */
export function buildHallStage(scene, layout, W, S, mats, board) {
  const f = layout.feature;
  const conf = f.kind === 'screen';
  // Which way the audience is: towards the middle of all the sections
  let ax = 0, az = 0;
  for (const s of layout.sections) for (const [x, y] of shapePolygon(s.shape, 8)) { const [wx, , wz] = W(x, y, 0); ax += wx; az += wz; }
  if (Math.hypot(ax, az) < 1e-6) az = 1;
  const yaw = Math.atan2(ax, az);
  const [cx, , cz] = W(f.x, f.y, 0);
  const group = new THREE.Group(); group.position.set(cx, 0, cz); group.rotation.y = yaw; scene.add(group);
  const add = (mesh, x, y, z, { cast = true } = {}) => { mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };

  const fw = Math.max(8, f.w * S), fd = Math.max(4, f.h * S), sh = conf ? 0.9 : 1.5;
  const black = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.8 });
  const deckTop = new THREE.MeshStandardMaterial({ map: planksTex(conf ? [52, 58, 70] : [120, 78, 44]), roughness: 0.55 });
  add(new THREE.Mesh(new THREE.BoxGeometry(fw, sh, fd), [black, black, deckTop, black, black, black]), 0, sh / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(fw + 0.2, 0.22, 0.22), mats.gold), 0, sh - 0.11, fd / 2 + 0.05);
  // Steps up at both front corners
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    const hgt = (sh * (k + 1)) / 3;
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, hgt, 0.6), black), side * (fw / 2 - 1.6), hgt / 2, fd / 2 + 0.3 + (2 - k) * 0.6);
  }

  const glow = []; // materials that glow brighter with show lighting
  const footMat = new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffc977, emissiveIntensity: 0.6 }); glow.push({ mat: footMat, day: 0.6, show: 2.4 });
  const nFoot = Math.max(4, Math.floor(fw / 2.4));
  const foot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.16, 0.22), footMat, nFoot), d = new THREE.Object3D();
  for (let i = 0; i < nFoot; i++) { d.position.set(-fw / 2 + (fw * (i + 0.5)) / nFoot, sh + 0.08, fd / 2 - 0.25); d.updateMatrix(); foot.setMatrixAt(i, d.matrix); }
  group.add(foot);

  let archTop, look = new THREE.Vector3(0, sh + 2.2, 0); // where a seat's view is aimed (stage-local)
  if (!conf) {
    // Proscenium arch, curtains, valance and a backdrop with the event
    const Hs = Math.max(9, fw * 0.4), zP = fd * 0.2;
    for (const side of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(1.8, sh + Hs, 1.6), mats.gold), side * (fw / 2 + 0.9), (sh + Hs) / 2, zP);
    add(new THREE.Mesh(new THREE.BoxGeometry(fw + 3.6, 2.4, 1.6), mats.gold), 0, sh + Hs + 1.2, zP);
    add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.4, 32).rotateX(Math.PI / 2), mats.gold), 0, sh + Hs + 1.2, zP + 0.95); // medallion
    const vel = new THREE.MeshStandardMaterial({ map: velvetTex(), roughness: 0.85, side: THREE.DoubleSide });
    const dw = fw * 0.2;
    for (const side of [-1, 1]) add(drape(dw, Hs, vel), side * (fw / 2 - dw / 2 + 0.1), sh + Hs / 2, zP - 1.0);
    add(drape(fw + 0.4, Hs * 0.17, vel), 0, sh + Hs - Hs * 0.085, zP - 0.9);
    const bdTex = eventTex(board, true);
    const bdMat = new THREE.MeshStandardMaterial({ map: bdTex, emissive: 0xffffff, emissiveMap: bdTex, emissiveIntensity: 0.35, roughness: 0.9 }); glow.push({ mat: bdMat, day: 0.35, show: 0.9 });
    add(new THREE.Mesh(new THREE.PlaneGeometry(fw * 0.94, Hs * 0.92), bdMat), 0, sh + Hs * 0.46, -fd / 2 + 0.3, { cast: false });
    archTop = sh + Hs + 4;
  } else {
    // Big screen, lectern, panel table and speakers
    // A real room's screen: well under the stage width and mounted high, so the presenter stays in view
    const sw = THREE.MathUtils.clamp(fw * 0.42, 10, 24), shh = sw * (9 / 16), y0 = sh + 3.2;
    const scTex = eventTex(board, false);
    const scMat = new THREE.MeshBasicMaterial({ map: scTex, toneMapped: false, color: 0xe6e6e6 }); glow.push({ mat: scMat, basic: true, day: 0.9, show: 1 });
    add(new THREE.Mesh(new THREE.BoxGeometry(sw + 0.7, shh + 0.7, 0.3), black), 0, y0 + shh / 2, -fd / 2 + 0.25);
    add(new THREE.Mesh(new THREE.PlaneGeometry(sw, shh), scMat), 0, y0 + shh / 2, -fd / 2 + 0.42, { cast: false });
    add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.9), mats.wood), fw * 0.33, sh + 1.05, fd * 0.12);
    const logo = new THREE.MeshStandardMaterial({ color: 0x00a651, emissive: 0x00ed72, emissiveIntensity: 0.8 }); glow.push({ mat: logo, day: 0.8, show: 1.6 });
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), logo), fw * 0.33, sh + 1.4, fd * 0.12 + 0.46, { cast: false });
    const tw = Math.min(fw * 0.34, 14);
    const cloth = new THREE.MeshStandardMaterial({ color: 0x14213d, roughness: 0.9 });
    add(new THREE.Mesh(new THREE.BoxGeometry(tw, 0.12, 1.3), mats.wood), -fw * 0.14, sh + 1.3, -fd * 0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(tw, 1.24, 0.06), cloth), -fw * 0.14, sh + 0.66, -fd * 0.02 + 0.66);
    const chairs = Math.max(2, Math.floor(tw / 2.4));
    for (let i = 0; i < chairs; i++) {
      const x = -fw * 0.14 - tw / 2 + (tw * (i + 0.5)) / chairs;
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), black), x, sh + 0.9, -fd * 0.02 - 1.0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.12), black), x, sh + 1.45, -fd * 0.02 - 1.45);
    }
    for (const side of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 4.2, 1.3), black), side * (fw / 2 + 1.6), 2.1, fd * 0.2);
    archTop = y0 + shh + 1.2;
    look = new THREE.Vector3(0, sh + 1.8 + (y0 + shh * 0.4 - sh - 1.8) * 0.45, -fd * 0.15); // between the presenter and the screen
  }

  // Lighting truss in front of the stage with three spotlights on it
  const trussY = archTop + 2.5, trussZ = fd / 2 + Math.max(4, fd * 0.6);
  add(new THREE.Mesh(new THREE.BoxGeometry(fw * 1.05, 0.5, 0.5), mats.metal), 0, trussY, trussZ);
  const spots = [];
  for (const x of [-fw * 0.3, 0, fw * 0.3]) {
    const can = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.1, 14), black), x, trussY - 0.7, trussZ);
    can.rotation.x = 0.7;
    const sp = new THREE.SpotLight(0xffeccc, 0, 0, 0.42, 0.7, 0);
    sp.position.set(x, trussY - 0.9, trussZ); sp.target.position.set(x * 0.5, sh, 0);
    group.add(sp, sp.target); spots.push(sp);
  }
  group.updateMatrixWorld(true);
  return { group, yaw, fw, fd, sh, archTop, spots, glow, conf, seatLook: group.localToWorld(look.clone()) };
}

// ─── Room ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Floor, walls (fabric panels over a wood dado; the back one cut down to a rail), wall lights and exit signs,
 * sized around the stage and every section. Returns the overview camera pose for the component.
 */
export function buildHallShell(scene, stage, sections, mats, R) {
  const { group } = stage;
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  let minX = -stage.fw / 2 - 5, maxX = stage.fw / 2 + 5, maxZ = stage.fd / 2 + 4, top = stage.archTop;
  const v = new THREE.Vector3();
  for (const e of sections.values()) {
    const b = e.box;
    for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
      v.set(x, 0, z).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); maxZ = Math.max(maxZ, v.z);
    }
    top = Math.max(top, e.top);
  }
  const m = 4;
  minX -= m; maxX += m; maxZ += m + 2;
  const minZ = -stage.fd / 2 - 1.5;
  const Hw = Math.max(top + 6, stage.archTop + 3);
  const W = maxX - minX, D = maxZ - minZ, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const add = (mesh, x, y, z, cast = true) => { mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };

  const void_ = new THREE.Mesh(new THREE.CircleGeometry(R * 9, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0808, roughness: 1 }));
  void_.position.y = -0.06; scene.add(void_);
  const floorTex = planksTex([70, 44, 30]); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(W / 10, D / 10);
  add(new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 })), cx, 0.005, cz, false);

  const wall = (len) => { const t = wallTex(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.max(1, len / 9), 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); };
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, Hw, D), wall(D)), minX - 0.4, Hw / 2, cz);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.8, Hw, D), wall(D)), maxX + 0.4, Hw / 2, cz);
  // Back wall cut away to a low rail (as in an architect's model), so the overview looks in over it
  const backH = 3.2;
  add(new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, backH, 0.8), wall(W)), cx, backH / 2, maxZ + 0.4);
  add(new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 0.25, 1.0), mats.gold), cx, backH + 0.12, maxZ + 0.4);
  // Wall behind the stage: the same panelling, a little taller
  add(new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, Hw + 4, 0.8), wall(W)), cx, (Hw + 4) / 2, minZ - 0.4);
  // Ceiling with recessed lights, facing down only: seen from the seats, invisible from the overview above
  // (a one-sided plane is not drawn from behind). It casts no shadow, so the house lights still reach the room.
  const ceilTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a2023'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 26); r.addColorStop(0, '#fff2d6'); r.addColorStop(0.4, 'rgba(255,220,160,0.6)'); r.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping; ceilTex.repeat.set(W / 7, D / 7);
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, emissive: 0xffffff, emissiveMap: ceilTex, emissiveIntensity: 0.25, roughness: 0.9, side: THREE.FrontSide });
  add(new THREE.Mesh(new THREE.PlaneGeometry(W, D + 1).rotateX(Math.PI / 2), ceilMat), cx, Hw + 4, cz - 0.5, false);

  // Wall lights along the side walls and the back wall
  const sconceMat = new THREE.MeshStandardMaterial({ color: 0x3b2a16, emissive: 0xffd9a0, emissiveIntensity: 1.2 });
  const lights = [];
  const step = 9;
  for (let z = minZ + step; z < maxZ - 2; z += step) for (const x of [minX + 0.05, maxX - 0.05]) lights.push([x, z]);
  const sc = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 1.0, 0.35), sconceMat, Math.max(1, lights.length)), d = new THREE.Object3D();
  sc.count = lights.length;
  lights.forEach(([x, z], i) => { d.position.set(x, Hw * 0.58, z); d.updateMatrix(); sc.setMatrixAt(i, d.matrix); });
  group.add(sc);
  // Exit signs over the back corners
  const ex = new THREE.MeshBasicMaterial({ map: exitTex(), toneMapped: false });
  // Exit signs on the side walls near the back
  for (const [x, ry] of [[minX + 0.02, Math.PI / 2], [maxX - 0.02, -Math.PI / 2]]) { const s = add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), ex), x, 5.2, maxZ - 3, false); s.rotation.y = ry; }

  // Overview: from above the back of the room, looking at the stage over the seats
  const local = (x, y, z) => group.localToWorld(new THREE.Vector3(x, y, z));
  const size = Math.max(W, D);
  const overviewPose = (portrait) => {
    const k = portrait ? 1.5 : 1;
    return { pos: local(cx, size * 0.72 * k, maxZ + size * 0.36 * k), target: local(cx, 0, cz - size * 0.06) };
  };
  // A section: seen from the stage side, as the stadium does from the pitch, but never further back than just
  // in front of the stage (the stadium rule would put the camera behind the stage wall for a block facing the
  // stage head-on). What it cannot get by backing away it gets by rising: from above the ceiling is not drawn.
  const front = stage.fd / 2 + 3;
  const sectionPose = (box, portrait) => {
    const c = group.worldToLocal(box.getCenter(new THREE.Vector3())), sz = box.getSize(new THREE.Vector3());
    const D = Math.max(sz.x, sz.z) * (portrait ? 1.25 : 0.85) + 6;
    const dir = new THREE.Vector2(-c.x, -c.z); if (dir.lengthSq() < 1e-6) dir.set(0, -1); dir.normalize();
    let x = c.x + dir.x * D, z = c.z + dir.y * D;
    const short = Math.max(0, front - z);
    if (short) { const k = (c.z - front) / Math.max(1e-6, c.z - z); x = c.x + (x - c.x) * k; z = front; }
    x = THREE.MathUtils.clamp(x, minX + 2, maxX - 2);
    const y = D * 0.42 + sz.y * 0.4 + short * 0.75;
    return { pos: local(x, y, z), target: local(c.x, c.y * 0.8, c.z + short * 0.15) };
  };
  return { overviewPose, sectionPose, glow: [{ mat: sconceMat, day: 1.2, show: 0.5 }, { mat: ceilMat, day: 0.25, show: 0.04 }], height: Hw };
}
