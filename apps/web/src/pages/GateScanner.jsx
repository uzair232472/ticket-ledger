import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  AlertTriangle, ArrowLeft, Camera, ShieldOff, CheckCircle2, CloudOff, CloudUpload, Keyboard, MapPin, RefreshCw, ScanLine, ShieldCheck, Wifi, X, XCircle,
} from 'lucide-react';
import api from '../utils/api';
import { API_URL } from '../lib/session';
import { useAuth } from '../context/AuthContext';
import QrCamera from '../components/scanner/QrCamera';
import {
  deviceId as getDeviceId, enqueue, dequeue, queued, evaluateOffline, loadPack, savePack, markUsedLocally, noteOnline, offlineTooLong, lastOnline, wipeEvent,
} from '../lib/gateOffline';
import '../components/scanner/scanner.css';

const GATES = ['Gate A', 'Gate B', 'Gate C', 'Gate D', 'Gate E', 'VIP Gate'];
const PACK_REFRESH_MS = 3 * 60 * 1000;
const RESULT_HOLD_MS = 2000;
const TITLES = { GREEN: 'Entry allowed', YELLOW: 'Already scanned', RED: 'Not valid' };
const ICONS = { GREEN: CheckCircle2, YELLOW: AlertTriangle, RED: XCircle };

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

/** Full-screen verdict: colour, icon, reason and the ticket, then back to scanning. */
function Verdict({ verdict, gate, onDone }) {
  const Icon = ICONS[verdict.result];
  return (
    <button type="button" className={`tl-gs-verdict is-${verdict.result.toLowerCase()}`} onClick={onDone} aria-live="assertive">
      <Icon className="tl-gs-verdict-icon" aria-hidden="true" />
      <strong>{TITLES[verdict.result]}</strong>
      <span className="tl-gs-verdict-reason">{verdict.result === 'GREEN' ? `${verdict.ticket?.holder || 'Guest'} · ${verdict.ticket?.type || 'Ticket'}` : verdict.reason}</span>
      {verdict.ticket && <span className="tl-gs-verdict-seat">{verdict.ticket.seat}</span>}
      <span className="tl-gs-verdict-foot">
        {verdict.offline && <em><CloudOff className="w-4 h-4" aria-hidden="true" /> Offline</em>}
        {gate} · tap to scan the next ticket
      </span>
    </button>
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
  const [revoked, setRevoked] = useState(null); // { dropped } once access to this event is removed
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
  const revoke = useCallback(async () => {
    if (!eventId) return;
    const dropped = await wipeEvent(eventId).catch(() => 0);
    setPack(null);
    setQueueCount(0);
    setScanning(false);
    setVerdict(null);
    setRevoked({ dropped });
    setEvents((list) => list.filter((e) => e.id !== eventId));
  }, [eventId]);

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
      const res = await api.get(`/checkin/events/${eventId}/pack`);
      await savePack(eventId, res.data.data, user?.id);
      setPack({ ...res.data.data, savedAt: Date.now() });
      setPackError('');
      noteOnline();
      setOnline(true);
    } catch (err) {
      if (err.response?.status === 403) {
        revoke();
        return;
      }
      if (!err.response) setOnline(false);
      else setPackError(err.response.data?.message || 'Could not download the offline list.');
      const cached = await loadPack(eventId, user?.id).catch(() => null);
      if (cached) setPack(cached);
    }
  }, [eventId, user?.id, revoke]);

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
          scans: batch.map(({ clientId, code, gate: g, scannedAt, localResult, localReason }) => ({ clientId, code, gate: g || undefined, scannedAt, localResult, localReason: localReason?.slice(0, 200) })),
        });
        conflicts += res.data.data.conflicts;
        await dequeue(batch.map((b) => b.clientId));
      }
      noteOnline();
      setOnline(true);
      setSyncNote(`${items.length} offline scan${items.length === 1 ? '' : 's'} uploaded${conflicts ? ` · ${conflicts} flagged for the organizer (admitted twice while offline)` : ''}.`);
      loadStats();
    } catch (err) {
      if (err.response?.status === 403) revoke();
      else if (!err.response) setOnline(false);
    } finally {
      refreshQueue();
    }
  }, [eventId, device, loadStats, refreshQueue, revoke]);

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
    return () => {
      socket.emit('leave_event_room', eventId);
      socket.disconnect();
    };
  }, [eventId, user?.id, revoke]);

  // ---------- Scanning ----------
  const show = useCallback((v) => {
    feedback(v.result);
    setVerdict(v);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setVerdict(null), RESULT_HOLD_MS + (v.result === 'GREEN' ? 0 : 1200));
  }, []);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const decideOffline = useCallback(async (code) => {
    const p = pack || (await loadPack(eventId, user?.id).catch(() => null));
    if (!p) return { result: 'RED', reason: 'No connection and no offline list yet. Reconnect to download it.', offline: true };
    const v = await evaluateOffline(p, code, gate);
    await enqueue({ clientId: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, eventId, code, gate, scannedAt: new Date().toISOString(), localResult: v.result, localReason: v.reason });
    refreshQueue();
    return { ...v, offline: true };
  }, [pack, eventId, gate, refreshQueue, user?.id]);

  const check = useCallback(async (raw) => {
    const code = String(raw || '').trim();
    if (!code || busyRef.current || locked || revoked || !gate) return;
    busyRef.current = true;
    setChecking(true);
    let v;
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const res = await api.post('/checkin/scan', { code, eventId, gate, deviceId: device }, { timeout: 6000 });
      v = res.data.data;
      noteOnline();
      setOnline(true);
      // Remember admissions on the device too, so an offline rescan here is yellow
      if (v.result === 'GREEN' && v.ticket?.id) markUsedLocally(eventId, v.ticket.id, { at: new Date().toISOString(), gate }).catch(() => {});
    } catch (err) {
      if (err.response?.status === 403) {
        busyRef.current = false;
        setChecking(false);
        revoke();
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
    setRecent((r) => [{ id: `${Date.now()}`, result: v.result, reason: v.reason, gate, offline: Boolean(v.offline), scannedAt: new Date().toISOString(), holder: v.ticket?.holder, type: v.ticket?.type }, ...r].slice(0, 12));
  }, [eventId, gate, device, locked, revoked, decideOffline, show, revoke]);

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
          disabled={!gate || locked}
        />
        <button type="submit" disabled={!manual.trim() || checking || !gate || locked}>{checking ? 'Checking…' : 'Check'}</button>
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
        {!gate && <p className="tl-gs-muted">Choose the gate you’re standing at before scanning.</p>}
      </section>

      {/* Big scan button + counter */}
      <section className="tl-gs-hero">
        <button type="button" className="tl-gs-scan" onClick={() => setScanning(true)} disabled={!gate || locked}>
          <Camera className="w-7 h-7" aria-hidden="true" />
          <span>{gate ? 'Scan tickets' : 'Choose a gate first'}</span>
          <small>{gate ? `${gate} · camera opens` : 'Then the camera opens'}</small>
        </button>
        <div className="tl-gs-count" aria-live="polite">
          <p><strong>{entered}</strong> / {sold} entered</p>
          <div className="tl-gs-meter"><i style={{ width: `${pct}%` }} /></div>
          <p className="tl-gs-muted">{stats?.gates?.length ? stats.gates.map((g) => `${g.gate}: ${g.entered}`).join(' · ') : 'Live · updates as people enter'}</p>
        </div>
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
                  <strong>{TITLES[r.result]}{r.holder ? ` · ${r.holder}` : ''}</strong>
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
              <small>{gate} · {online ? 'Online' : 'Offline'} · {entered}/{sold} entered</small>
            </span>
            <button type="button" onClick={() => setScanning(false)} aria-label="Close the camera"><X className="w-6 h-6" /></button>
          </div>
          <QrCamera onDecode={check} paused={Boolean(verdict) || checking || locked} />
          {checking && <p className="tl-gs-checking" role="status"><RefreshCw className="w-5 h-5 tl-dash-spin" aria-hidden="true" /> Checking…</p>}
          <div className="tl-gs-camera-bottom">
            <p>Hold the QR inside the frame. Ask the guest to turn their screen brightness up.</p>
            {manualForm(true)}
          </div>
          {verdict && <Verdict verdict={verdict} gate={gate} onDone={() => setVerdict(null)} />}
        </div>
      )}
      {!scanning && verdict && <Verdict verdict={verdict} gate={gate} onDone={() => setVerdict(null)} />}

      {revoked && (
        <div className="tl-gs-lock" role="alertdialog" aria-modal="true" aria-labelledby="gs-revoked-title">
          <ShieldOff className="w-12 h-12" aria-hidden="true" />
          <h2 id="gs-revoked-title">Your access to this event was removed</h2>
          <p>
            You can no longer scan tickets for {event?.name || 'this event'}. Its offline ticket list was deleted from this device
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
