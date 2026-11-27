import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AlertTriangle, Box, CheckCircle2, Pause, Play, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { DashCard } from '../dash/DashShell';
import { buildScene } from '../venue/Venue3D';
import { venue3dKind } from '../venue/venue3dKind';
import './gateLoadPlan.css';
import { ruleNote } from '../../lib/crowdFlow';

/*
 * Crowd flow in 3D (gate supervisors). The venue's own 3D model, each seat coloured by how loaded ITS gate is
 * (the gate the plan sends that section / those rows to) in the chosen 5-minute slot before or after the start.
 * Source: the rule estimate, the shadow AI model (when shown to this viewer) or what was actually scanned.
 * Read-only: nothing here changes a gate, admission or staffing.
 */
const BUSY = 0.85; // services/gateLoadPlan.js
const STATUS = {
  OK: { color: '#0aac23', label: 'OK', icon: CheckCircle2 },
  BUSY: { color: '#fbb315', label: `Busy (over ${Math.round(BUSY * 100)}%)`, icon: AlertTriangle },
  OVER: { color: '#dc3c3d', label: 'Over capacity', icon: XCircle },
  NONE: { color: '#c9d3cc', label: 'No gate / no estimate', icon: null },
};
const statusOf = (u) => (u == null ? 'NONE' : u > 1 ? 'OVER' : u > BUSY ? 'BUSY' : 'OK');
const slotText = (m) => (m === 0 ? 'at the start' : m < 0 ? `${-m} min before the start` : `${m} min after the start`);

// `given`: the crowd insight already loaded by the page (CrowdFlowSection), so the 3D view and the chart use the
// same numbers; undefined = this component loads it itself
function useCrowdData(eventId, given) {
  const [d, setD] = useState({ state: 'loading' });
  const own = given === undefined;
  useEffect(() => {
    let live = true;
    Promise.allSettled([
      api.get(`/venues/event/${eventId}`),
      api.get(`/checkin/manage/events/${eventId}/gate-plan`),
      own ? api.get(`/ml/insights/events/${eventId}/crowd`) : Promise.resolve({ data: { data: given } }),
    ]).then(([venue, plan, crowd]) => {
      if (!live) return;
      // GET /venues/event/:id answers { event, layout: { id, version, data } }: the plan itself is layout.data
      // (as VenueBooking reads it)
      if (venue.status !== 'fulfilled') return setD({ state: 'failed', message: venue.reason?.response?.data?.message });
      const layout = venue.value.data.data?.layout?.data || null;
      const p = plan.status === 'fulfilled' ? plan.value.data.data : null;
      const c = crowd.status === 'fulfilled' ? crowd.value.data.data : null;
      if (!layout?.sections?.length) return setD({ state: 'no-layout' });
      if (!p?.ready) return setD({ state: 'no-plan', message: p?.message });
      if (!c?.enabled || !c.rules?.gates?.length) return setD({ state: 'no-estimate' });
      return setD({ state: 'ok', layout, plan: p, crowd: c });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, own ? null : given]);
  return d;
}

/**
 * slot / onSlot and source / onSource: optional. When the page passes them (CrowdFlowSection), the chart and this
 * view share one selection; otherwise this view keeps its own.
 */
export default function CrowdHall3D({ eventId, crowd: crowdGiven, slot: slotProp, onSlot, source: sourceProp, onSource }) {
  const data = useCrowdData(eventId, crowdGiven);
  const hostRef = useRef(null);
  const ctxRef = useRef(null);
  const [slotOwn, setSlotOwn] = useState(null);
  const [sourceOwn, setSourceOwn] = useState('rule');
  const controlled = slotProp !== undefined && typeof onSlot === 'function';
  const slot = controlled ? slotProp : slotOwn;
  const setSlot = controlled ? onSlot : setSlotOwn;
  const source = sourceProp !== undefined && typeof onSource === 'function' ? sourceProp : sourceOwn;
  const setSource = sourceProp !== undefined && typeof onSource === 'function' ? onSource : setSourceOwn;
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState(null);

  const gates = useMemo(() => data.crowd?.rules?.gates || [], [data]);
  const slots = useMemo(() => gates[0]?.slots.map((s) => s.minutes) || [], [gates]);
  const modelShown = Boolean(data.crowd && !data.crowd.experimental?.hidden && gates.some((g) => g.slots.some((s) => s.model !== null)));
  const actualShown = gates.some((g) => g.slots.some((s) => s.actual !== null));
  // Capacity per hour: from the crowd data itself (same numbers as the chart), else the gate plan
  const capacity = useMemo(() => {
    const m = new Map((data.plan?.balanced || []).map((g) => [g.gateId, g.capacityPerHour]));
    for (const g of gates) if (g.capacity_per_hour != null) m.set(g.gate_id, g.capacity_per_hour);
    return m;
  }, [data.plan, gates]);
  // Default slot: the rule's busiest slot over all gates
  useEffect(() => {
    if (controlled || !gates.length || slot !== null) return;
    const total = slots.map((_, i) => gates.reduce((a, g) => a + (g.slots[i]?.rule || 0), 0));
    setSlot(slots[total.indexOf(Math.max(...total))] ?? slots[0]);
  }, [gates, slots, slot, controlled]);

  // Load per gate in the slot: scans per 5 min × 12 = per hour, over the gate's capacity per hour
  const loads = useMemo(() => {
    const out = new Map();
    for (const g of gates) {
      const s = g.slots.find((x) => x.minutes === slot);
      const v = s ? s[source] : null;
      const cap = capacity.get(g.gate_id);
      // AI source only: its 80% range and the calibrated chance of going over capacity in this slot
      const ai = source === 'model' && s ? { low: s.model_low, high: s.model_high, pOver: s.model_p_over } : {};
      out.set(g.gate_id, { name: g.gate, scans: v, perHour: v == null ? null : v * 12, capacity: cap, utilisation: v == null || !cap ? null : (v * 12) / cap, ...ai });
    }
    return out;
  }, [gates, slot, source, capacity]);

  // Which gate each seat uses: plan.sections (tier, section name, rows) -> gate
  const gateOfSeat = useMemo(() => {
    const m = new Map();
    for (const s of data.plan?.sections || []) {
      if (!s.rowList) m.set(`${s.tierId}|${s.section}|*`, s.gateId);
      else for (const r of s.rowList) m.set(`${s.tierId}|${s.section}|${r}`, s.gateId);
    }
    return (sec, row) => m.get(`${sec.tierId}|${sec.name.trim()}|${row}`) || m.get(`${sec.tierId}|${sec.name.trim()}|*`) || null;
  }, [data.plan]);

  // Build the scene once per layout
  useEffect(() => {
    const host = hostRef.current;
    if (data.state !== 'ok' || !host) return undefined;
    let ctx;
    // Full detail (sharp when zoomed: anti-aliasing and the screen's pixel density)
    try { ctx = buildScene(host, data.layout, { kind: venue3dKind(data.layout) || 'stadium', low: false }); } catch (e) { console.error('[CrowdHall3D]', e); return undefined; }
    ctxRef.current = ctx;
    const { renderer, scene, camera, controls, R, sections, terraces } = ctx;
    // Seats (and standing areas) as flat, unlit colour: the load colours stay exact in any light, at any angle and
    // after the film-style tone mapping, which otherwise washes green / amber / red out
    for (const entry of sections.values()) {
      if (entry.mesh) { entry.mesh.material.dispose(); entry.mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); }
      else { entry.terrace.material.dispose(); entry.terrace.material = new THREE.MeshBasicMaterial({ color: 0xc9d3cc, toneMapped: false }); }
    }
    const size = () => { const w = host.clientWidth || 800, h = host.clientHeight || 420; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);
    const pose = ctx.overviewPose ? ctx.overviewPose(camera.aspect < 1) : { pos: new THREE.Vector3(0, R * 1.35, R * 1.15), target: new THREE.Vector3(0, 0, R * 0.04) };
    camera.position.copy(pose.pos); controls.target.copy(pose.target); controls.update();
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), canvas = renderer.domElement;
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(terraces, false)[0];
      const entry = hit && sections.get(hit.object.userData.sectionId);
      setHover(entry ? { sec: entry.sec, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', () => setHover(null));
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); canvas.removeEventListener('pointermove', onMove);
      scene.traverse((o) => { o.geometry?.dispose?.(); const mm = o.material; (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); ctxRef.current = null;
    };
  }, [data]);

  // Paint the seats for the chosen slot and source
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const c = new THREE.Color();
    for (const entry of ctx.sections.values()) {
      if (entry.mesh) {
        for (const s of entry.seats) {
          const g = gateOfSeat(entry.sec, s.row);
          c.set(STATUS[statusOf(g ? loads.get(g)?.utilisation : null)].color);
          entry.mesh.setColorAt(s.idx, c);
        }
        entry.mesh.instanceColor.needsUpdate = true;
      } else {
        const g = gateOfSeat(entry.sec, '*');
        entry.terrace.material.color.set(STATUS[statusOf(g ? loads.get(g)?.utilisation : null)].color);
      }
    }
  }, [loads, gateOfSeat, data]);

  // Play: step through the slots
  useEffect(() => {
    if (!playing || !slots.length) return undefined;
    const t = setInterval(() => setSlot(slots[(slots.indexOf(slotRef.current) + 1) % slots.length]), 700);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, slots]);

  if (data.state === 'loading') return null;
  if (data.state !== 'ok') {
    const text = { failed: `The seat plan could not be loaded${data.message ? `: ${data.message}` : ''}.`, 'no-layout': 'This event has no seat plan, so there is no 3D view.', 'no-plan': data.message || 'The gate plan is not ready yet (gates need a capacity per hour).', 'no-estimate': 'No crowd estimate yet: it appears from 26 hours before the start.' }[data.state];
    return <DashCard title="Crowd flow in 3D" icon={Box}><p className="text-sm text-slate-500">{text}</p></DashCard>;
  }
  const hoverGate = hover && gateOfSeat(hover.sec, '*');
  const hoverRows = hover && (data.plan.sections || []).filter((s) => s.tierId === hover.sec.tierId && s.section === hover.sec.name.trim());
  return (
    <DashCard title="Crowd flow in 3D" icon={Box} sub="Each seat takes the colour of its gate's load in the chosen 5-minute slot. Drag to turn the venue.">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="tl-ch3-seg" role="radiogroup" aria-label="Source">
          {[['rule', 'Rule estimate', true], ['model', 'AI model (shadow)', modelShown], ['actual', 'Actually scanned', actualShown]].filter((x) => x[2]).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={source === k} onClick={() => setSource(k)}>{label}</button>
          ))}
        </div>
        <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play through the slots'}>{playing ? <Pause className="w-3.5 h-3.5 inline" /> : <Play className="w-3.5 h-3.5 inline" />} {playing ? 'Pause' : 'Play'}</button>
        <label className="flex items-center gap-2 text-sm grow" style={{ minWidth: 220 }}>
          <span className="whitespace-nowrap">{slotText(slot)}</span>
          <input type="range" className="grow" min={0} max={Math.max(0, slots.length - 1)} value={Math.max(0, slots.indexOf(slot))} onChange={(e) => { setPlaying(false); setSlot(slots[Number(e.target.value)]); }} aria-label="Time slot" />
        </label>
      </div>
      {source === 'rule' && <p className="tl-cf-note" style={{ marginTop: 0 }}>{ruleNote(data.crowd)} Switch to &quot;AI model (shadow)&quot; to see gates differ.</p>}
      <div style={{ position: 'relative' }}>
        <div ref={hostRef} className="tl-ch3-host" />
        {hover && (
          <div className="tl-ch3-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <b>{hover.sec.name}</b>
            {hoverRows.length > 1
              ? hoverRows.map((r) => { const l = loads.get(r.gateId); return <span key={r.rows}>Rows {r.rows} → {r.gateName}: {l?.utilisation == null ? '—' : `${Math.round(l.utilisation * 100)}%`}</span>; })
              : hoverGate ? (() => { const l = loads.get(hoverGate); return <><span>{l?.name}: {l?.scans == null ? 'no estimate' : `${Math.round(l.scans)} scans in 5 min · ${Math.round(l.utilisation * 100)}% of capacity${l.pOver != null ? ` · ${Math.round(l.pOver * 100)}% chance of going over` : ''}`}</span>{source === 'rule' && l?.scans != null && <span className="tl-ch3-tip-note">Rule: the same % at every gate (shared by capacity)</span>}</>; })() : <span>No gate assigned in the plan</span>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-slate-600 mt-2">
        {Object.values(STATUS).map((s) => <span key={s.label} className="inline-flex items-center gap-1"><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: s.color }} />{s.icon && <s.icon className="w-3 h-3" aria-hidden="true" />}{s.label}</span>)}
      </div>
      <table className="tl-dash-table mt-3">
        <thead><tr><th>Gate</th><th>Scans in this slot</th><th>Per hour</th><th>Capacity / hour</th><th>Load</th>{source === 'model' && <th>Chance over capacity</th>}</tr></thead>
        <tbody>{[...loads.entries()].map(([id, l]) => { const st = STATUS[statusOf(l.utilisation)]; return (
          <tr key={id}><td><strong>{l.name}</strong></td><td>{l.scans == null ? '—' : Math.round(l.scans)}</td><td>{l.perHour == null ? '—' : Math.round(l.perHour)}</td><td>{l.capacity ?? '—'}</td>
            <td><span className="inline-flex items-center gap-1">{st.icon && <st.icon className="w-3.5 h-3.5" style={{ color: st.color }} aria-hidden="true" />}{l.utilisation == null ? '—' : `${Math.round(l.utilisation * 100)}%`} · {st.label}</span></td>
            {source === 'model' && <td>{l.pOver == null ? '—' : <><b>{Math.round(l.pOver * 100)}%</b>{Number.isFinite(l.low) && <div className="text-xs text-slate-500">range {Math.round(l.low)}–{Math.round(l.high)} scans</div>}</>}</td>}</tr>
        ); })}</tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">{source === 'model' ? 'Shadow AI model: an experiment beside the rule. ' : ''}The gate scanners, admission and staffing never use these numbers.</p>
    </DashCard>
  );
}
