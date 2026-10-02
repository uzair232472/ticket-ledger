import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DashHead, Kpi, Chip, Status } from '../components/dash/DashShell';
import { ArcGauge, SERIES, NEUTRAL } from '../components/dash/charts';
import {
  ShieldCheck,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Camera,
  Play,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Info,
  XCircle,
} from 'lucide-react';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

const GATES = [
  'Gate 1 - Main Pavilion',
  'Gate 2 - VIP Enclosure',
  'Gate 3 - First Class Turnstile',
  'Gate 4 - General Stand West',
  'Gate 5 - Media & Staff',
];

const resultTone = (r) => (r?.valid ? 'good' : r?.result === 'ALREADY_SCANNED' ? 'warn' : 'bad');
const RESULT_LABEL = { VALID_FIRST_SCAN: 'Admitted', ALREADY_SCANNED: 'Double entry', INVALID_SCAN: 'Invalid' };

export default function GateScanner() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  // Event chosen on the Select Event screen (/staff/events); the API only admits tickets for assigned events
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const [myEvents, setMyEvents] = useState([]);

  const [gateNumber, setGateNumber] = useState(GATES[0]);
  const [offlineMode, setOfflineMode] = useState(false);
  const [rawPayloadInput, setRawPayloadInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [scannerStats, setScannerStats] = useState({ total: 0, valid: 0, doubleEntryBlocked: 0, rejected: 0 });

  const fetchRecentScans = async () => {
    setLoadingRecent(true);
    try {
      const eventQuery = eventId ? `&eventId=${encodeURIComponent(eventId)}` : '';
      const res = await fetch(`${API_BASE}/gate/recent-scans?limit=15${eventQuery}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.data?.scans) {
        const scans = data.data.scans;
        setRecentScans(scans);
        setScannerStats({
          total: scans.length,
          valid: scans.filter((s) => s.result === 'VALID_FIRST_SCAN').length,
          doubleEntryBlocked: scans.filter((s) => s.result === 'ALREADY_SCANNED').length,
          rejected: scans.filter((s) => s.result === 'INVALID_SCAN').length,
        });
      }
    } catch (err) {
      console.error('Error fetching recent scans:', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    if (token) fetchRecentScans();
  }, [token, eventId]);

  // The events this account may scan for (scope picker)
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/staff/my-events`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setMyEvents(data.data?.events || []))
      .catch(() => setMyEvents([]));
  }, [token]);
  const activeEvent = myEvents.find((e) => e.id === eventId) || null;

  const handleProcessScan = async (payloadToScan) => {
    const payload = payloadToScan || rawPayloadInput.trim();
    if (!payload) return;
    setScanning(true);
    setLastScanResult(null);
    try {
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (e) {
        parsedPayload = payload;
      }
      const res = await fetch(`${API_BASE}/gate/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: parsedPayload, gateNumber, offlineMode }),
      });
      const data = await res.json();
      setLastScanResult({
        statusCode: res.status,
        valid: data.valid ?? data.success,
        result: data.result,
        reason: data.reason,
        message: data.message,
        ticket: data.ticket,
        scannedAt: new Date().toLocaleTimeString(),
      });
      fetchRecentScans();
    } catch (err) {
      setLastScanResult({ statusCode: 500, valid: false, result: 'ERROR', message: `Network error: ${err.message}` });
    } finally {
      setScanning(false);
    }
  };

  const blocked = scannerStats.doubleEntryBlocked + scannerStats.rejected;
  const tone = resultTone(lastScanResult);

  return (
    <div className="tl-scan">
      <DashHead eyebrow={`Gate console · ${user?.name || ''}`} title="Scanner" />

      {/* Controls */}
      <div className="tl-scan-bar">
        <div className="tl-scan-mode" role="group" aria-label="Verification mode">
          <button type="button" aria-pressed={!offlineMode} onClick={() => setOfflineMode(false)}><i aria-hidden="true" />Online</button>
          <button type="button" aria-pressed={offlineMode} onClick={() => setOfflineMode(true)}><i aria-hidden="true" />Offline</button>
        </div>
        <p className={`tl-scan-sys${offlineMode ? ' is-offline' : ''}`}>
          <strong>{offlineMode ? 'Offline mode' : 'System online'}</strong>
          <span>{offlineMode ? 'Signature check only · synced when back online.' : 'Live server verification · Duplicate entry blocked.'}</span>
        </p>
        <label className="tl-scan-field">
          <span>Gate</span>
          <select value={gateNumber} onChange={(e) => setGateNumber(e.target.value)}>
            {GATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="tl-scan-field">
          <span>Scanning scope</span>
          <select value={eventId || ''} onChange={(e) => navigate(e.target.value ? `/scanner?eventId=${e.target.value}` : '/scanner')}>
            <option value="">All your events</option>
            {myEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </label>
        <div className="tl-scan-bar-actions">
          <Link to="/staff/events" className="tl-scan-choose"><ArrowLeftRight className="w-4 h-4" /> Choose event</Link>
          <button type="button" className="tl-st-icon-btn" onClick={fetchRecentScans} aria-label="Refresh scans">
            <RefreshCw className={`w-4 h-4 ${loadingRecent ? 'tl-dash-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Counts */}
      <div className="tl-scan-kpis">
        <Kpi label="Scans" color="#2563eb" value={scannerStats.total} chips={[<Chip key="r" icon={QrCode}>{activeEvent ? 'Latest at this event' : 'Latest across your events'}</Chip>]} />
        <Kpi label="Admitted" color="#16a34a" value={scannerStats.valid} chips={[<Chip key="a" icon={TrendingUp}>Entry granted</Chip>]} />
        <Kpi
          label="Blocked"
          color="#d97706"
          value={blocked}
          chips={[<Chip key="d" tone="warn" icon={TrendingDown}>{scannerStats.doubleEntryBlocked} double entries</Chip>, <Chip key="i" tone="bad" icon={TrendingDown}>{scannerStats.rejected} invalid</Chip>]}
        />
      </div>

      <div className="tl-scan-grid">
        {/* Scan a pass */}
        <section className="tl-scan-card" aria-labelledby="tl-scan-pass">
          <h2 id="tl-scan-pass">Scan a pass</h2>
          <p className="tl-scan-sub">Present the current rotating QR from the attendee’s ticket.</p>
          <div className="tl-scan-camera">
            <span className="tl-scan-corner is-tl" aria-hidden="true" />
            <span className="tl-scan-corner is-tr" aria-hidden="true" />
            <span className="tl-scan-corner is-bl" aria-hidden="true" />
            <span className="tl-scan-corner is-br" aria-hidden="true" />
            <Camera className="w-10 h-10" aria-hidden="true" />
            <strong>Camera ready</strong>
            <span>The QR rotates every few seconds, so screenshots are rejected.</span>
          </div>
          <div className="tl-scan-manual">
            <h3>Manual entry</h3>
            <label htmlFor="tl-scan-payload">Pass payload (JSON)</label>
            <textarea
              id="tl-scan-payload"
              rows={3}
              value={rawPayloadInput}
              onChange={(e) => setRawPayloadInput(e.target.value)}
              placeholder='{"ticketId": "...", "nonce": "...", "signature": "..."}'
            />
            <button type="button" className="tl-scan-verify" disabled={scanning || !rawPayloadInput.trim()} onClick={() => handleProcessScan()}>
              {scanning ? <><RefreshCw className="w-4 h-4 tl-dash-spin" /> Verifying…</> : <><Play className="w-4 h-4" /> Verify and open turnstile</>}
            </button>
          </div>
        </section>

        {/* Verification result */}
        <section className="tl-scan-card tl-scan-resultcard" aria-labelledby="tl-scan-result" aria-live="polite">
          <h2 id="tl-scan-result">Verification result</h2>
          {lastScanResult ? (
            <div className={`tl-scan-verdict2 is-${tone}`}>
              <div className="tl-scan-verdict2-head">
                {lastScanResult.valid ? <CheckCircle2 className="w-9 h-9" /> : tone === 'warn' ? <AlertTriangle className="w-9 h-9" /> : <XCircle className="w-9 h-9" />}
                <div>
                  <p>{gateNumber} · {lastScanResult.scannedAt}</p>
                  <h3>{lastScanResult.valid ? 'Access granted' : 'Access denied'}</h3>
                </div>
              </div>
              <p className="tl-scan-msg">{lastScanResult.message}</p>
              {lastScanResult.reason && <p className="tl-scan-reason">Reason · {lastScanResult.reason}</p>}
              {lastScanResult.ticket && (
                <>
                  <p className="tl-scan-attendee"><span>Attendee</span>{lastScanResult.ticket.attendee?.name || lastScanResult.ticket.attendee || 'Ticket holder'}</p>
                  <dl className="tl-scan-seat2">
                    <div><dt>Tier</dt><dd>{lastScanResult.ticket.seat?.tierName || 'Standard'}</dd></div>
                    <div><dt>Row</dt><dd>{lastScanResult.ticket.seat?.row || 'GA'}</dd></div>
                    <div><dt>Seat</dt><dd>#{lastScanResult.ticket.seat?.seatNumber || '1'}</dd></div>
                  </dl>
                </>
              )}
            </div>
          ) : (
            <div className="tl-scan-waiting">
              <ShieldCheck className="w-11 h-11" aria-hidden="true" />
              <h3>Waiting for a pass</h3>
              <p>Decision, attendee and seat details appear after scanning.</p>
            </div>
          )}
          {!lastScanResult && (
            <div className="tl-scan-note">
              <Info className="w-5 h-5" aria-hidden="true" />
              <div><strong>No ticket scanned yet</strong><span>Scan a QR code or enter a ticket payload to see verification details here.</span></div>
            </div>
          )}
        </section>
      </div>

      {/* Recent scans */}
      <section className="tl-scan-card tl-scan-recent" aria-labelledby="tl-scan-recent">
        <header className="tl-scan-recent-head">
          <div>
            <h2 id="tl-scan-recent">Recent scans</h2>
            <p className="tl-scan-gate">{gateNumber}</p>
          </div>
          <div className="tl-scan-legend">
            <span><i className="is-good" aria-hidden="true" />Admitted {scannerStats.valid}</span>
            <span><i className="is-warn" aria-hidden="true" />Double entry {scannerStats.doubleEntryBlocked}</span>
            <span><i className="is-bad" aria-hidden="true" />Invalid {scannerStats.rejected}</span>
          </div>
        </header>
        <div className="tl-scan-gauge">
          <ArcGauge
            value={scannerStats.total}
            caption="Recent scans"
            parts={[
              { label: 'Admitted', value: scannerStats.valid, color: SERIES[0] },
              { label: 'Double entry', value: scannerStats.doubleEntryBlocked, color: SERIES[2] },
              { label: 'Invalid', value: scannerStats.rejected, color: NEUTRAL },
            ]}
          />
        </div>
        {recentScans.length === 0 ? (
          <div className="tl-scan-empty">
            <p><QrCode className="w-5 h-5" aria-hidden="true" /> {loadingRecent ? 'Loading scans…' : 'No scans recorded yet.'}</p>
            <span>Scanned tickets will appear here with time, attendee details and verification result.</span>
          </div>
        ) : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead>
                <tr><th>Attendee</th><th>Seat</th><th>Gate</th><th>Result</th><th className="is-num">Time</th></tr>
              </thead>
              <tbody>
                {recentScans.slice(0, 10).map((scan) => (
                  <tr key={scan.id}>
                    <td>
                      <div className="tl-cell-main">{scan.ticket?.user?.name || 'Attendee'}</div>
                      <div className="tl-cell-sub">{scan.ticket?.event?.name}</div>
                    </td>
                    <td className="is-mono">{scan.ticket?.seat?.tier?.name || '—'} · R{scan.ticket?.seat?.row ?? '–'} #{scan.ticket?.seat?.seatNumber ?? '–'}</td>
                    <td className="is-mono">{(scan.gateNumber || 'Gate 1').split(' - ')[0]}</td>
                    <td><Status value={scan.result} label={RESULT_LABEL[scan.result] || 'Invalid'} /></td>
                    <td className="is-num is-mono">{new Date(scan.scanTime).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
