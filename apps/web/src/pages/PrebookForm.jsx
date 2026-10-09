import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Send,
  Settings2,
  Trash2,
} from 'lucide-react';
import api from '../utils/api';
import { StudioHead, Badge } from '../components/dash/Studio';
import CategoryField from '../components/event-form/CategoryField';
import { UploadedGalleryField, UploadedImageField } from '../components/prebook/UploadedImageFields';
import { resolveMediaUrl } from '../utils/eventMedia';
import { useDialog } from '../components/ui/DialogProvider';

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];

const newKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const emptyRow = (venue = '') => ({ key: newKey(), venue, date: '', time: '19:00', endDate: '', endTime: '22:00', customize: false, custom: {} });
const emptyData = () => ({
  shared: { name: '', description: '', type: 'CONFERENCE', customCategoryId: null, city: 'Lahore', contactEmail: '', images: {} },
  rows: [emptyRow()],
});
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const twelveHour = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const pktDate = (iso) =>
  new Date(iso).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
const pktTime = (iso) => new Date(iso).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });

/** Problems with the shared details, same rules as the API (they block every date). */
function sharedProblems(shared) {
  const errs = {};
  if (shared.name.trim().length < 3) errs.name = 'Enter the event name (at least 3 characters).';
  if (shared.description.trim().length < 10) errs.description = 'Add a description (at least 10 characters).';
  if (shared.type === 'OTHER' && !shared.customCategoryId) errs.type = 'Choose a category, or add yours.';
  if (shared.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(shared.contactEmail.trim())) errs.contactEmail = 'Enter a valid email address, or leave it empty.';
  return errs;
}

/** Where a submitted date stands. "Reserved" only once an admin approved it and the slot is secured. */
function eventState(ev) {
  if (!ev) return { tone: 'grey', label: 'Draft · not reserved' };
  if (ev.status === 'PENDING_APPROVAL') return { tone: 'amber', label: 'Requested · awaiting approval', note: 'The slot is held for your request, but it isn’t reserved until an admin approves it.' };
  if (ev.status === 'REJECTED') return { tone: 'rose', label: 'Rejected · not reserved', note: ev.reviewComment ? `Reason: ${ev.reviewComment}` : 'The slot was released.' };
  if (ev.status === 'CANCELLED') return { tone: 'rose', label: 'Cancelled' };
  if (ev.reservedAt) return { tone: 'green', label: 'Reserved' };
  return { tone: 'grey', label: ev.status.replace(/_/g, ' ').toLowerCase() };
}

function Field({ id, label, error, wide, hint, children }) {
  return (
    <div className={`tl-wz-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <p className="tl-wz-hint">{hint}</p>}
      {error && <p className="tl-wz-error"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{error}</p>}
    </div>
  );
}

/**
 * /organizer/prebook/:id: one form to reserve one or more dates. Shared details are entered once; each
 * date has its own venue and schedule and can override the name, images and public visibility. The form
 * autosaves, every unsubmitted date is checked against the venue calendar as it changes, and a clash never
 * throws away what was entered: fix that date, or submit the others and keep it as a draft.
 */
export default function PrebookForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dialog = useDialog();

  const [data, setData] = useState(null);
  const [rowEvents, setRowEvents] = useState({});
  const [loadError, setLoadError] = useState('');
  const [save, setSave] = useState({ state: 'saved', at: null }); // saved | dirty | saving | error
  const [checks, setChecks] = useState({}); // row key -> { ok, field, message, incomplete, checking }
  const [sharedErrors, setSharedErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState(null); // { blocked: [...], ready: [...] } when some dates can't go yet
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busyRow, setBusyRow] = useState('');
  const loaded = useRef(false);
  // Set when data comes from the server, so loading a draft doesn't immediately save it back
  const skipSave = useRef(true);

  // ---------- Load ----------
  const load = useCallback(async () => {
    const res = await api.get(`/prebook/drafts/${id}`);
    const { draft } = res.data.data;
    const saved = draft.data || {};
    setData({
      shared: { ...emptyData().shared, ...(saved.shared || {}), images: saved.shared?.images || {} },
      rows: saved.rows?.length ? saved.rows : [emptyRow()],
    });
    setRowEvents(draft.rowEvents || {});
    setSave({ state: 'saved', at: draft.updatedAt });
    skipSave.current = true;
    loaded.current = true;
  }, [id]);

  useEffect(() => {
    load().catch((err) => setLoadError(err.response?.data?.message || 'Could not load this prebooking.'));
  }, [load]);

  // ---------- Autosave (debounced) ----------
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!data || !loaded.current) return undefined;
    if (skipSave.current) {
      skipSave.current = false;
      return undefined;
    }
    setSave((s) => ({ ...s, state: 'dirty' }));
    const timer = setTimeout(async () => {
      setSave((s) => ({ ...s, state: 'saving' }));
      try {
        const res = await api.put(`/prebook/drafts/${id}`, { data: dataRef.current });
        setSave({ state: 'saved', at: res.data.data.savedAt });
      } catch {
        setSave((s) => ({ ...s, state: 'error' }));
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const warn = (e) => {
      if (save.state === 'dirty' || save.state === 'saving' || save.state === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save.state]);

  // ---------- Live availability for unsubmitted dates ----------
  const openRows = useMemo(() => (data ? data.rows.filter((r) => !rowEvents[r.key]) : []), [data, rowEvents]);
  const checkSig = useMemo(
    () => JSON.stringify({ city: data?.shared.city, rows: openRows.map(({ key, venue, date, time, endDate, endTime }) => [key, venue, date, time, endDate, endTime]) }),
    [data?.shared.city, openRows],
  );
  const checkSeq = useRef(0);
  useEffect(() => {
    if (!data) return undefined;
    const seq = ++checkSeq.current;
    setChecks((prev) => Object.fromEntries(openRows.map((r) => [r.key, { ...(prev[r.key] || {}), checking: true }])));
    const timer = setTimeout(async () => {
      try {
        const labels = Object.fromEntries(data.rows.map((r, i) => [r.key, `Date ${i + 1}`]));
        const res = await api.post('/prebook/check', {
          city: data.shared.city,
          labels,
          rows: openRows.map(({ key, venue, date, time, endDate, endTime }) => ({ key, venue, date, time, endDate, endTime })),
        });
        if (seq !== checkSeq.current) return;
        setChecks(Object.fromEntries(res.data.data.results.map((r) => [r.key, r])));
      } catch {
        if (seq === checkSeq.current) setChecks((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, checking: false, unknown: true }])));
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [checkSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Editing ----------
  const setShared = (patch) => {
    setData((d) => ({ ...d, shared: { ...d.shared, ...patch } }));
    setSharedErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  };
  const setSharedImage = (field, value) => setData((d) => ({ ...d, shared: { ...d.shared, images: { ...d.shared.images, [field]: value } } }));
  const setRow = (key, patch) =>
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // The end date follows the start date until it is changed separately
        if ('date' in patch && (!r.endDate || r.endDate === r.date)) next.endDate = patch.date;
        return next;
      }),
    }));
  const setCustom = (key, patch) =>
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, custom: { ...r.custom, ...patch } } : r)) }));
  const setCustomImage = (key, field, value) =>
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => (r.key === key ? { ...r, custom: { ...r.custom, images: { ...(r.custom?.images || {}), [field]: value } } } : r)),
    }));
  const addRow = () => {
    setData((d) => ({ ...d, rows: [...d.rows, emptyRow(d.rows[d.rows.length - 1]?.venue || '')] }));
    setDecision(null);
  };
  const removeRow = async (key, index) => {
    const ok = await dialog.confirm({ title: `Remove date ${index + 1}?`, message: 'Its venue, times and customizations will be removed from this form.', confirmLabel: 'Remove', tone: 'error' });
    if (!ok) return;
    setData((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));
    setDecision(null);
  };

  const focusRow = (key) => {
    const el = document.getElementById(`row-${key}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el?.querySelector('input')?.focus(), 350);
  };

  // ---------- Submit ----------
  const labelOf = (key) => `Date ${data.rows.findIndex((r) => r.key === key) + 1}`;

  const send = async (rowKeys) => {
    setSubmitting(true);
    setError('');
    setDecision(null);
    try {
      // Make sure the latest edits are saved before the server reads the draft
      await api.put(`/prebook/drafts/${id}`, { data: dataRef.current });
      const res = await api.post(`/prebook/drafts/${id}/submit`, { rowKeys }).catch((err) => {
        if (err.response?.status === 409 && err.response.data?.data) return err.response;
        throw err;
      });
      const { results: rs, draft } = res.data.data;
      setRowEvents(draft.rowEvents || {});
      setResults({ message: res.data.message, items: rs });
      // A clash found on submit (someone booked the slot meanwhile) shows on its date like a live one
      setChecks((prev) => {
        const next = { ...prev };
        rs.filter((r) => r.status === 'conflict' || r.status === 'invalid').forEach((r) => {
          next[r.key] = { ok: false, field: r.field, message: r.message };
        });
        return next;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit these dates. Your form is saved; try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    setResults(null);
    const errs = sharedProblems(data.shared);
    setSharedErrors(errs);
    if (Object.keys(errs).length) {
      setError('Fix the shared details first. They apply to every date.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!openRows.length) {
      setError('Every date in this form has already been submitted. Add another date to request more.');
      return;
    }
    const blocked = openRows.filter((r) => checks[r.key] && !checks[r.key].ok);
    const pendingCheck = openRows.filter((r) => !checks[r.key] || checks[r.key].checking);
    if (pendingCheck.length) {
      setError('Still checking venue availability. Try again in a moment.');
      return;
    }
    const ready = openRows.filter((r) => !blocked.includes(r));
    if (blocked.length) {
      setDecision({ blocked, ready });
      return;
    }
    send(ready.map((r) => r.key));
  };

  // ---------- Visibility / resubmit for submitted dates ----------
  const setHidden = async (key, eventId, hidden) => {
    setBusyRow(key);
    try {
      const res = await api.patch(`/prebook/events/${eventId}/visibility`, { hidden });
      setRowEvents((prev) => ({ ...prev, [key]: { ...prev[key], isHidden: res.data.data.event.isHidden } }));
      await dialog.alert({ tone: 'success', title: hidden ? 'Hidden' : 'Visible', message: res.data.message });
    } catch (err) {
      await dialog.alert({ tone: 'error', title: 'Couldn’t change visibility', message: err.response?.data?.message || 'Please try again.' });
    } finally {
      setBusyRow('');
    }
  };
  const requestAgain = async (key, eventId) => {
    setBusyRow(key);
    try {
      await api.post(`/events/${eventId}/submit`);
      await load();
    } catch (err) {
      await dialog.alert({ tone: 'error', title: 'Couldn’t send the request', message: err.response?.data?.message || 'Please try again.' });
    } finally {
      setBusyRow('');
    }
  };

  const discard = async () => {
    const ok = await dialog.confirm({ title: 'Discard this prebooking?', message: 'The form is deleted. Dates already submitted stay as they are.', confirmLabel: 'Discard', tone: 'error' });
    if (!ok) return;
    await api.delete(`/prebook/drafts/${id}`);
    navigate('/organizer/prebook');
  };

  // ---------- Render ----------
  if (loadError) {
    return (
      <div className="tl-wz-card" style={{ maxWidth: 640, margin: '48px auto', textAlign: 'center' }}>
        <AlertCircle className="w-7 h-7" style={{ margin: '0 auto 12px', color: 'var(--st-rose)' }} />
        <h2>Can’t open this prebooking</h2>
        <p style={{ margin: '8px 0 20px', color: 'var(--st-muted)' }}>{loadError}</p>
        <Link to="/organizer/prebook" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to prebookings</Link>
      </div>
    );
  }
  if (!data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--st-green)' }} /></div>;
  }

  const { shared } = data;
  const sharedArt = resolveMediaUrl(shared.images.bannerUrl || shared.images.cardImageUrl || '') || undefined;
  const saveBadge = {
    saved: { icon: Cloud, text: save.at ? `Saved ${new Date(save.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved' },
    dirty: { icon: Cloud, text: 'Unsaved changes…' },
    saving: { icon: Loader2, text: 'Saving…' },
    error: { icon: CloudOff, text: 'Couldn’t save. Retrying when you edit again.' },
  }[save.state];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 16px 64px' }}>
      <StudioHead
        crumbs={['Organizer', 'Prebookings', shared.name.trim() || 'New prebooking']}
        title="Prebook an event"
        intro="Enter the event details once, then add each date you want to reserve. Dates are reserved only after TicketLedger approves them."
        actions={
          <span className="tl-wz-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-live="polite">
            <saveBadge.icon className={`w-4 h-4${save.state === 'saving' ? ' animate-spin' : ''}`} aria-hidden="true" /> {saveBadge.text}
          </span>
        }
      />

      {error && <div className="tl-wz-alert" role="alert" style={{ marginTop: 16 }}><AlertCircle className="w-4 h-4" />{error}</div>}

      {results && (
        <section className="tl-wz-card" style={{ marginTop: 16 }} aria-live="polite">
          <h2 style={{ fontSize: 20 }}>{results.message}</h2>
          <ul style={{ marginTop: 10, display: 'grid', gap: 6, fontSize: 14.5 }}>
            {results.items.map((r) => (
              <li key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {r.status === 'submitted' || r.status === 'already_submitted'
                  ? <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--st-green)', flex: 'none', marginTop: 2 }} aria-hidden="true" />
                  : <AlertCircle className="w-4 h-4" style={{ color: 'var(--st-rose)', flex: 'none', marginTop: 2 }} aria-hidden="true" />}
                <span>
                  <strong>{r.label || labelOf(r.key)}:</strong>{' '}
                  {r.status === 'submitted' && 'submitted, awaiting approval (not reserved yet).'}
                  {r.status === 'already_submitted' && 'already submitted earlier, not sent again.'}
                  {(r.status === 'conflict' || r.status === 'invalid') && <>kept as a draft. {r.message}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- Shared details ---------- */}
      <section className="tl-wz-card" style={{ marginTop: 16 }}>
        <div className="tl-wz-card-head">
          <div>
            <h2>Event details</h2>
            <p>Used for every date unless you customize a date below.</p>
          </div>
        </div>
        <div className="tl-wz-grid">
          <Field id="pb-name" label="Event name" error={sharedErrors.name} wide>
            <input id="pb-name" className="tl-wz-input" value={shared.name} maxLength={150} onChange={(e) => setShared({ name: e.target.value })} placeholder="e.g. Islamabad Tech Expo 2027" />
          </Field>
          <Field id="pb-type" label="Event category" error={sharedErrors.type}>
            <CategoryField id="pb-type" value={{ type: shared.type, customCategoryId: shared.customCategoryId }} error={sharedErrors.type} onChange={(v) => setShared({ type: v.type, customCategoryId: v.customCategoryId })} />
          </Field>
          <Field id="pb-city" label="City in Pakistan" hint="Every date is in this city. Each date picks its own venue.">
            <select id="pb-city" className="tl-wz-input" value={shared.city} onChange={(e) => setShared({ city: e.target.value })}>
              {(CITIES.includes(shared.city) ? CITIES : [shared.city, ...CITIES]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="pb-description" label="Description" error={sharedErrors.description} wide>
            <textarea id="pb-description" className="tl-wz-input" rows={3} maxLength={5000} value={shared.description} onChange={(e) => setShared({ description: e.target.value })} placeholder="What attendees can expect at this event…" />
          </Field>
          <Field id="pb-contact" label="Contact email for attendees (optional)" error={sharedErrors.contactEmail} wide>
            <input id="pb-contact" className="tl-wz-input" type="email" value={shared.contactEmail} maxLength={200} onChange={(e) => setShared({ contactEmail: e.target.value })} placeholder="events@yourcompany.pk" />
          </Field>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: '22px 0 10px' }}>Shared images (optional)</h3>
        <div className="tl-wz-grid">
          <div className="tl-wz-field"><UploadedImageField kind="card" url={shared.images.cardImageUrl || null} onChange={(u) => setSharedImage('cardImageUrl', u)} /></div>
          <div className="tl-wz-field"><UploadedImageField kind="banner" url={shared.images.bannerUrl || null} onChange={(u) => setSharedImage('bannerUrl', u)} /></div>
          <div className="tl-wz-field"><UploadedImageField kind="galleryWide" url={shared.images.galleryWideUrl || null} onChange={(u) => setSharedImage('galleryWideUrl', u)} /></div>
          <div className="tl-wz-field is-wide"><UploadedGalleryField urls={shared.images.gallery || []} onChange={(urls) => setSharedImage('gallery', urls)} /></div>
        </div>
      </section>

      {/* ---------- Dates ---------- */}
      <section style={{ marginTop: 16, display: 'grid', gap: 14 }}>
        {data.rows.map((row, index) => {
          const ev = rowEvents[row.key];
          const state = eventState(ev);
          const check = checks[row.key];
          const clash = !ev && check && !check.ok && !check.incomplete && check.message;
          const label = `Date ${index + 1}`;
          const ci = row.custom?.images || {};
          return (
            <article
              key={row.key}
              id={`row-${row.key}`}
              className="tl-wz-card"
              style={clash ? { borderColor: 'var(--st-rose, #e11d48)', boxShadow: '0 0 0 2px rgba(225, 29, 72, 0.15)' } : undefined}
              aria-label={label}
            >
              <div className="tl-wz-card-head is-plain" style={{ alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 20 }}>{label}</h2>
                  <Badge tone={state.tone}>{state.label}</Badge>
                  {ev?.reservedAt && <Badge tone={ev.isHidden ? 'amber' : 'green'} icon={ev.isHidden ? EyeOff : Eye}>{ev.isHidden ? 'Hidden' : 'Public'}</Badge>}
                </div>
                {!ev && data.rows.length > 1 && (
                  <button type="button" className="tl-wz-btn" style={{ minHeight: 40, padding: '0 14px' }} onClick={() => removeRow(row.key, index)} aria-label={`Remove ${label}`}>
                    <Trash2 className="w-4 h-4" /> Remove
                  </button>
                )}
              </div>

              {ev ? (
                /* Submitted: a summary of its own event record, managed from here or the event tools */
                <div style={{ display: 'grid', gap: 10, fontSize: 15 }}>
                  <p>
                    <strong>{ev.name}</strong> · {ev.venue}, {shared.city}
                    <br />
                    {ev.startsAt && `${pktDate(ev.startsAt)}, ${pktTime(ev.startsAt)} – ${pktDate(ev.endsAt) === pktDate(ev.startsAt) ? '' : `${pktDate(ev.endsAt)}, `}${pktTime(ev.endsAt)}`}
                  </p>
                  {state.note && <p className="tl-wz-hint">{state.note}</p>}
                  {ev.reservedAt && ev.isHidden && <p className="tl-wz-hint">Hidden dates keep their reservation and any sold tickets. Add tickets and a seating plan, then show it publicly when you’re ready.</p>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ev.reservedAt && (
                      <button type="button" className="tl-wz-btn" style={{ minHeight: 42 }} disabled={busyRow === row.key} onClick={() => setHidden(row.key, ev.id, !ev.isHidden)}>
                        {ev.isHidden ? <><Eye className="w-4 h-4" /> Show publicly</> : <><EyeOff className="w-4 h-4" /> Hide from public</>}
                      </button>
                    )}
                    {ev.reservedAt && (
                      <Link to={`/organizer/events/${ev.id}/venue`} className="tl-wz-btn" style={{ minHeight: 42 }}>
                        <Settings2 className="w-4 h-4" /> Tickets &amp; seating
                      </Link>
                    )}
                    {['PENDING_APPROVAL', 'REJECTED', 'PUBLISHED', 'PAUSED'].includes(ev.status) && (
                      <Link to={`/organizer/events/${ev.id}/edit`} className="tl-wz-btn" style={{ minHeight: 42 }}>
                        <Pencil className="w-4 h-4" /> Edit this date
                      </Link>
                    )}
                    {ev.status === 'REJECTED' && (
                      <button type="button" className="tl-wz-btn tl-wz-btn--green" style={{ minHeight: 42 }} disabled={busyRow === row.key} onClick={() => requestAgain(row.key, ev.id)}>
                        <Send className="w-4 h-4" /> Request again
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="tl-wz-grid">
                    <Field id={`v-${row.key}`} label="Venue" wide error={check && !check.ok && check.field === 'venue' && row.venue ? check.message : null} hint="Name the exact space, e.g. “Air University – FMC Parking”. Different spaces at the same campus can host events at the same time.">
                      <input id={`v-${row.key}`} className="tl-wz-input" value={row.venue} maxLength={200} onChange={(e) => setRow(row.key, { venue: e.target.value })} placeholder="e.g. Air University – FMC Parking" />
                    </Field>
                    <Field id={`d-${row.key}`} label="Start date" error={check && !check.ok && check.field === 'date' && row.date ? check.message : null}>
                      <input id={`d-${row.key}`} className="tl-wz-input" type="date" min={todayIso()} value={row.date} onChange={(e) => setRow(row.key, { date: e.target.value })} />
                    </Field>
                    <Field id={`t-${row.key}`} label="Start time (PKT)">
                      <input id={`t-${row.key}`} className="tl-wz-input" type="time" value={row.time} onChange={(e) => setRow(row.key, { time: e.target.value })} />
                    </Field>
                    <Field id={`ed-${row.key}`} label="End date" error={check && !check.ok && check.field === 'endDate' ? check.message : null}>
                      <input id={`ed-${row.key}`} className="tl-wz-input" type="date" min={row.date || todayIso()} value={row.endDate} onChange={(e) => setRow(row.key, { endDate: e.target.value })} />
                    </Field>
                    <Field id={`et-${row.key}`} label="End time (PKT)" error={check && !check.ok && check.field === 'endTime' ? check.message : null}>
                      <input id={`et-${row.key}`} className="tl-wz-input" type="time" value={row.endTime} onChange={(e) => setRow(row.key, { endTime: e.target.value })} />
                    </Field>
                    <div className="tl-wz-field is-wide" aria-live="polite">
                      {clash && check.field === 'schedule' ? (
                        <p className="tl-wz-error" role="alert">
                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          {check.message}{check.more > 0 && ` (${check.more} more booking${check.more === 1 ? '' : 's'} also clash.)`}
                        </p>
                      ) : check?.checking ? (
                        <p className="tl-wz-hint"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Checking availability…</p>
                      ) : check?.ok ? (
                        <p className="tl-wz-hint" style={{ color: '#16a34a' }}>
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                          Available: {row.venue.trim()}, {twelveHour(row.time)} – {row.endDate !== row.date ? `${row.endDate}, ` : ''}{twelveHour(row.endTime)}, with at least an hour around other bookings.
                        </p>
                      ) : (
                        <p className="tl-wz-hint">Running past midnight? Set the end date to the next day. Bookings at the same venue need at least one hour between them.</p>
                      )}
                    </div>
                  </div>

                  {/* ---------- Per-date customization ---------- */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, fontWeight: 600, cursor: 'pointer' }}>
                    <input type="checkbox" checked={row.customize} onChange={(e) => setRow(row.key, { customize: e.target.checked })} />
                    Customize this date
                  </label>
                  {!row.customize && <p className="tl-wz-hint">Uses the event name and images above, and is shown publicly once it’s approved and has tickets.</p>}
                  {row.customize && (
                    <div style={{ marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--st-line-soft)' }}>
                      <p className="tl-wz-hint" style={{ marginBottom: 12 }}>Anything you leave empty uses the shared value. Changes here only affect {label}.</p>
                      <div className="tl-wz-grid">
                        <Field id={`n-${row.key}`} label="Name for this date (optional)" wide>
                          <input id={`n-${row.key}`} className="tl-wz-input" maxLength={150} value={row.custom?.name || ''} onChange={(e) => setCustom(row.key, { name: e.target.value })} placeholder={shared.name || 'Uses the event name'} />
                        </Field>
                        <div className="tl-wz-field">
                          <UploadedImageField kind="card" url={ci.cardImageUrl || null} onChange={(u) => setCustomImage(row.key, 'cardImageUrl', u)} fallbackSrc={resolveMediaUrl(shared.images.cardImageUrl || '') || sharedArt} fallbackLabel="the shared card image" />
                        </div>
                        <div className="tl-wz-field">
                          <UploadedImageField kind="banner" url={ci.bannerUrl || null} onChange={(u) => setCustomImage(row.key, 'bannerUrl', u)} fallbackSrc={resolveMediaUrl(shared.images.bannerUrl || '') || undefined} fallbackLabel="the shared banner" />
                        </div>
                        <div className="tl-wz-field">
                          <UploadedImageField kind="galleryWide" url={ci.galleryWideUrl || null} onChange={(u) => setCustomImage(row.key, 'galleryWideUrl', u)} fallbackSrc={resolveMediaUrl(shared.images.galleryWideUrl || '') || undefined} fallbackLabel="the shared wide image" />
                        </div>
                        <div className="tl-wz-field is-wide">
                          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, cursor: 'pointer' }}>
                            <input type="checkbox" checked={Array.isArray(ci.gallery)} onChange={(e) => setCustomImage(row.key, 'gallery', e.target.checked ? [] : null)} />
                            Use a different gallery for this date
                          </label>
                          {Array.isArray(ci.gallery)
                            ? <UploadedGalleryField urls={ci.gallery} onChange={(urls) => setCustomImage(row.key, 'gallery', urls)} />
                            : <p className="tl-wz-hint">Uses the shared gallery ({(shared.images.gallery || []).length} image{(shared.images.gallery || []).length === 1 ? '' : 's'}).</p>}
                        </div>
                        <div className="tl-wz-field is-wide">
                          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, cursor: 'pointer' }}>
                            <input type="checkbox" checked={row.custom?.isPublic !== false} onChange={(e) => setCustom(row.key, { isPublic: e.target.checked })} />
                            Show this date publicly
                          </label>
                          <p className="tl-wz-hint">
                            {row.custom?.isPublic !== false
                              ? 'It appears on TicketLedger once it’s approved and has tickets and seating.'
                              : 'It stays hidden after approval. The reservation is kept, and you can show it later.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <button type="button" className="tl-wz-btn" onClick={addRow} disabled={data.rows.length >= 30}>
          <Plus className="w-4 h-4" /> Add another date
        </button>
      </div>

      {/* ---------- Conflict decision: never drop a date, never restart ---------- */}
      {decision && (
        <section className="tl-wz-card" style={{ marginTop: 16, borderColor: 'var(--st-rose, #e11d48)' }} role="alertdialog" aria-label="Some dates can’t be submitted yet">
          <h2 style={{ fontSize: 20 }}>
            {decision.blocked.length === 1 ? `${labelOf(decision.blocked[0].key)} can’t be submitted yet` : `${decision.blocked.length} dates can’t be submitted yet`}
          </h2>
          <ul style={{ margin: '10px 0 16px', display: 'grid', gap: 6, fontSize: 14.5 }}>
            {decision.blocked.map((r) => (
              <li key={r.key}>
                <strong>{labelOf(r.key)}:</strong> {checks[r.key]?.incomplete ? 'Fill in its venue, dates and times.' : checks[r.key]?.message}
              </li>
            ))}
          </ul>
          <p className="tl-wz-hint" style={{ marginBottom: 14 }}>Nothing you entered is lost. All dates, details, images and customizations stay in this form.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="tl-wz-btn" onClick={() => { setDecision(null); focusRow(decision.blocked[0].key); }}>
              <Pencil className="w-4 h-4" /> Fix {labelOf(decision.blocked[0].key).toLowerCase()}
              {decision.ready.length > 0 && ` and submit all ${decision.ready.length + decision.blocked.length}`}
            </button>
            {decision.ready.length > 0 && (
              <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => send(decision.ready.map((r) => r.key))} disabled={submitting}>
                <Send className="w-4 h-4" />
                Submit the {decision.ready.length} available date{decision.ready.length === 1 ? '' : 's'} and keep {decision.blocked.length === 1 ? labelOf(decision.blocked[0].key).toLowerCase() : 'the others'} as a draft
              </button>
            )}
          </div>
        </section>
      )}

      <footer className="tl-wz-card" style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="tl-wz-hint" style={{ maxWidth: 560 }}>
          Submitting sends each date to TicketLedger for approval. A date is <strong>Reserved</strong> only after it’s approved. Until then the slot is held for your request.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="tl-wz-btn" onClick={discard}><Trash2 className="w-4 h-4" /> Discard form</button>
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={submit} disabled={submitting || !openRows.length}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {openRows.length ? `Submit ${openRows.length} date${openRows.length === 1 ? '' : 's'} for approval` : 'All dates submitted'}
          </button>
        </div>
      </footer>
    </div>
  );
}
