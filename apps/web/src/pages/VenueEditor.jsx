import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Circle, Eye, FolderOpen, ImagePlus, LayoutTemplate, Maximize2, Minus,
  MousePointer2, PenTool, Plus, Redo2, RefreshCw, Save, Send, Square, Table2, Trash2, Undo2, Users, X,
} from 'lucide-react';
import api from '../utils/api';
import { TEMPLATES, assignTiers, buildTemplate, layoutInventory, newSectionId, round, validateLayout } from '@venue-core';
import VenueMap from '../components/venue/VenueMap';
import VenueBooking from '../components/venue/VenueBooking';
import { previewAdapter } from '../components/venue/adapters';
import EditorOverlay from '../components/venue/editor/EditorOverlay';
import SectionInspector from '../components/venue/editor/SectionInspector';
import MiniPlan from '../components/venue/editor/MiniPlan';
import { ConfirmDialog, NumberField, SelectField, TextField } from '../components/venue/editor/fields';
import { formatPkr, generated, tierPalette } from '../components/venue/venueTheme';
import { ACCEPT_ATTR, readImageSize } from '../utils/eventImageSpecs';
import '../components/venue/venue.css';

const PLAN = { recommended: [3000, 2000], min: [1000, 600], maxBytes: 10 * 1024 * 1024 };
const PLAN_HELP = 'Recommended: 3000 × 2000 px · Ratio: any (kept as uploaded) · Maximum: 10 MB · Formats: JPG, PNG, WebP';
const FEATURE_KINDS = [
  { value: 'none', label: 'None' },
  { value: 'stage', label: 'Stage' },
  { value: 'screen', label: 'Stage & screen' },
  { value: 'cricket', label: 'Cricket ground' },
  { value: 'football', label: 'Football pitch' },
  { value: 'hockey', label: 'Hockey pitch' },
  { value: 'court', label: 'Court' },
  { value: 'ring', label: 'Ring' },
];
const json = (v) => JSON.stringify(v ?? null);

function Banner({ tone = 'info', icon: Icon = AlertCircle, children, onClose }) {
  const tones = {
    info: 'bg-slate-50 border-slate-200 text-slate-700',
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-rose-50 border-rose-200 text-rose-800',
  };
  return (
    <div className={`p-3.5 rounded-2xl border text-xs flex gap-2.5 ${tones[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
      <div className="flex-1 space-y-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-current opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** Template, saved-layout and plan-upload choices (start screen and "Change plan"). */
function PlanSources({ suggested, onTemplate, onReuse, onUpload, uploading }) {
  const thumbs = useMemo(() => Object.keys(TEMPLATES).map((key) => ({ key, layout: buildTemplate(key) })), []);
  const fileRef = useRef(null);
  const ordered = [...thumbs].sort((a, b) => (a.key === suggested ? -1 : b.key === suggested ? 1 : 0));
  return (
    <div className="space-y-4 text-xs">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ordered.map(({ key, layout }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTemplate(key)}
            className={`text-left rounded-2xl border p-2.5 bg-white hover:border-emerald-300 hover:shadow-sm transition ${key === suggested ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'}`}
          >
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-slate-50">
              <MiniPlan layout={layout} />
            </div>
            <div className="mt-2 font-bold text-slate-900 flex items-center gap-1.5">
              {TEMPLATES[key].label}
              {key === suggested && <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-1.5">Suggested</span>}
            </div>
            <div className="text-[10px] text-slate-500 leading-snug">{TEMPLATES[key].description}</div>
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <button type="button" onClick={onReuse} className="p-3 rounded-2xl border border-slate-200 bg-white hover:border-emerald-300 text-left flex gap-3 items-start">
          <FolderOpen className="w-5 h-5 text-[#16a34a] shrink-0" aria-hidden="true" />
          <span>
            <span className="block font-bold text-slate-900">Reuse a saved layout</span>
            <span className="block text-[10px] text-slate-500">Start from a plan you published for another event at the same venue.</span>
          </span>
        </button>
        <div className="p-3 rounded-2xl border border-slate-200 bg-white flex gap-3 items-start">
          <ImagePlus className="w-5 h-5 text-[#16a34a] shrink-0" aria-hidden="true" />
          <div className="space-y-1.5">
            <span className="block font-bold text-slate-900">Upload your venue plan</span>
            <span className="block text-[10px] text-slate-700 font-medium">{PLAN_HELP}</span>
            <span className="block text-[10px] text-slate-500">Minimum 1000 × 600 px. The image is only a backdrop: you draw the sections over it, and only those sections and their configured seats are sold.</span>
            <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f); }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="px-3 py-1.5 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white font-semibold disabled:opacity-60">
              {uploading ? 'Uploading…' : 'Choose plan image'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VenueEditor() {
  const { id: eventId } = useParams();
  const [params] = useSearchParams();
  const setup = params.get('setup') === '1';
  const mapRef = useRef(null);

  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [layout, setLayout] = useState(null);
  const [savedJson, setSavedJson] = useState(json(null));
  const [selectedId, setSelectedId] = useState(null);
  const [featureSelected, setFeatureSelected] = useState(false);
  const [tool, setTool] = useState('select'); // select | draw | block
  const [drawPoints, setDrawPoints] = useState([]);
  const [zoomPx, setZoomPx] = useState(1);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [reuse, setReuse] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [check, setCheck] = useState(null);
  const history = useRef({ past: [], future: [] });
  const coalesce = useRef({ key: null, t: 0 });
  const dragBase = useRef(null);
  const suppressClick = useRef(false);
  const [, bump] = useState(0);

  // ---------- Load ----------
  const applyPayload = useCallback((p, { keepLayout = false } = {}) => {
    setPayload(p);
    if (!keepLayout) {
      const start = p.draft?.data || p.published?.data || null;
      setLayout(start);
      setSavedJson(json(p.draft?.data || p.published?.data || null));
      history.current = { past: [], future: [] };
    }
  }, []);
  const load = useCallback(async () => {
    try {
      const res = await api.get(`/venues/event/${eventId}/editor`);
      applyPayload(res.data.data);
    } catch (err) {
      setLoadError(err.response?.data?.message || 'Could not load the venue editor.');
    }
  }, [eventId, applyPayload]);
  useEffect(() => {
    load();
  }, [load]);

  const tiers = useMemo(() => payload?.tiers || [], [payload]);
  const palette = useMemo(() => tierPalette(tiers), [tiers]);
  const tierList = useMemo(() => Object.values(palette), [palette]);
  const dirty = json(layout) !== savedJson;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---------- Editing with undo ----------
  const update = useCallback((next, key) => {
    setLayout((cur) => {
      const now = Date.now();
      const same = key && coalesce.current.key === key && now - coalesce.current.t < 900;
      if (!same && cur) {
        history.current.past.push(cur);
        if (history.current.past.length > 60) history.current.past.shift();
        history.current.future = [];
      }
      coalesce.current = { key, t: now };
      return typeof next === 'function' ? next(cur) : next;
    });
    bump((n) => n + 1);
  }, []);
  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(layout);
    setLayout(prev);
    coalesce.current = { key: null, t: 0 };
    bump((n) => n + 1);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(layout);
    setLayout(next);
    coalesce.current = { key: null, t: 0 };
    bump((n) => n + 1);
  };
  const updateSection = (section, key) => update((cur) => ({ ...cur, sections: cur.sections.map((s) => (s.id === section.id ? section : s)) }), key ? `${section.id}:${key}` : null);

  // Drags: live updates without history, one undo step when the drag ends
  const liveShape = (shape) => {
    if (!dragBase.current) dragBase.current = layout;
    setLayout((cur) => ({ ...cur, sections: cur.sections.map((s) => (s.id === selectedId ? { ...s, shape } : s)) }));
  };
  const liveFeature = (feature) => {
    if (!dragBase.current) dragBase.current = layout;
    setLayout((cur) => ({ ...cur, feature }));
  };
  const commitDrag = () => {
    suppressClick.current = true;
    if (dragBase.current) {
      history.current.past.push(dragBase.current);
      history.current.future = [];
      dragBase.current = null;
      bump((n) => n + 1);
    }
  };

  // ---------- Validation (debounced) ----------
  const published = payload?.published;
  const protectedList = useMemo(() => payload?.protected || [], [payload]);
  const publishedTierByKey = useMemo(() => {
    if (!published || !protectedList.length) return null;
    return new Map(layoutInventory(published.data).map((s) => [s.key, s.tierId]));
  }, [published, protectedList]);
  useEffect(() => {
    if (!layout) return undefined;
    const t = setTimeout(() => {
      const result = validateLayout(layout, { tierIds: tiers.map((x) => x.id), requireTiers: true });
      // Seats that are held or booked must survive this edit unchanged
      const conflicts = [];
      if (protectedList.length) {
        const inv = new Map(layoutInventory(layout).map((s) => [s.key, s]));
        for (const p of protectedList) {
          const now = inv.get(p.key);
          const [sid, row, num] = p.key.split('/');
          const name = layout.sections.find((s) => s.id === sid)?.name || 'A removed section';
          if (!now) conflicts.push({ sectionId: sid, message: `${name} · ${row} · ${num} is ${p.state} but is no longer in the plan.` });
          else if (now.blocked || (publishedTierByKey && publishedTierByKey.get(p.key) !== now.tierId)) conflicts.push({ sectionId: sid, message: `${name} · ${row} · ${num} is ${p.state}; its tier and availability can't change.` });
        }
      }
      setCheck({ ...result, conflicts });
    }, 180);
    return () => clearTimeout(t);
  }, [layout, tiers, protectedList, publishedTierByKey]);

  const issuesBySection = useMemo(() => {
    const m = {};
    for (const e of check?.errors || []) if (e.sectionId) (m[e.sectionId] ||= []).push({ level: 'error', message: e.message.replace(/^“[^”]*”: /, '') });
    for (const w of check?.warnings || []) if (w.sectionId) (m[w.sectionId] ||= []).push({ level: 'warning', message: w.message.replace(/^“[^”]*”: /, '') });
    for (const c of check?.conflicts || []) if (c.sectionId) (m[c.sectionId] ||= []).push({ level: 'error', message: c.message });
    return m;
  }, [check]);
  const protectedBySection = useMemo(() => {
    const m = {};
    for (const p of protectedList) {
      const sid = p.key.split('/')[0];
      m[sid] = (m[sid] || 0) + 1;
    }
    return m;
  }, [protectedList]);

  const selected = layout?.sections.find((s) => s.id === selectedId) || null;
  const seatStates = useMemo(() => {
    if (!selected) return null;
    const out = {};
    for (const p of protectedList) if (p.key.startsWith(`${selected.id}/`)) out[p.key] = 'protected';
    return out;
  }, [selected, protectedList]);

  // ---------- Plan sources ----------
  const replaceLayout = (next, what) => {
    const apply = () => {
      update(next);
      setSelectedId(null);
      setFeatureSelected(false);
      setTool('select');
      setShowSources(false);
      setConfirm(null);
      setStatus({ tone: 'ok', text: `${what} loaded. Configure the sections, then save or publish.` });
      requestAnimationFrame(() => mapRef.current?.fitAll({ instant: true }));
    };
    if (layout?.sections?.length) {
      setConfirm({
        title: 'Replace the current layout?',
        body: (
          <>
            <p>This replaces the {layout.sections.length} section{layout.sections.length === 1 ? '' : 's'} you have configured in this draft with {what.toLowerCase()}.</p>
            <p>The published plan stays live until you publish again, and you can undo this.</p>
          </>
        ),
        confirmLabel: 'Replace layout',
        tone: 'danger',
        onConfirm: apply,
      });
    } else apply();
  };
  const chooseTemplate = (key) => replaceLayout(buildTemplate(key, { tiers }), `The ${TEMPLATES[key].label} template`);

  const openReuse = async () => {
    try {
      const res = await api.get(`/venues/event/${eventId}/reusable`);
      setReuse(res.data.data.layouts);
    } catch (err) {
      setStatus({ tone: 'error', text: err.response?.data?.message || 'Could not load saved layouts.' });
    }
  };
  const chooseReuse = (item) => {
    const valid = new Set(tiers.map((t) => t.id));
    const data = assignTiers({ ...item.data, sections: item.data.sections.map((s) => ({ ...s, tierId: valid.has(s.tierId) ? s.tierId : null })) }, tiers);
    setReuse(null);
    replaceLayout(data, `The layout from “${item.event.name}”`);
    setStatus({ tone: 'warn', text: 'Saved layout loaded. Pricing tiers were matched automatically. Check each section’s tier before publishing.' });
  };

  const uploadPlan = async (file) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setStatus({ tone: 'error', text: 'Plan images must be JPG, PNG or WebP.' });
    if (file.size > PLAN.maxBytes) return setStatus({ tone: 'error', text: 'Plan images can be at most 10 MB.' });
    let size;
    try {
      size = await readImageSize(file);
    } catch {
      return setStatus({ tone: 'error', text: 'That file could not be read as an image.' });
    }
    if (Math.max(size.width, size.height) < PLAN.min[0] || Math.min(size.width, size.height) < PLAN.min[1]) {
      return setStatus({ tone: 'error', text: `${size.width} × ${size.height} px is too small. Use at least 1000 × 600 px.` });
    }
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('plan', file);
      const res = await api.post(`/venues/event/${eventId}/plan-image`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { url, width, height } = res.data.data;
      const base = layout || buildTemplate('custom');
      update({ ...base, background: { url, width, height, opacity: 0.9 }, coordinate: { width: 1000, height: round((1000 * height) / width, 0) }, feature: layout ? base.feature : { kind: 'none' } });
      setShowSources(false);
      setStatus({ tone: 'ok', text: 'Plan uploaded. Draw sections over it with “Draw shape” or add blocks, then set their seats and tiers.' });
      requestAnimationFrame(() => mapRef.current?.fitAll({ instant: true }));
    } catch (err) {
      setStatus({ tone: 'error', text: err.response?.data?.message || 'Upload failed.' });
    } finally {
      setBusy('');
    }
  };

  // ---------- Adding sections ----------
  const uniqueName = (base) => {
    const names = new Set((layout?.sections || []).map((s) => s.name.toLowerCase()));
    let n = (layout?.sections?.length || 0) + 1;
    while (names.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  };
  const addSection = (kind) => {
    const c = layout.coordinate;
    const f = layout.feature && layout.feature.kind !== 'none' ? layout.feature : null;
    const cx = f ? f.x : c.width / 2;
    const cy = f ? f.y : c.height / 2;
    const id = newSectionId();
    const offset = ((layout.sections.length % 5) - 2) * 18;
    let section;
    if (kind === 'arc') {
      const r0 = f ? Math.max(f.w, f.h) / 2 + 30 : 140;
      section = { id, name: uniqueName('Curved section'), booking: 'seats', shape: { type: 'arc', cx, cy, r0, r1: r0 + 110, a0: 70, a1: 110 }, rows: { count: 8, seatsPerRow: 20, rowSpacing: 10, seatSpacing: 8 } };
    } else if (kind === 'ga') {
      section = { id, name: uniqueName('Standing zone'), booking: 'ga', shape: { type: 'rect', x: c.width / 2 + offset, y: c.height * 0.7, w: 220, h: 120, rotation: 0 }, ga: { capacity: 300 } };
    } else if (kind === 'tables') {
      section = { id, name: uniqueName('Tables'), booking: 'tables', shape: { type: 'rect', x: c.width / 2 + offset, y: c.height * 0.65, w: 260, h: 170, rotation: 0 }, tables: { count: 6, seatsPerTable: 6, columns: 3, mode: 'whole', seatSpacing: 8, spacing: 70 } };
    } else {
      section = { id, name: uniqueName('Block'), booking: 'seats', shape: { type: 'rect', x: c.width / 2 + offset, y: c.height * 0.6 + offset, w: 200, h: 120, rotation: 0 }, rows: { count: 8, seatsPerRow: 18, rowSpacing: 10, seatSpacing: 8 } };
    }
    update((cur) => ({ ...cur, sections: [...cur.sections, { ...section, tierId: null }] }));
    setSelectedId(id);
    setFeatureSelected(false);
    setTool('select');
  };
  const finishDrawing = (points = drawPoints) => {
    if (points.length < 3) return;
    const id = newSectionId();
    update((cur) => ({
      ...cur,
      sections: [...cur.sections, { id, name: uniqueName('Section'), booking: 'seats', tierId: null, shape: { type: 'polygon', points: points.map(([x, y]) => [round(x), round(y)]), facing: 0 }, rows: { count: 6, seatsPerRow: 10, rowSpacing: 10, seatSpacing: 8 } }],
    }));
    setDrawPoints([]);
    setTool('select');
    setSelectedId(id);
    setStatus({ tone: 'info', text: 'Shape added. Set which way its rows face, then fit seats to rows.' });
  };
  useEffect(() => {
    if (tool !== 'draw') return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter') finishDrawing();
      if (e.key === 'Escape') {
        setDrawPoints([]);
        setTool('select');
      }
      if (e.key === 'Backspace') setDrawPoints((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleUnits = 7 / (zoomPx || 1);
  const mapClickPoint = (e) => {
    const p = mapRef.current.toSvg(e.clientX, e.clientY);
    if (drawPoints.length >= 3 && Math.hypot(p.x - drawPoints[0][0], p.y - drawPoints[0][1]) < handleUnits * 2) return finishDrawing();
    setDrawPoints((pts) => [...pts, [p.x, p.y]]);
  };

  const toggleBlocked = (key, section) => {
    const seat = generated(section).seats.find((s) => s.key === key);
    if (!seat || seat.tableKey) return;
    if (protectedList.some((p) => p.key === key)) return setStatus({ tone: 'warn', text: `Row ${seat.row}, seat ${seat.number} is held or booked and can't be blocked.` });
    const rows = section.rows || {};
    const id = `${seat.rowIndex}:${seat.position}`;
    const blocked = new Set(rows.blocked || []);
    if (blocked.has(id)) blocked.delete(id);
    else blocked.add(id);
    updateSection({ ...section, rows: { ...rows, blocked: [...blocked] } });
  };

  // ---------- Save / publish ----------
  const saveDraft = async ({ quiet = false } = {}) => {
    setBusy('save');
    try {
      const res = await api.put(`/venues/event/${eventId}/draft`, { data: layout });
      setSavedJson(json(layout));
      setPayload((p) => ({ ...p, draft: { id: res.data.data.draft.id, data: layout, updatedAt: res.data.data.draft.updatedAt } }));
      if (!quiet) setStatus({ tone: 'ok', text: 'Draft saved. Attendees still see the published plan until you publish.' });
      return true;
    } catch (err) {
      setStatus({ tone: 'error', text: err.response?.data?.message || 'Could not save the draft.' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const tierTotals = useMemo(() => {
    if (!check || !layout) return [];
    const by = {};
    for (const s of layout.sections) {
      const g = check.generated.get(s.id);
      if (!g || !s.tierId) continue;
      by[s.tierId] = (by[s.tierId] || 0) + g.stats.sellable;
    }
    return tierList.map((t) => ({ ...t, plan: by[t.id] || 0 }));
  }, [check, layout, tierList]);

  const publish = () => {
    const blocking = (check?.errors?.length || 0) + (check?.conflicts?.length || 0);
    if (blocking) {
      setStatus({ tone: 'error', text: `Fix ${blocking} problem${blocking === 1 ? '' : 's'} before publishing.` });
      return;
    }
    setConfirm({
      title: published ? `Publish version ${published.version + 1}?` : 'Publish this venue plan?',
      body: (
        <>
          <p>Attendees will choose sections and seats from exactly this plan. Seats that are held or booked are kept unchanged.</p>
          <p className="font-semibold text-slate-900">Ticket quantities will be set from the plan:</p>
          <ul className="space-y-0.5">
            {tierTotals.filter((t) => t.plan > 0 || t.totalQuantity > 0).map((t) => (
              <li key={t.id} className="flex justify-between gap-4">
                <span>{t.name} ({formatPkr(t.price)})</span>
                <span className="font-mono">{t.totalQuantity} → <strong>{t.plan}</strong></span>
              </li>
            ))}
          </ul>
          {check.warnings.length > 0 && <p className="text-amber-800">{check.warnings.length} warning{check.warnings.length === 1 ? '' : 's'} (not blocking).</p>}
        </>
      ),
      confirmLabel: 'Publish',
      onConfirm: async () => {
        setConfirm(null);
        if (dirty && !(await saveDraft({ quiet: true }))) return;
        setBusy('publish');
        try {
          const res = await api.post(`/venues/event/${eventId}/publish`);
          applyPayload(res.data.data.editor, { keepLayout: true });
          setSavedJson(json(layout));
          setStatus({ tone: 'ok', text: res.data.message });
        } catch (err) {
          const d = err.response?.data || {};
          const list = d.conflicts || d.errors?.map((e) => e.message) || [];
          setStatus({ tone: 'error', text: d.message || 'Publishing failed.', list: list.slice(0, 12), more: (d.conflictCount || list.length) - 12 });
          if (err.response?.status === 409) load();
        } finally {
          setBusy('');
        }
      },
    });
  };

  const discard = () =>
    setConfirm({
      title: 'Discard unpublished changes?',
      body: <p>The editor goes back to the published plan{published ? ` (version ${published.version})` : ''}. This can’t be undone.</p>,
      confirmLabel: 'Discard changes',
      tone: 'danger',
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/venues/event/${eventId}/draft`);
          await load();
          setStatus({ tone: 'info', text: 'Unpublished changes discarded.' });
        } catch (err) {
          setStatus({ tone: 'error', text: err.response?.data?.message || 'Could not discard the draft.' });
        }
      },
    });

  const addTier = async ({ name, price }) => {
    try {
      const res = await api.post(`/venues/event/${eventId}/tiers`, { name: name.trim(), price: Number(price) });
      const tier = res.data.data.tier;
      setPayload((p) => ({ ...p, tiers: [...p.tiers, tier] }));
      return tier;
    } catch (err) {
      setStatus({ tone: 'error', text: err.response?.data?.message || 'Could not add the tier.' });
      return null;
    }
  };

  // The preview runs on a snapshot of the plan taken when it opens (a stable adapter, no reloads)
  const preview = useMemo(
    () => (previewKey && layout ? previewAdapter({ layout, tiers, event: { ...payload.event, tiers } }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewKey]
  );

  // ---------- Render ----------
  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-rose-200 rounded-3xl text-center space-y-4 shadow-sm">
        <AlertCircle className="w-6 h-6 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Can’t open Venue & Seating</h2>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Link to="/organizer/dashboard" className="btn-eventfrog inline-flex items-center gap-1.5 px-5 py-2.5 text-xs shadow-sm"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500" />
      </div>
    );
  }

  const ev = payload.event;
  const suggested = payload.suggestedTemplate;
  const draftPending = payload.draft && (!published || json(payload.draft.data) !== json(published.data));
  const categoryMismatch = layout && layout.sections.length && layout.template && layout.template !== 'custom' && layout.template !== suggested && layout.categoryAck !== ev.type;
  const errorCount = (check?.errors?.length || 0) + (check?.conflicts?.length || 0);
  const totals = check?.totals;
  const gaCapacity = layout ? layout.sections.filter((s) => s.booking === 'ga').reduce((n, s) => n + (check?.generated.get(s.id)?.stats.positions || 0), 0) : 0;

  const tools = [
    { key: 'select', label: 'Select & move', icon: MousePointer2 },
    { key: 'draw', label: 'Draw shape', icon: PenTool },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-16 text-slate-800">
      {/* Header */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <Link to={`/organizer/events/${eventId}/edit`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#16a34a] transition mb-2">
            <ArrowLeft className="w-4 h-4" /> Event details
          </Link>
          <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6 text-[#16a34a]" aria-hidden="true" /> Venue &amp; Seating
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {ev.name} · {ev.venue}, {ev.city}
          </p>
          <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-bold">
            {published ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">Published v{published.version} · {new Date(published.publishedAt).toLocaleString()}</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Not published yet</span>
            )}
            {dirty ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Unsaved changes</span>
            ) : draftPending ? (
              <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200">Draft saved · not published</span>
            ) : layout ? (
              <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">Up to date</span>
            ) : null}
          </div>
        </div>
        {layout && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="tl-vm-btn" onClick={undo} disabled={!history.current.past.length} aria-label="Undo"><Undo2 className="w-4 h-4" /></button>
            <button type="button" className="tl-vm-btn" onClick={redo} disabled={!history.current.future.length} aria-label="Redo"><Redo2 className="w-4 h-4" /></button>
            {(draftPending || dirty) && published && (
              <button type="button" onClick={discard} className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50">Discard changes</button>
            )}
            <button type="button" onClick={() => setPreviewKey((k) => k + 1)} className="px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-[#16a34a]" /> Attendee preview
            </button>
            <button type="button" onClick={() => saveDraft()} disabled={!dirty || busy} className="px-3 py-2 rounded-xl border border-slate-300 font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={publish} disabled={busy || (!dirty && !draftPending)} className="px-4 py-2 btn-eventfrog text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
              <Send className="w-4 h-4" /> {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        )}
      </div>

      {setup && (
        <Banner tone="info" icon={LayoutTemplate}>
          <p><strong>Step 2 of 2: Venue &amp; Seating.</strong> Your event is created. Choose a plan, set each section’s seats and price tier, then publish it so attendees can pick seats.</p>
          <p><Link to={`/events/${eventId}`} className="font-semibold text-[#16a34a] hover:underline">Skip for now</Link>. Until a plan is published the event shows “Tickets coming soon”.</p>
        </Banner>
      )}
      {payload.legacy?.seats > 0 && (
        <Banner tone={payload.legacy.booked ? 'warn' : 'info'}>
          {payload.legacy.booked
            ? <p>This event already sells {payload.legacy.seats} seats from the earlier seat grid, and {payload.legacy.booked} of them are booked. A venue plan can’t replace a grid that has bookings, so publishing will be refused. Attendees keep the current seat page.</p>
            : <p>This event currently uses the earlier seat grid ({payload.legacy.seats} seats, none booked). Publishing a venue plan replaces that grid.</p>}
        </Banner>
      )}
      {categoryMismatch ? (
        <Banner tone="warn" icon={AlertTriangle}>
          <p>The event’s category now suggests the <strong>{TEMPLATES[suggested]?.label}</strong> template, but this plan was built from <strong>{TEMPLATES[layout.template]?.label || layout.template}</strong>. Nothing has been changed.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 font-semibold" onClick={() => update({ ...layout, categoryAck: ev.type })}>Keep my plan</button>
            <button type="button" className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 font-semibold" onClick={() => chooseTemplate(suggested)}>Use the {TEMPLATES[suggested]?.label} template…</button>
          </div>
        </Banner>
      ) : null}
      {status && (
        <Banner tone={status.tone} icon={status.tone === 'ok' ? CheckCircle2 : AlertCircle} onClose={() => setStatus(null)}>
          <p>{status.text}</p>
          {status.list?.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5">
              {status.list.map((m, i) => <li key={i}>{m}</li>)}
              {status.more > 0 && <li>…and {status.more} more</li>}
            </ul>
          )}
        </Banner>
      )}

      {!layout || showSources ? (
        <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{layout ? 'Change the plan' : 'Choose a starting point'}</h2>
              <p className="text-[11px] text-slate-500">Templates are editable starting points, not certified plans of a real venue. What you configure is exactly what attendees can book.</p>
            </div>
            {layout && <button type="button" onClick={() => setShowSources(false)} className="tl-vm-btn" aria-label="Close"><X className="w-4 h-4" /></button>}
          </div>
          <PlanSources suggested={suggested} onTemplate={chooseTemplate} onReuse={openReuse} onUpload={uploadPlan} uploading={busy === 'upload'} />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Map + tools */}
          <div className="xl:col-span-8 space-y-3">
            <div className="bg-white rounded-3xl p-3 border border-slate-200/90 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Editing tools">
                  {tools.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={tool === t.key}
                      onClick={() => {
                        setTool(t.key);
                        setDrawPoints([]);
                        if (t.key === 'draw') setStatus({ tone: 'info', text: 'Click around the section’s outline on the plan. Click the first point (or press Enter) to finish, Backspace to undo a point, Esc to cancel.' });
                      }}
                      className={`tl-vm-btn ${tool === t.key ? '!bg-[#16a34a] !text-white !border-[#16a34a]' : ''}`}
                    >
                      <t.icon className="w-4 h-4" aria-hidden="true" /> {t.label}
                    </button>
                  ))}
                  <span className="w-px h-6 bg-slate-200 mx-1" aria-hidden="true" />
                  <button type="button" className="tl-vm-btn" onClick={() => addSection('rect')}><Square className="w-4 h-4" aria-hidden="true" /> Block</button>
                  <button type="button" className="tl-vm-btn" onClick={() => addSection('arc')}><Circle className="w-4 h-4" aria-hidden="true" /> Curved</button>
                  <button type="button" className="tl-vm-btn" onClick={() => addSection('ga')}><Users className="w-4 h-4" aria-hidden="true" /> Standing</button>
                  <button type="button" className="tl-vm-btn" onClick={() => addSection('tables')}><Table2 className="w-4 h-4" aria-hidden="true" /> Tables</button>
                </div>
                <button type="button" className="tl-vm-btn" onClick={() => setShowSources(true)}><LayoutTemplate className="w-4 h-4" aria-hidden="true" /> Change plan</button>
              </div>
              {tool === 'draw' && drawPoints.length >= 3 && (
                <div className="flex gap-2 text-xs">
                  <button type="button" className="px-3 py-1.5 btn-eventfrog text-xs" onClick={() => finishDrawing()}>Finish shape ({drawPoints.length} points)</button>
                  <button type="button" className="px-3 py-1.5 rounded-xl border border-slate-200 font-semibold" onClick={() => setDrawPoints([])}>Clear</button>
                </div>
              )}
              <div className="relative" style={{ height: 'clamp(440px, 66vh, 760px)' }}>
                <VenueMap
                  ref={mapRef}
                  layout={layout}
                  tiers={palette}
                  mode={tool === 'block' ? 'blocking' : 'edit'}
                  focusId={selectedId}
                  seatStates={seatStates}
                  sectionMeta={(s) => ({
                    status: issuesBySection[s.id]?.some((i) => i.level === 'error') ? 'issue' : undefined,
                    sub: s.booking === 'ga' ? `Standing · ${generated(s).stats.positions}` : s.booking === 'tables' ? `${generated(s).stats.tables} tables` : `${generated(s).stats.sellable} seats`,
                  })}
                  describeSection={(s) => `${s.name}. Press Enter to select.`}
                  onZoom={setZoomPx}
                  shouldPan={(e) => !e.target.closest('[data-handle]')}
                  onSectionClick={(s, e) => {
                    if (tool === 'draw') return mapClickPoint(e);
                    if (suppressClick.current) return (suppressClick.current = false);
                    if (tool === 'block' && s.id !== selectedId) setTool('select');
                    setSelectedId(s.id);
                    setFeatureSelected(false);
                  }}
                  onSeatClick={(key, section) => (tool === 'block' ? toggleBlocked(key, section) : null)}
                  onBackgroundClick={(e) => {
                    if (tool === 'draw') return mapClickPoint(e);
                    if (suppressClick.current) return (suppressClick.current = false);
                    if (e.target.closest('.tl-vm-feature')) {
                      setSelectedId(null);
                      setFeatureSelected(true);
                      return;
                    }
                    setSelectedId(null);
                    setFeatureSelected(false);
                    if (tool === 'block') setTool('select');
                  }}
                  overlay={(camera) => (
                    <EditorOverlay
                      camera={camera}
                      section={tool === 'select' ? selected : null}
                      feature={layout.feature}
                      featureSelected={featureSelected && tool === 'select'}
                      tool={tool}
                      drawPoints={drawPoints}
                      handlePx={handleUnits}
                      onShape={liveShape}
                      onFeature={liveFeature}
                      onCommit={commitDrag}
                    />
                  )}
                  ariaLabel="Venue plan editor"
                />
                <div className="tl-vm-controls">
                  <button type="button" className="tl-vm-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus className="w-4 h-4" /></button>
                  <button type="button" className="tl-vm-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus className="w-4 h-4" /></button>
                  <button type="button" className="tl-vm-btn" onClick={() => (selected ? mapRef.current?.fitSection(selected.id) : mapRef.current?.fitAll())} aria-label="Fit to view"><Maximize2 className="w-4 h-4" /></button>
                </div>
                <span className="tl-vm-hint hidden md:inline">
                  {tool === 'block' ? 'Click seats to block or unblock them' : tool === 'draw' ? `Drawing: ${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'}` : 'Click a section to configure it · drag to move · Ctrl + scroll to zoom'}
                </span>
              </div>
            </div>

            {/* Totals and problems */}
            <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-sm space-y-3 text-xs">
              {totals && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    ['Total positions', totals.positions],
                    ['Blocked', totals.blocked],
                    ['Sellable', totals.sellable],
                    ['Tables', totals.tables],
                    ['Standing capacity', gaCapacity],
                  ].map(([label, v]) => (
                    <div key={label} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] text-slate-500">{label}</div>
                      <div className={`text-base font-black ${label === 'Sellable' ? 'text-[#16a34a]' : 'text-slate-900'}`}>{Number(v).toLocaleString('en-PK')}</div>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="font-semibold text-slate-700 mb-1">Ticket inventory by tier</p>
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {tierTotals.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} aria-hidden="true" />{t.name} · {formatPkr(t.price)}</span>
                      <span className="font-mono"><strong>{t.plan.toLocaleString('en-PK')}</strong> <span className="text-slate-400">(now {t.totalQuantity})</span></span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-slate-400 mt-1">On publish, each tier’s ticket quantity becomes its seats/places in this plan, so nothing is counted twice.</p>
              </div>
              {errorCount > 0 || check?.warnings?.length ? (
                <details open={errorCount > 0} className="rounded-xl border border-slate-200">
                  <summary className="px-3 py-2 cursor-pointer font-semibold text-slate-700">
                    {errorCount ? `${errorCount} problem${errorCount === 1 ? '' : 's'} to fix before publishing` : 'No blocking problems'}
                    {check?.warnings?.length ? ` · ${check.warnings.length} warning${check.warnings.length === 1 ? '' : 's'}` : ''}
                  </summary>
                  <ul className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
                    {[...(check?.conflicts || []), ...(check?.errors || [])].map((e, i) => (
                      <li key={`e${i}`}>
                        <button type="button" className="text-left text-rose-700 hover:underline" onClick={() => e.sectionId && (setSelectedId(e.sectionId), setFeatureSelected(false), mapRef.current?.fitSection(e.sectionId))}>• {e.message}</button>
                      </li>
                    ))}
                    {(check?.warnings || []).map((w, i) => (
                      <li key={`w${i}`} className="text-amber-800">• {w.message}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                check && <p className="text-emerald-800 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> The plan is ready to publish.</p>
              )}
            </div>
          </div>

          {/* Inspector */}
          <aside className="xl:col-span-4 xl:sticky xl:top-24 bg-white rounded-3xl p-5 border border-slate-200/90 shadow-sm xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto" aria-label="Inspector">
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-900">Section</h2>
                  <button type="button" className="tl-vm-btn" onClick={() => setSelectedId(null)} aria-label="Close section settings"><X className="w-4 h-4" /></button>
                </div>
                <SectionInspector
                  key={selected.id}
                  section={selected}
                  tiers={tierList}
                  onChange={updateSection}
                  onAddTier={addTier}
                  issues={issuesBySection[selected.id] || []}
                  protectedCount={protectedBySection[selected.id] || 0}
                  blocking={tool === 'block'}
                  onToggleBlocking={() => {
                    setTool((t) => (t === 'block' ? 'select' : 'block'));
                    mapRef.current?.fitSection(selected.id);
                  }}
                  onDuplicate={() => {
                    const id = newSectionId();
                    const copy = JSON.parse(JSON.stringify(selected));
                    const shift = (sh) => (sh.type === 'arc' ? { ...sh, a0: sh.a0 + (sh.a1 - sh.a0) + 2, a1: sh.a1 + (sh.a1 - sh.a0) + 2 } : sh.type === 'rect' ? { ...sh, x: sh.x + 30, y: sh.y + 30 } : { ...sh, points: sh.points.map(([x, y]) => [x + 30, y + 30]) });
                    update((cur) => ({ ...cur, sections: [...cur.sections, { ...copy, id, name: uniqueName(selected.name.replace(/\s+\d+$/, '')), shape: shift(copy.shape) }] }));
                    setSelectedId(id);
                  }}
                  onDelete={() =>
                    setConfirm({
                      title: `Remove “${selected.name}”?`,
                      body: <p>{protectedBySection[selected.id] ? 'This section has held or booked seats, so publishing will be refused while it is missing.' : 'You can undo this until you publish.'}</p>,
                      confirmLabel: 'Remove section',
                      tone: 'danger',
                      onConfirm: () => {
                        update((cur) => ({ ...cur, sections: cur.sections.filter((s) => s.id !== selected.id) }));
                        setSelectedId(null);
                        setConfirm(null);
                      },
                    })
                  }
                />
              </>
            ) : (
              <div className="space-y-4 text-xs">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Venue</h2>
                  <p className="text-[11px] text-slate-500">Click a section on the plan to configure it, or select the stage/pitch to move and resize it.</p>
                </div>
                <section className="space-y-2.5">
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Stage or playing area</h3>
                  <SelectField
                    label="Type"
                    value={layout.feature?.kind || 'none'}
                    onChange={(kind) => update({ ...layout, feature: kind === 'none' ? { kind: 'none' } : { x: layout.coordinate.width / 2, y: 90, w: 320, h: 80, rotation: 0, label: FEATURE_KINDS.find((f) => f.value === kind)?.label, ...(layout.feature?.kind !== 'none' ? layout.feature : {}), kind } })}
                    options={FEATURE_KINDS}
                  />
                  {layout.feature && layout.feature.kind !== 'none' && (
                    <>
                      <TextField label="Label" value={layout.feature.label || ''} onChange={(v) => update({ ...layout, feature: { ...layout.feature, label: v } }, 'feature-label')} />
                      <div className="grid grid-cols-3 gap-2">
                        {['x', 'y', 'rotation', 'w', 'h'].map((k) => (
                          <NumberField key={k} label={{ x: 'Centre X', y: 'Centre Y', rotation: 'Rotation °', w: 'Width', h: 'Depth' }[k]} value={layout.feature[k] ?? 0} onChange={(v) => update({ ...layout, feature: { ...layout.feature, [k]: v } }, `feature-${k}`)} />
                        ))}
                      </div>
                      <button type="button" className="text-[11px] font-semibold text-[#16a34a] hover:underline" onClick={() => setFeatureSelected(true)}>Move or resize it on the plan</button>
                    </>
                  )}
                </section>
                <section className="space-y-2.5 pt-3 border-t border-slate-100">
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Uploaded plan</h3>
                  {layout.background ? (
                    <>
                      <p className="text-[11px] text-slate-500">{layout.background.width} × {layout.background.height} px, shown at its original ratio. Sections are positioned relative to it, so they stay aligned at every screen size.</p>
                      <NumberField label="Image opacity" value={layout.background.opacity ?? 0.9} min={0.1} max={1} step={0.05} onChange={(v) => update({ ...layout, background: { ...layout.background, opacity: v } }, 'bg-opacity')} />
                      <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 font-semibold text-rose-700 hover:bg-rose-50" onClick={() => update({ ...layout, background: null })}>
                        <Trash2 className="w-3.5 h-3.5" /> Remove image
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-slate-700 font-medium">{PLAN_HELP}</p>
                      <button type="button" className="tl-vm-btn" onClick={() => setShowSources(true)}><ImagePlus className="w-4 h-4" /> Upload a plan image</button>
                    </>
                  )}
                </section>
                <section className="space-y-1.5 pt-3 border-t border-slate-100">
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Sections ({layout.sections.length})</h3>
                  <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {layout.sections.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => { setSelectedId(s.id); mapRef.current?.fitSection(s.id); }} className="w-full flex items-center justify-between gap-2 py-1.5 text-left hover:text-[#16a34a]">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: palette[s.tierId]?.color || '#cbd5e1' }} aria-hidden="true" />
                            <span className="truncate font-semibold">{s.name}</span>
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {issuesBySection[s.id]?.some((i) => i.level === 'error') && <AlertTriangle className="w-3 h-3 text-rose-500 inline mr-1" aria-label="Has problems" />}
                            {s.booking === 'ga' ? 'Standing' : s.booking === 'tables' ? 'Tables' : 'Seats'} · {generated(s).stats.sellable}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}

      {reuse && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Saved layouts">
          <div className="w-full max-w-3xl bg-white rounded-3xl p-5 shadow-xl space-y-4 text-xs max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Reuse a saved layout</h2>
              <button type="button" className="tl-vm-btn" onClick={() => setReuse(null)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            {reuse.length === 0 ? (
              <p className="text-slate-500">You haven’t published a venue plan for another event yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {reuse.map((l) => (
                  <button key={l.id} type="button" onClick={() => chooseReuse(l)} className="text-left rounded-2xl border border-slate-200 hover:border-emerald-300 p-2.5">
                    <div className="aspect-[4/3] rounded-xl overflow-hidden bg-slate-50"><MiniPlan layout={l.data} /></div>
                    <div className="mt-2 font-bold text-slate-900">{l.event.name}</div>
                    <div className="text-[10px] text-slate-500">{l.event.venue}, {l.event.city} · {l.sections} sections · v{l.version}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {previewKey > 0 && preview && (
        <div className="fixed inset-0 z-[110] bg-slate-100/95 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Attendee preview">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 p-3">
              <p className="text-xs text-slate-700">
                <strong className="text-slate-900">Attendee preview</strong>, using your current changes. Holds here are simulated: nothing is reserved and checkout is disabled.
              </p>
              <button type="button" className="tl-vm-btn" onClick={() => setPreviewKey(0)}><X className="w-4 h-4" /> Close preview</button>
            </div>
            <VenueBooking key={previewKey} adapter={preview} preview eventId={eventId} />
          </div>
        </div>
      )}

      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      {busy === 'publish' && <div className="fixed inset-0 z-[130] bg-white/40 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-[#16a34a] animate-spin" /></div>}
    </div>
  );
}
