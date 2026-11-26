import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { connectSocket } from '../lib/socket';
import {
  AlertTriangle, ArrowLeft, Armchair, Camera, Check, ChevronRight, Clock, ShieldOff, CheckCircle2, CloudOff, CloudUpload, ImageUp, Info, Keyboard, MapPin,
  RefreshCw, ScanLine, ShieldCheck, Tag, Ticket, User, Users, Wifi, X, Activity, CalendarDays, ExternalLink, HardDrive, Zap,
} from 'lucide-react';
import { useAdminDark } from '../components/dash/DashShell';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import QrCamera from '../components/scanner/QrCamera';
import { decodeQrFromFile } from '../lib/qrImage';
import {
  deviceId as getDeviceId, evaluateOffline, loadPack, savePack, markUsedLocally, noteOnline, offlineTooLong, lastOnline, wipeEventPack,
} from '../lib/gateOffline';
import {
  APP_VERSION, applyEvidenceResults, applySyncResults, exportScans, initScanStore, scanDiagnostics, listScans, recordScan, recoverInterrupted, releaseBatch, retryFailed, scanCounts, takeForEvidence, takeForUpload, withUploadLock,
} from '../lib/gateScanStore';
import { backoffDelay, classifySyncError, newScanId, toUploadItem } from '../lib/gateScanModel';
import { DEVICE_AUTH_CODES, clearDeviceToken, ensureDeviceToken, loadDeviceToken, signScan } from '../lib/gateDeviceAuth';
import '../components/scanner/scanner.css';

const GATES = ['Gate A', 'Gate B', 'Gate C', 'Gate D', 'Gate E', 'VIP Gate'];
const PACK_REFRESH_MS = 3 * 60 * 1000;
const RESULT_HOLD_MS = 3500;
const TITLES = { GREEN: 'Entry allowed', YELLOW: 'Already scanned', RED: 'Not valid' };

const readGate = (eventId) => {
  try {
    return localStorage.getItem(`tl-gate-${eventId}`) || '';
  } catch {
    return '';
  }
};
const writeGate = (eventId, gate) => {
  try {
    localStorage.setItem(`tl-gate-${eventId}`, gate);
  } catch {
    /* storage unavailable */
  }
};
const ago = (t) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const clock = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Short tones and vibration so staff don't need to read the screen
let audioCtx = null;
const feedback = (result) => {
  try {
    navigator.vibrate?.(result === 'GREEN' ? 90 : result === 'YELLOW' ? [90, 70, 90] : [320]);
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = result === 'GREEN' ? [[880, 0, 0.09], [1320, 0.11, 0.12]] : result === 'YELLOW' ? [[620, 0, 0.12], [620, 0.18, 0.12]] : [[180, 0, 0.42]];
    for (const [freq, at, len] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = result === 'RED' ? 'sawtooth' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + at + len);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + at);
      osc.stop(audioCtx.currentTime + at + len + 0.02);
    }
  } catch {
    /* no audio */
  }
};

const VERDICT_COPY = {
  GREEN: { title: 'Entry approved', sub: 'Ticket checked in successfully.', Icon: Check },
  YELLOW: { title: 'Already used', sub: 'Do not admit again.', Icon: RefreshCw },
  RED: { title: 'Invalid ticket', sub: 'Entry not approved.', Icon: X },
};

/**
 * Full-screen result card. Green = admitted (the server has marked the ticket used), yellow = the ticket was
 * already used (first entry shown), red = not valid (reason shown). Green clears itself; yellow and red stay
 * until staff choose what to do next.
 */
function Verdict({ verdict, eventName, gate, online, onNext, onManual, onException }) {
  const [supervisor, setSupervisor] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(null); // null | 'sending' | 'sent' | error text
  const base = VERDICT_COPY[verdict.result];
  const { title, sub, Icon } = verdict.result === 'GREEN' && verdict.direction === 'EXIT'
    ? { ...base, title: 'Exit recorded', sub: verdict.reason }
    : verdict.result === 'GREEN' && verdict.reentry ? { ...base, title: 'Re-entry approved', sub: 'Welcome back.' } : base;
  const askSupervisor = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setSent('Say why the guest should be let in (at least 5 characters).');
    setSent('sending');
    setSent((await onException(reason.trim())) || 'sent');
  };
  const exceptionBox = onException && verdict.direction !== 'EXIT' && (
    sent === 'sent'
      ? <p className="tl-gv-info" role="status"><Info aria-hidden="true" /> Sent to the supervisor. Ask the guest to wait to one side; you'll see the decision here.</p>
      : supervisor
        ? (
          <form className="tl-gv-exception" onSubmit={askSupervisor}>
            <label htmlFor="gv-reason">Why should they be let in?</label>
            <input id="gv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. ID matches the ticket holder" autoFocus />
            {sent && sent !== 'sending' && <small>{sent}</small>}
            <button type="submit" className="tl-gv-outline" disabled={sent === 'sending'}><Users aria-hidden="true" /> {sent === 'sending' ? 'Sending…' : 'Send to supervisor'}</button>
          </form>
        )
        : <button type="button" className="tl-gv-outline" onClick={() => setSupervisor(true)}><Users aria-hidden="true" /> Ask a supervisor to approve</button>
  );
  const t = verdict.ticket;
  const first = verdict.firstScan;
  const tone = verdict.result.toLowerCase();
  return (
    <div className={`tl-gv is-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="gv-title" aria-live="assertive">
      <div className="tl-gv-card">
        <header className="tl-gv-brand">
          <span><strong>TicketLedger</strong><small>Gate Scanner</small></span>
        </header>
        <div className="tl-gv-event">
          <strong>{eventName || 'Event'}</strong>
          <small><i className={online && !verdict.offline ? 'is-on' : ''} aria-hidden="true" /> {gate} • {online && !verdict.offline ? 'Online' : 'Offline'}</small>
        </div>

        <div className="tl-gv-badge" aria-hidden="true"><Icon /></div>
        <h2 id="gv-title" className="tl-gv-title">{title}</h2>
        <p className="tl-gv-sub">{sub}</p>

        {verdict.result !== 'RED' && t && (
          <ul className="tl-gv-facts">
            <li><User aria-hidden="true" /><strong>{t.holderName || t.holder || 'Guest'}</strong></li>
            <li><Ticket aria-hidden="true" />{t.type || 'Ticket'}</li>
            <li><Armchair aria-hidden="true" />{t.seat || 'General admission'}</li>
            {t.code && <li><Tag aria-hidden="true" />Ticket {t.code}</li>}
            {verdict.result === 'GREEN' && verdict.direction !== 'EXIT' && (
              <li><Clock aria-hidden="true" />{verdict.reentry ? `Re-entry ${t.entryCount ? `(entry ${t.entryCount})` : ''}` : `Checked in at ${clock(t.checkedInAt || Date.now())}`}</li>
            )}
            {verdict.result === 'YELLOW' && (
              <li className="tl-gv-first">
                <Clock aria-hidden="true" />
                <span>
                  <strong>First entry: {first?.at ? clock(first.at) : (t.checkedInAt ? clock(t.checkedInAt) : 'earlier')}</strong>
                  <small>{[first?.gate || t.gate, first?.by].filter(Boolean).join(' • ') || verdict.reason}</small>
                </span>
              </li>
            )}
          </ul>
        )}

        {verdict.result === 'GREEN' && (
          <p className="tl-gv-ok"><CheckCircle2 aria-hidden="true" /> {verdict.offline ? 'Valid on this device (offline) • checked against the other gates when it uploads' : 'Ticket valid • Ownership verified'}</p>
        )}

        {verdict.result === 'YELLOW' && (exceptionBox || (
          supervisor
            ? <p className="tl-gv-info" role="status"><Info aria-hidden="true" /> Ask the guest to wait to one side and radio your supervisor. Do not admit them again.</p>
            : <button type="button" className="tl-gv-outline" onClick={() => setSupervisor(true)}><Users aria-hidden="true" /> Call supervisor</button>
        ))}

        {verdict.result === 'RED' && (
          <>
            <p className="tl-gv-reason"><AlertTriangle aria-hidden="true" /> {verdict.reason || 'This ticket could not be verified.'}</p>
            <p className="tl-gv-info"><Info aria-hidden="true" /> Ask the attendee to open their ticket in TicketLedger and try again.</p>
            <button type="button" className="tl-gv-outline" onClick={onNext}><ScanLine aria-hidden="true" /> Scan again</button>
            {exceptionBox}
            <button type="button" className="tl-gv-link" onClick={onManual}>Manual lookup</button>
          </>
        )}

        <button type="button" className="tl-gv-next" onClick={onNext} autoFocus>
          <ScanLine aria-hidden="true" /> <span>Scan next ticket</span> <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Drag-and-drop / file picker that reads the QR from a screenshot or photo of a pass (demo and testing). */
function ImageScan({ disabled, busy, onCode, onError, compact }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const read = async (file) => {
    if (!file || disabled) return;
    setReading(true);
    try {
      onCode(await decodeQrFromFile(file));
    } catch (err) {
      onError(err.message);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <div
      className={`tl-gs-drop${over ? ' is-over' : ''}${compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files?.[0]); }}
    >
      <ImageUp className="w-6 h-6" aria-hidden="true" />
      <span>
        <strong>{reading || busy ? 'Reading the QR…' : compact ? 'Scan from an image' : 'Drop a QR image here'}</strong>
        {!compact && <small>Screenshot or photo of the ticket QR · PNG, JPG or WebP</small>}
      </span>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || reading || busy}>Choose file</button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => read(e.target.files?.[0])} />
    </div>
  );
}

const STATE_LABEL = { PENDING: 'Waiting to upload', UPLOADING: 'Uploading', SYNCED: 'Uploaded', FAILED: 'Upload failed', CONFLICT: 'Conflict: supervisor review', QUARANTINED: 'Kept for supervisor review (not admitted)' };
const STATE_TONE = { PENDING: 'yellow', UPLOADING: 'yellow', SYNCED: 'green', FAILED: 'red', CONFLICT: 'red', QUARANTINED: 'yellow' };

/** This device's scan records for the event: sync state, failure reasons, upload / retry, and a JSON export. */
function DeviceScans({ eventId, counts, online, onSync, onChange }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    listScans(eventId, { limit: 100 }).then(setRows).catch(() => setRows([]));
  }, [eventId, counts]);
  const run = async (what, fn) => {
    setBusy(what);
    try {
      await fn();
    } finally {
      setBusy('');
      onChange();
    }
  };
  const download = () => run('export', async () => {
    const data = await exportScans(eventId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gate-scans-${eventId.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return (
    <div>
      <div className="tl-gs-gates" style={{ marginTop: 8 }}>
        <button type="button" onClick={() => run('sync', () => onSync({ manual: true }))} disabled={!online || Boolean(busy) || !counts?.PENDING}>{busy === 'sync' ? 'Uploading…' : 'Upload now'}</button>
        <button type="button" onClick={() => run('retry', async () => { await retryFailed(eventId); if (online) await onSync({ manual: true }); })} disabled={Boolean(busy) || !counts?.FAILED}>Retry failed ({counts?.FAILED || 0})</button>
        <button type="button" onClick={download} disabled={Boolean(busy)}>Export (JSON)</button>
      </div>
      {!rows ? <p className="tl-gs-muted">Loading…</p> : !rows.length ? <p className="tl-gs-empty">No offline scans on this device for this event.</p> : (
        <ul className="tl-gs-recent">
          {rows.map((r) => (
            <li key={r.scanId} className={`is-${STATE_TONE[r.syncState]}`}>
              <i aria-hidden="true" />
              <span>
                <strong>#{r.seq} · {STATE_LABEL[r.syncState]}</strong>
                <small>
                  {r.direction === 'EXIT' ? 'Exit' : 'Entry'} · on this device: {r.localResult}{r.localReason ? ` (${r.localReason})` : ''}
                  {r.server?.result ? ` · server: ${r.server.result}${r.server.reason ? ` (${r.server.reason})` : ''}${r.server.status === 'ALREADY_PROCESSED' ? ' · already received earlier' : ''}` : r.server?.status === 'QUARANTINED' ? ' · handed in for supervisor review' : ''}
                  {r.lastError && r.syncState !== 'SYNCED' ? ` · ${r.lastError}` : ''}
                  {r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}
                  {r.migratedFrom ? ' · from the previous scanner version' : ''}
                </small>
              </span>
              <time>{clock(r.deviceScannedAt)}{r.gate ? ` · ${r.gate}` : ''}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventPicker({ events, loading, onPick }) {
  return (
    <section className="tl-gs-card">
      <h2 className="tl-gs-h2">Choose your event</h2>
      <p className="tl-gs-muted">You can scan tickets for the events you’re assigned to.</p>
      {loading ? (
        <p className="tl-gs-muted"><RefreshCw className="w-4 h-4 inline tl-dash-spin" aria-hidden="true" /> Loading your events…</p>
      ) : events.length === 0 ? (
        <p className="tl-gs-empty">You aren’t assigned to any events yet. Ask your organizer to add you to one.</p>
      ) : (
        <ul className="tl-gs-events">
          {events.map((ev) => (
            <li key={ev.id}>
              <button type="button" onClick={() => onPick(ev.id)}>
                <span>
                  <strong>{ev.name}</strong>
                  <small><MapPin className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> {ev.venue}, {ev.city} · {new Date(ev.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{ev.time ? ` · ${ev.time}` : ''}</small>
                </span>
                <ScanLine className="w-5 h-5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Gate scanner (phone-first). Pick the event and gate, press Scan tickets: the camera opens full screen,
 * each pass is checked by the server (or on the device from the offline pack when there's no connection)
 * and the verdict fills the screen with a tone and vibration before the next scan.
 */
export default function GateScanner() {
  const { user } = useAuth();
  const dark = useAdminDark(); // console layout: overview cards above the scanning tools
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const eventId = params.get('eventId') || '';
  const device = useMemo(() => getDeviceId(), []);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [gate, setGate] = useState('');
  const [customGate, setCustomGate] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pack, setPack] = useState(null);
  const [packError, setPackError] = useState('');
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [counts, setCounts] = useState(null); // this device's scans for the event by sync state (gateScanStore)
  const [storeInfo, setStoreInfo] = useState(null); // { persisted, migration, pruned } or { error }
  const [showScans, setShowScans] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState('');
  const [locked, setLocked] = useState(false);
  const [revoked, setRevoked] = useState(null); // { kept, device? } once access to this event (or this device) is removed
  const [direction, setDirection] = useState('ENTRY'); // at gates that take both
  const [deviceAuth, setDeviceAuth] = useState(null); // null | { state, message } from enrollment
  const busyRef = useRef(false);
  const resetTimer = useRef(null);
  const revokedRef = useRef(false);
  const tokenRef = useRef(null);
  const needsResetRef = useRef(false);
  const handInRef = useRef(null); // handInEvidence (declared after revoke)
  const backoffRef = useRef({ failures: 0, nextAt: 0 }); // automatic uploads after consecutive failures
  const lastSyncErrorRef = useRef(null); // reported with the heartbeat until an upload succeeds
  const [recovery, setRecovery] = useState(null); // { recovered, nextAt, failures, error } shown under “Scans on this device”
  const [connTest, setConnTest] = useState(null); // result of “Test connection”

  const event = events.find((e) => e.id === eventId) || pack?.event || null;
  const companyId = event?.companyId || pack?.event?.companyId || null;

  // ---------- Device credential ----------
  // Every scanner request carries the device id and, once enrolled, the device token (X-Device-Token). A request
  // refused for the credential enrolls (or re-enrolls) the device and is sent once more.
  const enroll = useCallback(async (invalidToken = null) => {
    if (!eventId) return null;
    const out = await ensureDeviceToken({ eventId, deviceKey: device, companyId, invalidToken });
    tokenRef.current = out.token || null;
    // Waits for the supervisor's reset (gate:device-reset) or a reload instead of retrying on every request
    needsResetRef.current = out.state === 'needs-reset';
    setDeviceAuth(out.state === 'enrolled' ? null : { state: out.state, message: out.message });
    return out.token || null;
  }, [eventId, device, companyId]);

  const deviceCall = useCallback(async (config) => {
    if (!tokenRef.current && companyId) tokenRef.current = await loadDeviceToken(companyId, device);
    const send = () => api.request({ ...config, headers: { ...(config.headers || {}), ...(tokenRef.current ? { 'X-Device-Token': tokenRef.current } : {}) } });
    try {
      return await send();
    } catch (err) {
      const code = err.response?.status === 401 ? err.response.data?.code : null;
      if (!DEVICE_AUTH_CODES.includes(code) || needsResetRef.current) throw err;
      if (!(await enroll(code === 'DEVICE_TOKEN_INVALID' ? tokenRef.current : null))) throw err;
      return send();
    }
  }, [companyId, device, enroll]);

  // Silent migration: a device without a token enrolls as soon as it is online and knows the organization
  useEffect(() => {
    tokenRef.current = null;
    if (!eventId || !companyId) return;
    let cancelled = false;
    loadDeviceToken(companyId, device).then((t) => {
      if (cancelled) return;
      tokenRef.current = t;
      if (!t && navigator.onLine) enroll();
    });
    return () => { cancelled = true; };
  }, [eventId, companyId, device, enroll]);

  // ---------- Events and gate ----------
  useEffect(() => {
    api.get('/checkin/events')
      .then((res) => setEvents(res.data.data.events))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, []);
  // Access to this event (or this device) was removed: delete the ticket list (and, for a revoked device, its
  // credential) and stop scanning. Scans not uploaded yet are kept as evidence for supervisor review.
  const revoke = useCallback(async (deviceRevoked = false) => {
    if (!eventId) return;
    revokedRef.current = true;
    await wipeEventPack(eventId).catch(() => {});
    // Hand the scans the server hasn't processed in as evidence (quarantined for supervisors; never admissions)
    await handInRef.current?.().catch(() => {});
    const kept = (await scanCounts(eventId).catch(() => null))?.unsynced || 0;
    if (deviceRevoked) {
      await clearDeviceToken(companyId);
      tokenRef.current = null;
    }
    setPack(null);
    setScanning(false);
    setVerdict(null);
    setRevoked({ kept, device: deviceRevoked });
    if (!deviceRevoked) setEvents((list) => list.filter((e) => e.id !== eventId));
  }, [eventId, companyId]);
  // A 403 means: this device was revoked, or this account lost the event (other refusals are shown as a verdict)
  const isAccessLoss = (err) => err.response?.status === 403 && (!err.response.data?.code || err.response.data.code === 'DEVICE_REVOKED');
  const loseAccess = useCallback((err) => revoke(err.response?.data?.code === 'DEVICE_REVOKED'), [revoke]);

  useEffect(() => {
    setRevoked(null);
    revokedRef.current = false;
    setGate(eventId ? readGate(eventId) : '');
    setVerdict(null);
    setRecent([]);
    setStats(null);
  }, [eventId]);
  const chooseGate = (g) => {
    setGate(g);
    writeGate(eventId, g);
  };

  // ---------- Offline pack, queue and connectivity ----------
  const refreshQueue = useCallback(async () => {
    if (!eventId) return;
    try {
      setCounts(await scanCounts(eventId));
    } catch (err) {
      setStoreInfo({ error: err.message || 'This device can’t store offline scans.' });
    }
  }, [eventId]);
  const queueCount = counts?.unsynced || 0;

  /**
   * Revoked device or access removed: the scans not processed yet are handed in to POST /api/checkin/evidence and
   * become QUARANTINED (kept by the server for supervisor review). Without a connection they stay on the device
   * and are handed in the next time the scanner opens online.
   */
  const handInEvidence = useCallback(async () => {
    if (!eventId) return;
    await withUploadLock(async () => {
      await initScanStore();
      for (;;) {
        const batch = await takeForEvidence(eventId);
        if (!batch.length) break;
        try {
          const res = await api.post('/checkin/evidence', { eventId, deviceId: device, scans: batch.map(toUploadItem) });
          const out = await applyEvidenceResults(batch, res.data.data.results);
          if (out.unacknowledged) break;
        } catch (err) {
          await releaseBatch(batch, { state: 'PENDING', message: err.response?.data?.message || 'Could not hand in the scans yet; they stay on this device.' });
          break;
        }
      }
    });
    refreshQueue();
  }, [eventId, device, refreshQueue]);
  handInRef.current = handInEvidence;

  // Opens the scan store once: moves scans from the previous scanner version (backed up and verified first)
  useEffect(() => {
    initScanStore().then(setStoreInfo, (err) => setStoreInfo({ error: err.message || 'This device can’t store offline scans.' }));
  }, []);

  const refreshPack = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await deviceCall({ method: 'get', url: `/checkin/events/${eventId}/pack`, params: { deviceId: device } });
      await savePack(eventId, res.data.data, user?.id);
      setPack({ ...res.data.data, savedAt: Date.now() });
      setPackError('');
      noteOnline();
      setOnline(true);
    } catch (err) {
      if (isAccessLoss(err)) {
        loseAccess(err);
        return;
      }
      if (!err.response) setOnline(false);
      else setPackError(err.response.data?.message || 'Could not download the offline list.');
      const cached = await loadPack(eventId, user?.id).catch(() => null);
      if (cached) setPack(cached);
    }
  }, [eventId, user?.id, loseAccess, device, deviceCall]);

  const loadStats = useCallback(async () => {
    if (!eventId) return;
    try {
      const [s, r] = await Promise.all([api.get(`/checkin/events/${eventId}/stats`), api.get(`/checkin/events/${eventId}/recent?limit=12`)]);
      setStats(s.data.data);
      setRecent(r.data.data.scans);
    } catch {
      /* offline: keep what we have */
    }
  }, [eventId]);

  /**
   * Uploads this device's PENDING scans for the event, oldest first, one batch at a time (one uploader across tabs).
   * Each scan is marked from the server's acknowledgement; a failed request returns its batch to PENDING (retried)
   * or FAILED (kept, shown, "Retry failed"). No scan is removed because an upload failed.
   */
  const syncQueue = useCallback(async ({ manual = false } = {}) => {
    // A revoked device keeps its scans but doesn't try to upload them as admissions
    if (!eventId || revokedRef.current) return;
    // After failures, automatic attempts wait (backoff); "Upload now" doesn't
    if (!manual && Date.now() < backoffRef.current.nextAt) return;
    let retryLater = false;
    await withUploadLock(async () => {
      await initScanStore();
      // Holding the lock: anything still UPLOADING was cut off (page closed, connection lost mid-upload)
      const recovered = await recoverInterrupted(eventId);
      if (recovered) setRecovery((r) => ({ ...r, recovered: (r?.recovered || 0) + recovered, recoveredAt: Date.now() }));
      let synced = 0;
      let conflicts = 0;
      let failed = 0;
      let unacknowledged = 0;
      for (;;) {
        const batch = await takeForUpload(eventId);
        if (!batch.length) break;
        try {
          const left = (await scanCounts(eventId)).unsynced;
          const res = await deviceCall({ method: 'post', url: '/checkin/sync', data: { eventId, deviceId: device, pending: left, scans: batch.map(toUploadItem) } });
          const out = await applySyncResults(batch, res.data.data.results);
          synced += out.synced;
          conflicts += out.conflicts;
          failed += out.rejected;
          unacknowledged += out.unacknowledged;
          noteOnline();
          setOnline(true);
          if (out.unacknowledged) {
            retryLater = true;
            break; // sent again on the next run, not in a loop now
          }
        } catch (err) {
          const outcome = classifySyncError(err);
          lastSyncErrorRef.current = outcome.message;
          await releaseBatch(batch, outcome);
          if (outcome.state === 'FAILED') {
            failed += batch.length;
            continue;
          }
          if (isAccessLoss(err)) loseAccess(err);
          else if (!err.response) setOnline(false);
          retryLater = outcome.retry || retryLater;
          break;
        }
      }
      if (synced || failed || unacknowledged) {
        setSyncNote([
          synced && `${synced} offline scan${synced === 1 ? '' : 's'} uploaded`,
          conflicts && `${conflicts} flagged for the organizer (admitted twice while offline)`,
          failed && `${failed} could not be uploaded (kept on this device: see “Scans on this device”)`,
          unacknowledged && `${unacknowledged} not confirmed by the server yet (will be sent again)`,
        ].filter(Boolean).join(' · ') + '.');
      }
      if (synced) loadStats();
    }).catch((err) => setStoreInfo({ error: err.message || 'This device can’t store offline scans.' }));
    const b = backoffRef.current;
    b.failures = retryLater ? b.failures + 1 : 0;
    b.nextAt = Date.now() + backoffDelay(b.failures);
    if (!retryLater) lastSyncErrorRef.current = null;
    setRecovery((r) => ({ ...r, failures: b.failures, nextAt: b.failures ? b.nextAt : null, error: lastSyncErrorRef.current }));
    refreshQueue();
  }, [eventId, device, loadStats, refreshQueue, loseAccess, deviceCall]);

  // Sync status for supervisors: every 30 s the device reports its gate, waiting scans and list age
  const queueRef = useRef(0);
  queueRef.current = queueCount;
  // With it the scanner's own health: failed / stuck / conflict counts, oldest unprocessed and last scan, app
  // version, whether the browser keeps the storage, its clock, and the last upload problem
  const lastScanRef = useRef(null);
  const persistedRef = useRef(undefined);
  persistedRef.current = storeInfo?.persisted;
  const sendHeartbeat = useCallback(async () => {
    if (!eventId || revokedRef.current || !navigator.onLine) return null;
    const d = await scanDiagnostics(eventId).catch(() => null);
    const lastScanAt = [d?.lastScanAt, lastScanRef.current].filter(Boolean).sort().pop() || undefined;
    return deviceCall({ method: 'post', url: '/checkin/heartbeat', data: {
      eventId, deviceId: device, gate: gate || undefined, pending: queueRef.current, online: true, packAt: pack?.generatedAt,
      appVersion: APP_VERSION, clientTime: new Date().toISOString(), lastSyncError: lastSyncErrorRef.current,
      ...(d ? { failed: d.failed, conflicts: d.conflicts, stuck: d.stuck, oldestPendingAt: d.oldestPendingAt } : {}),
      ...(lastScanAt ? { lastScanAt } : {}),
      ...(typeof persistedRef.current === 'boolean' ? { persisted: persistedRef.current } : {}),
    } }).catch((err) => {
      if (isAccessLoss(err)) loseAccess(err);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, device, gate, pack?.generatedAt, deviceCall, loseAccess]);
  useEffect(() => {
    if (!eventId || revoked) return undefined;
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(id);
  }, [eventId, revoked, sendHeartbeat]);

  /** “Test connection”: device-authenticated round trip; shows latency, credential state and clock difference. */
  const testConnection = useCallback(async () => {
    const started = Date.now();
    setConnTest({ state: 'testing' });
    try {
      const res = await deviceCall({ method: 'get', url: '/checkin/ping', params: { eventId, deviceId: device }, timeout: 8000 });
      const ms = Date.now() - started;
      const skew = Math.round((Date.now() - ms / 2 - new Date(res.data.data.serverTime).getTime()) / 1000);
      noteOnline();
      setOnline(true);
      setConnTest({ state: 'ok', ms, skew, device: res.data.data.device, via: res.data.data.auth.via });
      sendHeartbeat();
    } catch (err) {
      if (!err.response) setOnline(false);
      setConnTest({ state: 'failed', message: err.response?.data?.message || 'No connection to the server' });
    }
  }, [eventId, device, deviceCall, sendHeartbeat]);

  /** A supervisor's request (Gate management → Devices), delivered over the socket to this device. */
  const supervisorAction = useCallback(async ({ action, requestedBy }) => {
    const who = requestedBy ? ` (${requestedBy})` : '';
    if (action === 'PING') {
      await sendHeartbeat();
      setSyncNote(`Supervisor${who} checked this device's connection.`);
    } else if (action === 'SYNC') {
      setSyncNote(`Supervisor${who} asked this device to upload now.`);
      await syncQueue({ manual: true });
      await sendHeartbeat();
    } else if (action === 'RETRY_FAILED') {
      const n = await retryFailed(eventId).catch(() => 0);
      setSyncNote(`Supervisor${who} asked to retry ${n} failed upload${n === 1 ? '' : 's'}.`);
      await syncQueue({ manual: true });
      await sendHeartbeat();
    } else if (action === 'SEND_PENDING') {
      const d = await scanDiagnostics(eventId).catch(() => null);
      if (d) await deviceCall({ method: 'post', url: '/checkin/devices/manifest', data: { eventId, deviceId: device, scans: d.manifest } }).catch(() => {});
      setSyncNote(`Supervisor${who} asked to see this device's scans waiting to upload (${d?.manifest.length || 0} sent).`);
    }
  }, [eventId, device, deviceCall, sendHeartbeat, syncQueue]);
  const supervisorActionRef = useRef(null);
  supervisorActionRef.current = supervisorAction;

  useEffect(() => {
    if (!eventId) return undefined;
    loadPack(eventId, user?.id).then((p) => p && setPack(p)).catch(() => {});
    refreshPack();
    loadStats();
    refreshQueue();
    syncQueue();
    const packTimer = setInterval(() => navigator.onLine && refreshPack(), PACK_REFRESH_MS);
    const syncTimer = setInterval(() => navigator.onLine && syncQueue(), 30000);
    const goOnline = () => {
      setOnline(true);
      backoffRef.current = { failures: 0, nextAt: 0 }; // the connection came back: try at once
      syncQueue();
      refreshPack();
      loadStats();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(packTimer);
      clearInterval(syncTimer);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [eventId, user?.id, refreshPack, loadStats, refreshQueue, syncQueue]);

  // Locked after more than 2 hours without a connection
  useEffect(() => {
    const check = () => setLocked(!online && offlineTooLong());
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [online]);

  // Live entry counter
  useEffect(() => {
    if (!eventId) return undefined;
    const socket = connectSocket();
    socket.on('connect', () => {
      socket.emit('join_event_room', eventId);
      if (user?.id) socket.emit('join_user_room', user.id);
    });
    socket.on('checkin:stats', (s) => s.eventId === eventId && setStats(s));
    socket.on('staff:access-revoked', (p) => p?.eventId === eventId && revoke());
    socket.on('gate:device-revoked', (p) => p?.deviceKey === device && revoke(true));
    // A supervisor reset this device's enrollment: drop the old credential and enroll again
    socket.on('gate:device-reset', async (p) => {
      if (p?.deviceKey !== device) return;
      await clearDeviceToken(companyId);
      tokenRef.current = null;
      needsResetRef.current = false;
      enroll();
    });
    socket.on('gate:assignments-changed', (p) => p?.eventId === eventId && refreshPack());
    socket.on('gate:device-action', (p) => p?.deviceKey === device && p.eventId === eventId && supervisorActionRef.current?.(p));
    socket.on('gate:exception-decided', (p) => setSyncNote(`Supervisor ${p.status === 'APPROVED' ? 'approved' : 'denied'} an exception request${p.note ? `: ${p.note}` : ''}.`));
    return () => {
      socket.emit('leave_event_room', eventId);
      socket.disconnect();
    };
  }, [eventId, user?.id, revoke, device, refreshPack, companyId, enroll]);

  // ---------- Gates from the event's setup (when configured) ----------
  const configured = (pack?.gates || []).filter((g) => g.active);
  const mine = pack?.myGateIds?.length && !pack.supervisor ? configured.filter((g) => pack.myGateIds.includes(g.id)) : configured;
  const gateRow = configured.find((g) => g.name === gate) || null;
  const gateOk = !gate ? false : configured.length ? mine.some((g) => g.name === gate) : true;
  const dir = gateRow?.type === 'EXIT' ? 'EXIT' : gateRow?.type === 'ENTRY' ? 'ENTRY' : direction;

  // ---------- Scanning ----------
  const show = useCallback((v) => {
    feedback(v.result);
    setVerdict({ ...v, shownAt: Date.now() });
    clearTimeout(resetTimer.current);
    if (v.result === 'GREEN') resetTimer.current = setTimeout(() => setVerdict(null), RESULT_HOLD_MS);
  }, []);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  /**
   * Decides a scan on the device and saves its record BEFORE the verdict is shown. If the record can't be saved
   * the verdict is red: nobody is admitted on a scan the device couldn't keep.
   */
  const decideOffline = useCallback(async (code, scanId) => {
    const p = pack || (await loadPack(eventId, user?.id).catch(() => null));
    const row = (p?.gates || []).find((g) => g.name === gate) || null;
    const v = p
      ? await evaluateOffline(p, code, gate, { direction: dir, gateRow: row })
      : { result: 'RED', reason: 'No connection and no offline list yet. Reconnect to download it.' };
    try {
      await recordScan({ scanId, eventId, ticketId: v.ticket?.id, code, gate, gateId: row?.id, direction: dir, localResult: v.result, localReason: v.reason, recordedBy: user?.id }, { sign: signScan });
    } catch (err) {
      console.error('[gate] could not save the offline scan', err);
      return { result: 'RED', reason: 'This device could not save the scan, so it can’t be admitted offline. Do not let the guest in; reconnect or use another device.', direction: dir, offline: true };
    } finally {
      refreshQueue();
    }
    return { ...v, direction: dir, offline: true };
  }, [pack, eventId, gate, dir, refreshQueue, user?.id]);

  const check = useCallback(async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busyRef.current || locked || revoked || !gateOk) return;
    busyRef.current = true;
    setChecking(true);
    let v;
    // One id per scan: sent with the online attempt and reused by the offline record if that attempt fails, so the
    // server can recognise the two as the same scan
    const scanId = newScanId();
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const res = await deviceCall({ method: 'post', url: '/checkin/scan', data: { code, eventId, gate, gateId: gateRow?.id, direction: dir, deviceId: device, clientScanId: scanId }, timeout: 6000 });
      v = res.data.data;
      noteOnline();
      setOnline(true);
      // Remember admissions on the device too, so an offline rescan here is yellow
      if (v.result === 'GREEN' && v.ticket?.id) {
        markUsedLocally(eventId, v.ticket.id, { at: v.ticket.checkedInAt || new Date().toISOString(), gate: v.ticket.gate || gate, inside: v.ticket.isInside, entries: v.ticket.entryCount, ...(dir === 'EXIT' ? { exitAt: new Date().toISOString() } : {}) }).catch(() => {});
      }
    } catch (err) {
      if (isAccessLoss(err)) {
        busyRef.current = false;
        setChecking(false);
        loseAccess(err);
        return;
      }
      if (err.response) {
        v = { result: 'RED', reason: err.response.data?.message || 'This ticket could not be checked.' };
      } else {
        setOnline(false);
        v = await decideOffline(code, scanId);
      }
    } finally {
      busyRef.current = false;
      setChecking(false);
    }
    show(v);
    lastScanRef.current = new Date().toISOString();
    setRecent((r) => [{ id: `${Date.now()}`, result: v.result, reason: v.reason, gate, direction: v.direction || dir, reentry: v.reentry, offline: Boolean(v.offline), scannedAt: new Date().toISOString(), holder: v.ticket?.holder, type: v.ticket?.type }, ...r].slice(0, 12));
    lastCodeRef.current = code;
  }, [eventId, gate, gateRow, gateOk, dir, device, locked, revoked, decideOffline, show, loseAccess, deviceCall]);

  // Ask a supervisor to let in someone the scanner turned away (online only)
  const lastCodeRef = useRef('');
  const requestException = async (reasonText) => {
    try {
      await deviceCall({ method: 'post', url: '/checkin/exceptions', data: { eventId, code: lastCodeRef.current || undefined, gate, gateId: gateRow?.id, scanResult: `${verdict?.result}: ${verdict?.reason || ''}`.slice(0, 300), reason: reasonText, deviceId: device } });
      return null;
    } catch (err) {
      return err.response?.data?.message || 'No connection: radio your supervisor instead.';
    }
  };

  const imageError = (message) => {
    if (!gateOk || locked || revoked) return;
    const v = { result: 'RED', reason: message };
    show(v);
    setRecent((r) => [{ id: `${Date.now()}`, result: 'RED', reason: message, gate, offline: false, scannedAt: new Date().toISOString() }, ...r].slice(0, 12));
  };
  const manualLookup = () => {
    setVerdict(null);
    setTimeout(() => document.getElementById(scanning ? 'gs-code-cam' : 'gs-code')?.focus(), 50);
  };
  const verdictEl = verdict && (
    <Verdict key={verdict.shownAt} verdict={verdict} eventName={event?.name} gate={`${gate}${dir === 'EXIT' ? ' · exit' : ''}`} online={online} onNext={() => setVerdict(null)} onManual={manualLookup} onException={online && !verdict.offline && verdict.result !== 'GREEN' ? requestException : null} />
  );

  const submitManual = (e) => {
    e.preventDefault();
    if (!manual.trim()) return;
    check(manual);
    setManual('');
  };

  // ---------- Render ----------
  if (!eventId) {
    return (
      <div className="tl-gs">
        <header className="tl-gs-head">
          <p className="tl-gs-eyebrow">Gate scanner · {user?.name}</p>
          <h1 className="tl-gs-title">Scan tickets</h1>
        </header>
        <EventPicker events={events} loading={eventsLoading} onPick={(id) => navigate(`/scanner?eventId=${id}`)} />
      </div>
    );
  }

  const entered = stats?.entered ?? 0;
  const sold = stats?.sold ?? pack?.tickets?.length ?? 0;
  const pct = sold ? Math.round((entered / sold) * 100) : 0;
  const manualForm = (dark) => (
    <form className={`tl-gs-manual${dark ? ' is-dark' : ''}`} onSubmit={submitManual}>
      <label htmlFor={dark ? 'gs-code-cam' : 'gs-code'} className="tl-gs-label"><Keyboard className="w-4 h-4" aria-hidden="true" /> Camera can’t read it? Type the code under the QR</label>
      <div className="tl-gs-manual-row">
        <input
          id={dark ? 'gs-code-cam' : 'gs-code'}
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="TL-7K3M-9QX2"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={!gateOk || locked}
        />
        <button type="submit" disabled={!manual.trim() || checking || !gateOk || locked}>{checking ? 'Checking…' : 'Check'}</button>
      </div>
    </form>
  );

  return (
    <div className="tl-gs">
      <header className="tl-gs-head">
        <Link to="/scanner" className="tl-gs-back"><ArrowLeft className="w-4 h-4" aria-hidden="true" /> All events</Link>
        <p className="tl-gs-eyebrow">Gate scanner · {user?.name}</p>
        <h1 className="tl-gs-title">{event?.name || 'Event'}</h1>
        <div className="tl-gs-badges">
          <span className={`tl-gs-badge ${online ? 'is-online' : 'is-offline'}`}>
            {online ? <><Wifi className="w-4 h-4" aria-hidden="true" /> Online</> : <><CloudOff className="w-4 h-4" aria-hidden="true" /> Offline · checking on this device</>}
          </span>
          <span className="tl-gs-badge">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            {pack?.tickets ? `Offline list: ${pack.tickets.length} tickets · ${ago(pack.savedAt)}` : packError || 'Downloading offline list…'}
          </span>
          {counts && counts.PENDING + counts.UPLOADING > 0 && (
            <button type="button" className="tl-gs-badge is-queue" onClick={() => setShowScans(true)}>
              <CloudUpload className="w-4 h-4" aria-hidden="true" /> {counts.PENDING + counts.UPLOADING} scan{counts.PENDING + counts.UPLOADING === 1 ? '' : 's'} waiting to upload{counts.UPLOADING ? ' · uploading' : ''}
            </button>
          )}
          {counts?.FAILED > 0 && (
            <button type="button" className="tl-gs-badge is-offline" onClick={() => setShowScans(true)}>
              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> {counts.FAILED} scan{counts.FAILED === 1 ? '' : 's'} failed to upload
            </button>
          )}
          {recovery?.error && queueCount > 0 && (
            <button type="button" className="tl-gs-badge is-offline" onClick={() => setShowScans(true)} title={recovery.error}>
              <CloudOff className="w-4 h-4" aria-hidden="true" /> Upload problem: {recovery.error}
            </button>
          )}
          {counts?.CONFLICT > 0 && (
            <button type="button" className="tl-gs-badge is-offline" onClick={() => setShowScans(true)}>
              <Users className="w-4 h-4" aria-hidden="true" /> {counts.CONFLICT} conflict{counts.CONFLICT === 1 ? '' : 's'} for the supervisor
            </button>
          )}
        </div>
      </header>

      {storeInfo?.error && (
        <p className="tl-gs-note" role="alert"><AlertTriangle className="w-4 h-4 inline" aria-hidden="true" /> Offline scans can’t be saved on this device ({storeInfo.error}). Don’t scan offline here; use another device.</p>
      )}
      {storeInfo?.migration && !storeInfo.migration.verified && (storeInfo.migration.imported > 0 || storeInfo.migration.error) && (
        <p className="tl-gs-note" role="alert"><AlertTriangle className="w-4 h-4 inline" aria-hidden="true" /> Some scans from the previous scanner version could not be checked after moving them. They are kept in both places; export them from “Scans on this device” and give the file to your supervisor.</p>
      )}

      {deviceAuth?.state === 'needs-reset' && (
        <p className="tl-gs-note" role="alert"><ShieldOff className="w-4 h-4 inline" aria-hidden="true" /> This device’s credential is missing. Ask a supervisor to reset its enrollment (Gate management → Devices); scans made offline stay on this device meanwhile.</p>
      )}
      {syncNote && <p className="tl-gs-note" role="status">{syncNote} <button type="button" onClick={() => setSyncNote('')} aria-label="Dismiss"><X className="w-4 h-4" /></button></p>}

      {dark && (() => {
        // Overview (console layout only): event details, quick actions, gate activity, status
        const d = event?.date ? new Date(event.date) : null;
        const today = new Date();
        const isToday = d && d.toDateString() === today.toDateString();
        const ended = d && !isToday && d < today;
        const gates = stats?.gates || [];
        const maxGate = Math.max(1, ...gates.map((g) => g.entered || 0));
        const results = stats?.scans || {};
        const problems = [
          !online && 'offline',
          counts?.FAILED > 0 && `${counts.FAILED} failed upload${counts.FAILED === 1 ? '' : 's'}`,
          counts?.CONFLICT > 0 && `${counts.CONFLICT} conflict${counts.CONFLICT === 1 ? '' : 's'}`,
          recovery?.error && 'upload problem',
          !pack?.tickets && 'offline list not ready',
        ].filter(Boolean);
        return (
          <div className="tl-sx">
            <section className="tl-sx-card tl-sx-details">
              <h2 className="tl-sx-title"><Info className="w-5 h-5" aria-hidden="true" /> Event details</h2>
              <dl>
                <div><dt>Event name</dt><dd>{event?.name || '—'}</dd></div>
                <div><dt>Date &amp; time</dt><dd>{d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}{event?.time ? ` • ${event.time}` : ''}</dd></div>
                <div><dt>Location</dt><dd>{[event?.venue, event?.city].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt>Tickets sold</dt><dd>{sold.toLocaleString()}</dd></div>
                <div>
                  <dt>Entered</dt>
                  <dd>
                    {entered.toLocaleString()} ({pct}%){stats?.inside != null ? ` · ${stats.inside} inside` : ''}
                    <span className="tl-sx-meter"><i style={{ width: `${pct}%` }} /></span>
                  </dd>
                </div>
              </dl>
              <a href={`/events/${eventId}`} target="_blank" rel="noreferrer" className="tl-sx-link">View event page <ExternalLink className="w-4 h-4" aria-hidden="true" /></a>
            </section>

            <section className="tl-sx-card tl-sx-actions">
              <h2 className="tl-sx-title"><Zap className="w-5 h-5" aria-hidden="true" /> Quick actions</h2>
              <button type="button" className="tl-sx-btn is-primary" onClick={() => setScanning(true)} disabled={!gateOk || locked}>
                <ScanLine className="w-5 h-5" aria-hidden="true" /> {gateOk ? 'Open scanner' : 'Choose a gate first'}
              </button>
              <button type="button" className="tl-sx-btn" onClick={() => setShowScans((v) => !v)} aria-expanded={showScans}>
                <HardDrive className="w-5 h-5" aria-hidden="true" /> {showScans ? 'Hide scans on this device' : 'Scans on this device'}
              </button>
              <button type="button" className="tl-sx-btn" onClick={testConnection} disabled={connTest?.state === 'testing'}>
                <Wifi className="w-5 h-5" aria-hidden="true" /> {connTest?.state === 'testing' ? 'Testing…' : 'Test connection'}
              </button>
              <Link to="/staff/events" className="tl-sx-btn"><CalendarDays className="w-5 h-5" aria-hidden="true" /> My events</Link>
            </section>

            <section className="tl-sx-card tl-sx-activity">
              <div className="tl-sx-head">
                <h2 className="tl-sx-title"><Activity className="w-5 h-5" aria-hidden="true" /> Scan activity</h2>
                <span className={`tl-sx-live${online ? '' : ' is-off'}`}><i aria-hidden="true" />{online ? 'Live' : 'Offline'}</span>
              </div>
              {gates.length ? (
                <ul className="tl-sx-bars" aria-label="Entries per gate">
                  {gates.map((g) => (
                    <li key={g.gate}>
                      <span>{g.gate}</span>
                      <span className="tl-sx-bar"><i style={{ width: `${Math.max(2, ((g.entered || 0) / maxGate) * 100)}%` }} /></span>
                      <b>{g.entered || 0}</b>
                    </li>
                  ))}
                </ul>
              ) : <p className="tl-sx-muted">No entries yet. Gate counts appear here as people enter.</p>}
              <div className="tl-sx-chips">
                <span className="is-good"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {results.GREEN ?? 0} admitted</span>
                <span className="is-warn"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> {results.YELLOW ?? 0} already used</span>
                <span className="is-bad"><X className="w-4 h-4" aria-hidden="true" /> {results.RED ?? 0} turned away</span>
              </div>
            </section>

            <section className="tl-sx-card tl-sx-status">
              <h2 className="tl-sx-title"><ShieldCheck className="w-5 h-5" aria-hidden="true" /> Event status</h2>
              <span className={`tl-sx-state${ended ? ' is-ended' : isToday ? '' : ' is-soon'}`} aria-hidden="true">
                {ended ? <Clock /> : isToday ? <Check /> : <CalendarDays />}
              </span>
              <strong>{ended ? 'Ended' : isToday ? 'Active' : 'Upcoming'}</strong>
              <p>{ended ? 'This event has ended.' : isToday ? (online ? 'Event is live and accepting scans.' : 'Event is live; scans are checked on this device.') : 'Gates open on the event day.'}</p>
            </section>

            <section className={`tl-sx-system${problems.length ? ' is-warn' : ''}`} role="status">
              <span className="tl-sx-system-icon" aria-hidden="true">{problems.length ? <AlertTriangle /> : <ShieldCheck />}</span>
              <div>
                <strong>{problems.length ? `Needs attention: ${problems.join(' · ')}` : 'All systems are running smoothly'}</strong>
                <span>{pack?.savedAt ? `Offline list updated ${ago(pack.savedAt)}` : 'Downloading the offline list…'}{connTest?.state === 'ok' ? ` · connected in ${connTest.ms} ms` : ''}</span>
              </div>
              <button type="button" className="tl-sx-refresh" onClick={loadStats}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh</button>
            </section>
          </div>
        );
      })()}

      {/* Gate */}
      <section className="tl-gs-card">
        <h2 className="tl-gs-h2">Your gate</h2>
        {configured.length > 0 ? (
          <div className="tl-gs-gates" role="radiogroup" aria-label="Gate">
            {mine.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={gate === g.name} className={gate === g.name ? 'is-on' : ''} onClick={() => chooseGate(g.name)}>
                {g.name}<small style={{ display: 'block', fontSize: 11, opacity: 0.7 }}>{g.type === 'ENTRY' ? 'Entry' : g.type === 'EXIT' ? 'Exit' : 'Entry & exit'}{g.allowedTierIds?.length ? ' · some ticket types' : ''}</small>
              </button>
            ))}
            {!mine.length && <p className="tl-gs-muted">You aren't assigned to an open gate at this event. Ask your supervisor.</p>}
          </div>
        ) : (
        <div className="tl-gs-gates" role="radiogroup" aria-label="Gate">
          {GATES.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={gate === g} className={gate === g ? 'is-on' : ''} onClick={() => chooseGate(g)}>{g}</button>
          ))}
          <form
            className="tl-gs-gate-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (customGate.trim()) chooseGate(customGate.trim());
              setCustomGate('');
            }}
          >
            <input value={customGate} onChange={(e) => setCustomGate(e.target.value)} placeholder="Other gate" maxLength={40} aria-label="Other gate name" />
          </form>
        </div>
        )}
        {!gateOk && <p className="tl-gs-muted">Choose the gate you’re standing at before scanning.</p>}
        {gateOk && (!gateRow || gateRow.type === 'ENTRY_EXIT') && (
          <div className="tl-gs-gates" role="radiogroup" aria-label="Scanning" style={{ marginTop: 12 }}>
            {[['ENTRY', 'Scanning entries'], ['EXIT', 'Scanning exits']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={direction === v} className={direction === v ? 'is-on' : ''} onClick={() => setDirection(v)}>{l}</button>
            ))}
          </div>
        )}
      </section>

      {/* Big scan button + counter */}
      <section className="tl-gs-hero">
        <button type="button" className="tl-gs-scan" onClick={() => setScanning(true)} disabled={!gateOk || locked}>
          <Camera className="w-7 h-7" aria-hidden="true" />
          <span>{gateOk ? (dir === 'EXIT' ? 'Scan exits' : 'Scan tickets') : 'Choose a gate first'}</span>
          <small>{gateOk ? `${gate}${dir === 'EXIT' ? ' · exits' : ''} · camera opens` : 'Then the camera opens'}</small>
        </button>
        <div className="tl-gs-count" aria-live="polite">
          <p><strong>{entered}</strong> / {sold} entered{stats?.inside != null && stats.inside !== entered ? ` · ${stats.inside} inside now` : ''}</p>
          <div className="tl-gs-meter"><i style={{ width: `${pct}%` }} /></div>
          <p className="tl-gs-muted">{stats?.gates?.length ? stats.gates.map((g) => `${g.gate}: ${g.entered}`).join(' · ') : 'Live · updates as people enter'}</p>
        </div>
      </section>

      <section className="tl-gs-card">
        <h2 className="tl-gs-h2">Scan from an image</h2>
        <p className="tl-gs-muted">For demos and testing: drop a screenshot of a ticket QR, or choose the file. It’s checked and marked used exactly like a camera scan.</p>
        <ImageScan disabled={!gateOk || locked} busy={checking} onCode={check} onError={imageError} />
      </section>

      <section className="tl-gs-card">{manualForm(false)}</section>

      <section className="tl-gs-card">
        <div className="tl-gs-recent-head">
          <h2 className="tl-gs-h2">Scans on this device</h2>
          <button type="button" className="tl-gs-icon" onClick={() => setShowScans((v) => !v)} aria-expanded={showScans}>{showScans ? 'Hide' : 'Show'}</button>
        </div>
        <p className="tl-gs-muted">
          {counts ? `${counts.unsynced} not uploaded · ${counts.SYNCED} uploaded · ${counts.CONFLICT} conflicts${counts.QUARANTINED ? ` · ${counts.QUARANTINED} handed in for review` : ''}` : 'Loading…'}
          {storeInfo && !storeInfo.error && ` · storage ${storeInfo.persisted ? 'kept by the browser' : 'may be cleared by the browser if the device runs low on space'}`}
        </p>
        <div className="tl-gs-gates" style={{ marginTop: 8 }}>
          <button type="button" onClick={testConnection} disabled={connTest?.state === 'testing'}><Wifi className="w-4 h-4 inline" aria-hidden="true" /> {connTest?.state === 'testing' ? 'Testing…' : 'Test connection'}</button>
        </div>
        {connTest && connTest.state !== 'testing' && (
          <p className="tl-gs-muted" role="status">
            {connTest.state === 'ok'
              ? `Connected · ${connTest.ms} ms · device ${connTest.device.enrolled ? 'enrolled' : 'not enrolled yet'}${Math.abs(connTest.skew) > 60 ? ` · this device's clock is ${Math.round(Math.abs(connTest.skew) / 60)} min ${connTest.skew > 0 ? 'ahead' : 'behind'}` : ''}`
              : `Connection test failed: ${connTest.message}`}
          </p>
        )}
        {recovery && (recovery.failures > 0 || recovery.recovered > 0) && (
          <p className="tl-gs-muted" role="status">
            {recovery.recovered > 0 && `Recovered ${recovery.recovered} interrupted upload${recovery.recovered === 1 ? '' : 's'}; they are sent again. `}
            {recovery.failures > 0 && recovery.nextAt && `${recovery.failures} upload attempt${recovery.failures === 1 ? '' : 's'} failed${recovery.error ? ` (${recovery.error})` : ''}. Next automatic try at ${clock(recovery.nextAt)}; “Upload now” tries at once.`}
          </p>
        )}
        {showScans && <DeviceScans eventId={eventId} counts={counts} online={online} onSync={syncQueue} onChange={refreshQueue} />}
      </section>

      {/* Recent scans */}
      <section className="tl-gs-card">
        <div className="tl-gs-recent-head">
          <h2 className="tl-gs-h2">Recent scans</h2>
          <button type="button" className="tl-gs-icon" onClick={loadStats} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>
        {recent.length === 0 ? (
          <p className="tl-gs-empty">No scans yet at this event.</p>
        ) : (
          <ul className="tl-gs-recent">
            {recent.map((r) => (
              <li key={r.id} className={`is-${r.result.toLowerCase()}`}>
                <i aria-hidden="true" />
                <span>
                  <strong>{r.result === 'GREEN' && r.direction === 'EXIT' ? 'Exit' : r.result === 'GREEN' && r.reentry ? 'Re-entry' : TITLES[r.result]}{r.holder ? ` · ${r.holder}` : ''}</strong>
                  <small>{r.result === 'GREEN' ? r.type || 'Ticket' : r.reason}{r.offline ? ' · offline' : ''}{r.conflict ? ' · conflict' : ''}</small>
                </span>
                <time>{clock(r.scannedAt)}{r.gate ? ` · ${r.gate}` : ''}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Full-screen camera */}
      {scanning && (
        <div className="tl-gs-camera" role="dialog" aria-modal="true" aria-label="Scan tickets">
          <div className="tl-gs-camera-top">
            <span>
              <strong>{event?.name}</strong>
              <small>{gate}{dir === 'EXIT' ? ' · exits' : ''} · {online ? 'Online' : 'Offline'} · {entered}/{sold} entered</small>
            </span>
            <button type="button" onClick={() => setScanning(false)} aria-label="Close the camera"><X className="w-6 h-6" /></button>
          </div>
          <QrCamera onDecode={check} paused={Boolean(verdict) || checking || locked} />
          {checking && <p className="tl-gs-checking" role="status"><RefreshCw className="w-5 h-5 tl-dash-spin" aria-hidden="true" /> Checking…</p>}
          <div className="tl-gs-camera-bottom">
            <p>Hold the QR inside the frame. Ask the guest to turn their screen brightness up.</p>
            <ImageScan compact disabled={!gateOk || locked} busy={checking} onCode={check} onError={imageError} />
            {manualForm(true)}
          </div>
          {verdictEl}
        </div>
      )}
      {!scanning && verdictEl}

      {revoked && (
        <div className="tl-gs-lock" role="alertdialog" aria-modal="true" aria-labelledby="gs-revoked-title">
          <ShieldOff className="w-12 h-12" aria-hidden="true" />
          <h2 id="gs-revoked-title">{revoked.device ? 'This scanner device was revoked' : 'Your access to this event was removed'}</h2>
          <p>
            {revoked.device ? 'A supervisor revoked this device, so it can no longer scan or download ticket lists, and its device credential was deleted.' : `You can no longer scan tickets for ${event?.name || 'this event'}.`} Its offline ticket list was deleted from this device.
            {revoked.kept ? ` ${revoked.kept} scan${revoked.kept === 1 ? '' : 's'} that hadn’t uploaded yet ${revoked.kept === 1 ? 'is' : 'are'} kept on this device as a record for your supervisor. Don’t clear this browser’s data.` : ''} Contact your organizer if this is a mistake.
          </p>
          <button type="button" onClick={() => navigate('/scanner')}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to my events</button>
        </div>
      )}

      {locked && (
        <div className="tl-gs-lock" role="alertdialog" aria-modal="true" aria-labelledby="gs-lock-title">
          <CloudOff className="w-12 h-12" aria-hidden="true" />
          <h2 id="gs-lock-title">Reconnect to keep scanning</h2>
          <p>This device has been offline since {lastOnline() ? clock(lastOnline()) : 'a while'}, more than 2 hours. Connect to the internet so the ticket list and the scans made here can sync.</p>
          <button type="button" onClick={() => { refreshPack(); syncQueue({ manual: true }); }}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try to reconnect</button>
        </div>
      )}
    </div>
  );
}
