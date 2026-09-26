import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  MapPin,
  Calendar,
  User,
  Ticket as TicketIcon,
  Wifi,
  WifiOff,
  Camera,
  Play,
  Copy,
  Check,
  Search,
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

export default function GateScanner() {
  const { user, token } = useAuth();

  const [gateNumber, setGateNumber] = useState('Gate 1 - Main Pavilion');
  const [offlineMode, setOfflineMode] = useState(false);
  const [rawPayloadInput, setRawPayloadInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [recentScans, setRecentScans] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [scannerStats, setScannerStats] = useState({
    total: 0,
    valid: 0,
    doubleEntryBlocked: 0,
    rejected: 0,
  });

  // Fetch recent scans
  const fetchRecentScans = async () => {
    setLoadingRecent(true);
    try {
      const res = await fetch(`${API_BASE}/gate/recent-scans?limit=15`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data?.scans) {
        setRecentScans(data.data.scans);
        // Calculate session stats
        const total = data.data.scans.length;
        const valid = data.data.scans.filter((s) => s.result === 'VALID_FIRST_SCAN').length;
        const doubleEntry = data.data.scans.filter((s) => s.result === 'ALREADY_SCANNED').length;
        const rejected = data.data.scans.filter((s) => s.result === 'INVALID_SCAN').length;
        setScannerStats({ total, valid, doubleEntryBlocked: doubleEntry, rejected });
      }
    } catch (err) {
      console.error('Error fetching recent scans:', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchRecentScans();
    }
  }, [token]);

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          payload: parsedPayload,
          gateNumber,
          offlineMode,
        }),
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

      // Refresh recent feed
      fetchRecentScans();
    } catch (err) {
      setLastScanResult({
        statusCode: 500,
        valid: false,
        result: 'ERROR',
        message: `Network error: ${err.message}`,
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Stadium Gate Control System
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                offlineMode ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-teal-950 text-teal-300 border border-teal-800'
              }`}>
                {offlineMode ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                {offlineMode ? 'Offline HMAC Verification Mode' : 'Online Real-Time Sync'}
              </span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight mt-1">
              Gate Staff Turnstile Scanner
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Verifies rotating dynamic QR codes, prevents screenshot fraud, strictly rejects double-entry, and audits check-in timestamps.
            </p>
          </div>

          {/* Controls: Gate selector & Offline toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block font-semibold">Active Turnstile Gate</label>
              <select
                value={gateNumber}
                onChange={(e) => setGateNumber(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="Gate 1 - Main Pavilion">Gate 1 - Main Pavilion</option>
                <option value="Gate 2 - VIP Enclosure">Gate 2 - VIP Enclosure</option>
                <option value="Gate 3 - First Class Turnstile">Gate 3 - First Class Turnstile</option>
                <option value="Gate 4 - General Stand West">Gate 4 - General Stand West</option>
                <option value="Gate 5 - Media & Staff">Gate 5 - Media & Staff</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block font-semibold">Verification Mode</label>
              <button
                type="button"
                onClick={() => setOfflineMode(!offlineMode)}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
                  offlineMode
                    ? 'bg-amber-950/60 border-amber-600 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {offlineMode ? <WifiOff className="w-3.5 h-3.5 text-amber-400" /> : <Wifi className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{offlineMode ? 'Simulate Offline' : 'Online Server'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Turnstile Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Total Scans Audited</div>
            <div className="text-2xl font-black text-white font-mono">{scannerStats.total}</div>
          </div>
          <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 space-y-1">
            <div className="text-[10px] text-emerald-400 uppercase font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Admitted Attendees
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">{scannerStats.valid}</div>
          </div>
          <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-800/40 space-y-1">
            <div className="text-[10px] text-amber-400 uppercase font-bold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Double-Entries Blocked
            </div>
            <div className="text-2xl font-black text-amber-400 font-mono">{scannerStats.doubleEntryBlocked}</div>
          </div>
          <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/40 space-y-1">
            <div className="text-[10px] text-rose-400 uppercase font-bold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Counterfeit / Expired
            </div>
            <div className="text-2xl font-black text-rose-400 font-mono">{scannerStats.rejected}</div>
          </div>
        </div>

        {/* Main Scanner Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Scanner Input & Camera Simulator (5 cols) */}
          <div className="lg:col-span-5 rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                  <QrCode className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-white text-sm">Turnstile QR Scanner Input</h3>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">{gateNumber}</span>
            </div>

            {/* Simulated Camera Target */}
            <div className="relative h-44 rounded-2xl bg-slate-950 border-2 border-dashed border-slate-800 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
              <div className="w-16 h-16 rounded-2xl bg-emerald-950/40 border border-emerald-700/60 flex items-center justify-center text-emerald-400 animate-pulse mb-2">
                <Camera className="w-8 h-8" />
              </div>
              <div className="text-xs font-semibold text-slate-300">Optical Camera Scanner Ready</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Paste raw QR JSON payload or use test presets below
              </div>
            </div>

            {/* Input Box */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex justify-between">
                <span>Scan / Paste Ticket Payload</span>
                <span className="text-[10px] text-slate-500 font-mono">JSON Format</span>
              </label>
              <textarea
                rows={4}
                value={rawPayloadInput}
                onChange={(e) => setRawPayloadInput(e.target.value)}
                placeholder='Paste raw dynamic QR payload e.g. {"ticketId": "...", "nonce": "...", "signature": "..."}'
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Trigger Button */}
            <button
              type="button"
              disabled={scanning || !rawPayloadInput.trim()}
              onClick={() => handleProcessScan()}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 disabled:opacity-40 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {scanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying HMAC & Database...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Verify Gate Pass & Open Turnstile</span>
                </>
              )}
            </button>
          </div>

          {/* Turnstile Visual Feedback Screen (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {lastScanResult ? (
              <div className={`rounded-3xl border p-6 sm:p-8 space-y-6 shadow-2xl transition-all ${
                lastScanResult.valid
                  ? 'bg-emerald-950/40 border-emerald-500/80 shadow-emerald-950/50'
                  : lastScanResult.result === 'ALREADY_SCANNED'
                  ? 'bg-amber-950/40 border-amber-500/80 shadow-amber-950/50'
                  : 'bg-rose-950/40 border-rose-500/80 shadow-rose-950/50'
              }`}>
                {/* Result Title Banner */}
                <div className="flex items-center gap-3">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                    lastScanResult.valid
                      ? 'bg-emerald-500 text-slate-950'
                      : lastScanResult.result === 'ALREADY_SCANNED'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-rose-500 text-slate-950'
                  }`}>
                    {lastScanResult.valid ? (
                      <CheckCircle2 className="w-8 h-8" />
                    ) : (
                      <AlertTriangle className="w-8 h-8" />
                    )}
                  </div>
                  <div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      lastScanResult.valid ? 'text-emerald-400' : lastScanResult.result === 'ALREADY_SCANNED' ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      Turnstile Decision • {lastScanResult.scannedAt}
                    </span>
                    <h2 className="text-2xl font-black text-white">
                      {lastScanResult.valid ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                    </h2>
                  </div>
                </div>

                {/* Explanation text */}
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs space-y-1">
                  <div className="font-bold text-white text-sm">{lastScanResult.message}</div>
                  {lastScanResult.reason && (
                    <div className="text-[11px] font-mono text-slate-400">
                      Reason code: <strong className="text-slate-200">{lastScanResult.reason}</strong>
                    </div>
                  )}
                </div>

                {/* Attendee & Seat Info (if valid or already scanned) */}
                {lastScanResult.ticket && (
                  <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
                    <div className="flex justify-between items-start border-b border-slate-800 pb-3">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Attendee Name</div>
                        <div className="font-bold text-white text-base">
                          {lastScanResult.ticket.attendee?.name || lastScanResult.ticket.attendee || 'Admitted Fan'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Gate Allocation</div>
                        <div className="font-mono text-emerald-400 font-bold text-xs">
                          {gateNumber}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-500">Tier</div>
                        <div className="font-bold text-white text-xs truncate">
                          {lastScanResult.ticket.seat?.tierName || 'Standard'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-500">Row</div>
                        <div className="font-bold text-sky-400 font-mono text-sm">
                          {lastScanResult.ticket.seat?.row || 'GA'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-500">Seat #</div>
                        <div className="font-bold text-emerald-400 font-mono text-sm">
                          #{lastScanResult.ticket.seat?.seatNumber || '1'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-slate-900/60 border border-slate-800 p-8 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 mx-auto">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-white">Awaiting Attendee Gate Pass</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  When a QR pass is scanned, the result, seat allocation, and attendee credentials will appear on this screen with instant turnstile verification.
                </p>
              </div>
            )}

            {/* Recent Scans Table */}
            <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" /> Recent Turnstile Scans Feed
                </h3>
                <button
                  type="button"
                  onClick={fetchRecentScans}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {loadingRecent ? (
                <div className="text-center py-6 text-xs text-slate-500">Loading audit feed...</div>
              ) : recentScans.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">No scans recorded yet this session.</div>
              ) : (
                <div className="space-y-2 overflow-x-auto">
                  {recentScans.slice(0, 6).map((scan) => (
                    <div
                      key={scan.id}
                      className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${
                          scan.result === 'VALID_FIRST_SCAN'
                            ? 'bg-emerald-400'
                            : scan.result === 'ALREADY_SCANNED'
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                        }`} />
                        <div>
                          <div className="font-bold text-white">
                            {scan.ticket?.user?.name || 'Attendee'} • {scan.ticket?.seat?.tier?.name} Row {scan.ticket?.seat?.row} #{scan.ticket?.seat?.seatNumber}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[240px]">
                            {scan.ticket?.event?.name} • {scan.gateNumber || 'Gate 1'}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          scan.result === 'VALID_FIRST_SCAN'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : scan.result === 'ALREADY_SCANNED'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {scan.result}
                        </span>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {new Date(scan.scanTime).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
