import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  AlertTriangle, ArrowLeft, Armchair, Camera, Check, ChevronRight, Clock, ShieldOff, CheckCircle2, CloudOff, CloudUpload, ImageUp, Info, Keyboard, MapPin,
  RefreshCw, ScanLine, ShieldCheck, Tag, Ticket, User, Users, Wifi, X,
} from 'lucide-react';
import api from '../utils/api';
import { API_URL } from '../lib/session';
import { useAuth } from '../context/AuthContext';
import QrCamera from '../components/scanner/QrCamera';
import { decodeQrFromFile } from '../lib/qrImage';
import {
  deviceId as getDeviceId, enqueue, dequeue, queued, evaluateOffline, loadPack, savePack, markUsedLocally, noteOnline, offlineTooLong, lastOnline, wipeEvent,
} from '../lib/gateOffline';
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
          <p className="tl-gv-ok"><CheckCircle2 aria-hidden="true" /> Ticket valid • Ownership verified</p>
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
  const [queueCount, setQueueCount] = useState(0);
  const [syncNote, setSyncNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState('');
  const [locked, setLocked] = useState(false);
  const [revoked, setRevoked] = useState(null); // { dropped, device? } once access to this event (or this device) is removed
  const [direction, setDirection] = useState('ENTRY'); // at gates that take both
  const busyRef = useRef(false);
  const resetTimer = useRef(null);

  const event = events.find((e) => e.id === eventId) || pack?.event || null;

  // ---------- Events and gate ----------
  useEffect(() => {
    api.get('/checkin/events')
      .then((res) => setEvents(res.data.data.events))
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false));
  }, []);
  // Access to this event was removed: wipe the device's copy and stop scanning (online or offline)
  const revoke = useCallback(async (device = false) => {
    if (!eventId) return;
    const dropped = await wipeEvent(eventId).catch(() => 0);
    setPack(null);
    setQueueCount(0);
    setScanning(false);
    setVerdict(null);
    setRevoked({ dropped, device });
    if (!device) setEvents((list) => list.filter((e) => e.id !== eventId));
  }, [eventId]);
  // A 403 means: this device was revoked, or this account lost the event (other refusals are shown as a verdict)
  const isAccessLoss = (err) => err.response?.status === 403 && (!err.response.data?.code || err.response.data.code === 'DEVICE_REVOKED');
  const loseAccess = useCallback((err) => revoke(err.response?.data?.code === 'DEVICE_REVOKED'), [revoke]);

  useEffect(() => {
    setRevoked(null);
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
  const refreshQueue = useCallback(async () => setQueueCount((await queued(eventId)).length), [eventId]);

  const refreshPack = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await api.get(`/checkin/events/${eventId}/pack`, { params: { deviceId: device } });
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
  }, [eventId, user?.id, loseAccess, device]);

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

  const syncQueue = useCallback(async () => {
    if (!eventId) return;
    const items = await queued(eventId);
    if (!items.length) return;
    try {
      let conflicts = 0;
      for (let i = 0; i < items.length; i += 200) {
        const batch = items.slice(i, i + 200);
        const res = await api.post('/checkin/sync', {
          eventId,
          deviceId: device,
          pending: items.length - i,
          scans: batch.map(({ clientId, code, gate: g, gateId: gid, direction: dir, scannedAt, localResult, localReason }) => ({ clientId, code, gate: g || undefined, gateId: gid || undefined, direction: dir || 'ENTRY', scannedAt, localResult, localReason: localReason?.slice(0, 200) })),
        });
        conflicts += res.data.data.conflicts;
        await dequeue(batch.map((b) => b.clientId));
      }
      noteOnline();
      setOnline(true);
      setSyncNote(`${items.length} offline scan${items.length === 1 ? '' : 's'} uploaded${conflicts ? ` · ${conflicts} flagged for the organizer (admitted twice while offline)` : ''}.`);
      loadStats();
    } catch (err) {
      if (isAccessLoss(err)) loseAccess(err);
      else if (!err.response) setOnline(false);
    } finally {
      refreshQueue();
    }
  }, [eventId, device, loadStats, refreshQueue, loseAccess]);

  // Sync status for supervisors: every 30 s the device reports its gate, waiting scans and list age
  const queueRef = useRef(0);
  queueRef.current = queueCount;
  useEffect(() => {
    if (!eventId || revoked) return undefined;
    const beat = () => {
      if (!navigator.onLine) return;
      api.post('/checkin/heartbeat', { eventId, deviceId: device, gate: gate || undefined, pending: queueRef.current, online: true, packAt: pack?.generatedAt })
        .catch((err) => isAccessLoss(err) && loseAccess(err));
    };
    beat();
    const id = setInterval(beat, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, device, gate, revoked, pack?.generatedAt]);

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
    const socket = io(import.meta.env.VITE_SOCKET_URL || API_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('join_event_room', eventId);
      if (user?.id) socket.emit('join_user_room', user.id);
    });
    socket.on('checkin:stats', (s) => s.eventId === eventId && setStats(s));
    socket.on('staff:access-revoked', (p) => p?.eventId === eventId && revoke());
    socket.on('gate:device-revoked', (p) => p?.deviceKey === device && revoke(true));
    socket.on('gate:assignments-changed', (p) => p?.eventId === eventId && refreshPack());
    socket.on('gate:exception-decided', (p) => setSyncNote(`Supervisor ${p.status === 'APPROVED' ? 'approved' : 'denied'} an exception request${p.note ? `: ${p.note}` : ''}.`));
    return () => {
      socket.emit('leave_event_room', eventId);
      socket.disconnect();
    };
  }, [eventId, user?.id, revoke, device, refreshPack]);

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

  const decideOffline = useCallback(async (code) => {
    const p = pack || (await loadPack(eventId, user?.id).catch(() => null));
    if (!p) return { result: 'RED', reason: 'No connection and no offline list yet. Reconnect to download it.', offline: true };
    const row = (p.gates || []).find((g) => g.name === gate) || null;
    const v = await evaluateOffline(p, code, gate, { direction: dir, gateRow: row });
    await enqueue({ clientId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, eventId, code, gate, gateId: row?.id, direction: dir, scannedAt: new Date().toISOString(), localResult: v.result, localReason: v.reason });
    refreshQueue();
    return { ...v, direction: dir, offline: true };
  }, [pack, eventId, gate, dir, refreshQueue, user?.id]);

  const check = useCallback(async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busyRef.current || locked || revoked || !gateOk) return;
    busyRef.current = true;
    setChecking(true);
    let v;
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const res = await api.post('/checkin/scan', { code, eventId, gate, gateId: gateRow?.id, direction: dir, deviceId: device }, { timeout: 6000 });
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
        v = await decideOffline(code);
      }
    } finally {
      busyRef.current = false;
      setChecking(false);
    }
    show(v);
    setRecent((r) => [{ id: `${Date.now()}`, result: v.result, reason: v.reason, gate, direction: v.direction || dir, reentry: v.reentry, offline: Boolean(v.offline), scannedAt: new Date().toISOString(), holder: v.ticket?.holder, type: v.ticket?.type }, ...r].slice(0, 12));
    lastCodeRef.current = code;
  }, [eventId, gate, gateRow, gateOk, dir, device, locked, revoked, decideOffline, show, loseAccess]);

  // Ask a supervisor to let in someone the scanner turned away (online only)
  const lastCodeRef = useRef('');
  const requestException = async (reasonText) => {
    try {
      await api.post('/checkin/exceptions', { eventId, code: lastCodeRef.current || undefined, gate, gateId: gateRow?.id, scanResult: `${verdict?.result}: ${verdict?.reason || ''}`.slice(0, 300), reason: reasonText, deviceId: device });
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
          {queueCount > 0 && (
            <button type="button" className="tl-gs-badge is-queue" onClick={syncQueue}>
              <CloudUpload className="w-4 h-4" aria-hidden="true" /> {queueCount} scan{queueCount === 1 ? '' : 's'} waiting to upload
            </button>
          )}
        </div>
      </header>

      {syncNote && <p className="tl-gs-note" role="status">{syncNote} <button type="button" onClick={() => setSyncNote('')} aria-label="Dismiss"><X className="w-4 h-4" /></button></p>}

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
            {revoked.device ? 'A supervisor revoked this device, so it can no longer scan or download ticket lists.' : `You can no longer scan tickets for ${event?.name || 'this event'}.`} Its offline ticket list was deleted from this device
            {revoked.dropped ? `, along with ${revoked.dropped} scan${revoked.dropped === 1 ? '' : 's'} that hadn’t uploaded yet` : ''}. Contact your organizer if this is a mistake.
          </p>
          <button type="button" onClick={() => navigate('/scanner')}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to my events</button>
        </div>
      )}

      {locked && (
        <div className="tl-gs-lock" role="alertdialog" aria-modal="true" aria-labelledby="gs-lock-title">
          <CloudOff className="w-12 h-12" aria-hidden="true" />
          <h2 id="gs-lock-title">Reconnect to keep scanning</h2>
          <p>This device has been offline since {lastOnline() ? clock(lastOnline()) : 'a while'}, more than 2 hours. Connect to the internet so the ticket list and the scans made here can sync.</p>
          <button type="button" onClick={() => { refreshPack(); syncQueue(); }}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try to reconnect</button>
        </div>
      )}
    </div>
  );
}
