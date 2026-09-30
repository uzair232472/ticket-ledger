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
    <div className="space-y-8 pb-16 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-[#16a34a]" /> Stadium Gate Control System
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                offlineMode ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-teal-50 text-teal-800 border border-teal-200'
              }`}>
                {offlineMode ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3 text-emerald-600" />}
                {offlineMode ? 'Offline HMAC Verification Mode' : 'Online Real-Time Sync'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
              Gate Staff Turnstile Scanner
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
              Verifies rotating dynamic QR codes, prevents screenshot fraud, strictly rejects double-entry, and audits check-in timestamps.
            </p>
          </div>

          {/* Controls: Gate selector & Offline toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block font-semibold mb-1">Active Turnstile Gate</label>
              <select
                value={gateNumber}
                onChange={(e) => setGateNumber(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] font-semibold"
              >
                <option value="Gate 1 - Main Pavilion">Gate 1 - Main Pavilion</option>
                <option value="Gate 2 - VIP Enclosure">Gate 2 - VIP Enclosure</option>
                <option value="Gate 3 - First Class Turnstile">Gate 3 - First Class Turnstile</option>
                <option value="Gate 4 - General Stand West">Gate 4 - General Stand West</option>
                <option value="Gate 5 - Media & Staff">Gate 5 - Media & Staff</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block font-semibold mb-1">Verification Mode</label>
              <button
                type="button"
                onClick={() => setOfflineMode(!offlineMode)}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
                  offlineMode
                    ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 shadow-sm'
                }`}
              >
                {offlineMode ? <WifiOff className="w-3.5 h-3.5 text-amber-600" /> : <Wifi className="w-3.5 h-3.5 text-emerald-600" />}
                <span>{offlineMode ? 'Simulate Offline' : 'Online Server'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Turnstile Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-1">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Total Scans Audited</div>
            <div className="text-2xl font-black text-slate-900 font-mono">{scannerStats.total}</div>
          </div>
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-sm space-y-1">
            <div className="text-[10px] text-emerald-800 uppercase font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#16a34a]" /> Admitted Attendees
            </div>
            <div className="text-2xl font-black text-emerald-800 font-mono">{scannerStats.valid}</div>
          </div>
          <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 shadow-sm space-y-1">
            <div className="text-[10px] text-amber-800 uppercase font-bold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Double-Entries Blocked
            </div>
            <div className="text-2xl font-black text-amber-800 font-mono">{scannerStats.doubleEntryBlocked}</div>
          </div>
          <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 shadow-sm space-y-1">
            <div className="text-[10px] text-rose-800 uppercase font-bold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-rose-600" /> Counterfeit / Expired
            </div>
            <div className="text-2xl font-black text-rose-800 font-mono">{scannerStats.rejected}</div>
          </div>
        </div>

        {/* Main Scanner Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Scanner Input & Camera Simulator (5 cols) */}
          <div className="lg:col-span-5 rounded-3xl bg-white border border-slate-200/90 p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-[#16a34a] flex items-center justify-center font-bold">
                  <QrCode className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Turnstile QR Scanner Input</h3>
              </div>
              <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded-full">{gateNumber}</span>
            </div>

            {/* Simulated Camera Target */}
            <div className="relative h-44 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 border border-emerald-300 flex items-center justify-center text-[#16a34a] animate-pulse mb-2">
                <Camera className="w-8 h-8" />
              </div>
              <div className="text-xs font-semibold text-slate-800">Optical Camera Scanner Ready</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Paste raw QR JSON payload or use test presets below
              </div>
            </div>

            {/* Input Box */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 flex justify-between">
                <span>Scan / Paste Ticket Payload</span>
                <span className="text-[10px] text-slate-400 font-mono">JSON Format</span>
              </label>
              <textarea
                rows={4}
                value={rawPayloadInput}
                onChange={(e) => setRawPayloadInput(e.target.value)}
                placeholder='Paste raw dynamic QR payload e.g. {"ticketId": "...", "nonce": "...", "signature": "..."}'
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#22c55e]"
              />
            </div>

            {/* Trigger Button */}
            <button
              type="button"
              disabled={scanning || !rawPayloadInput.trim()}
              onClick={() => handleProcessScan()}
              className="w-full py-3.5 btn-eventfrog disabled:opacity-40 text-xs shadow-sm flex items-center justify-center gap-2"
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
              <div className={`rounded-3xl border p-6 sm:p-8 space-y-6 shadow-sm transition-all ${
                lastScanResult.valid
                  ? 'bg-emerald-50 border-emerald-300'
                  : lastScanResult.result === 'ALREADY_SCANNED'
                  ? 'bg-amber-50 border-amber-300'
                  : 'bg-rose-50 border-rose-300'
              }`}>
                {/* Result Title Banner */}
                <div className="flex items-center gap-3">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                    lastScanResult.valid
                      ? 'bg-[#16a34a] text-white shadow-sm'
                      : lastScanResult.result === 'ALREADY_SCANNED'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-rose-500 text-white shadow-sm'
                  }`}>
                    {lastScanResult.valid ? (
                      <CheckCircle2 className="w-8 h-8" />
                    ) : (
                      <AlertTriangle className="w-8 h-8" />
                    )}
                  </div>
                  <div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      lastScanResult.valid ? 'text-emerald-800' : lastScanResult.result === 'ALREADY_SCANNED' ? 'text-amber-800' : 'text-rose-800'
                    }`}>
                      Turnstile Decision • {lastScanResult.scannedAt}
                    </span>
                    <h2 className={`text-2xl font-black ${
                      lastScanResult.valid ? 'text-emerald-900' : lastScanResult.result === 'ALREADY_SCANNED' ? 'text-amber-900' : 'text-rose-900'
                    }`}>
                      {lastScanResult.valid ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                    </h2>
                  </div>
                </div>

                {/* Explanation text */}
                <div className="p-4 rounded-2xl bg-white border border-slate-200 text-xs space-y-1 shadow-sm">
                  <div className="font-bold text-slate-900 text-sm">{lastScanResult.message}</div>
                  {lastScanResult.reason && (
                    <div className="text-[11px] font-mono text-slate-500">
                      Reason code: <strong className="text-slate-800">{lastScanResult.reason}</strong>
                    </div>
                  )}
                </div>

                {/* Attendee & Seat Info (if valid or already scanned) */}
                {lastScanResult.ticket && (
                  <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
                    <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">Attendee Name</div>
                        <div className="font-bold text-slate-900 text-base">
                          {lastScanResult.ticket.attendee?.name || lastScanResult.ticket.attendee || 'Admitted Fan'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">Gate Allocation</div>
                        <div className="font-mono text-[#16a34a] font-bold text-xs">
                          {gateNumber}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="text-[10px] text-slate-400">Tier</div>
                        <div className="font-bold text-slate-800 text-xs truncate">
                          {lastScanResult.ticket.seat?.tierName || 'Standard'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="text-[10px] text-slate-400">Row</div>
                        <div className="font-bold text-sky-700 font-mono text-sm">
                          {lastScanResult.ticket.seat?.row || 'GA'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="text-[10px] text-slate-400">Seat #</div>
                        <div className="font-bold text-[#16a34a] font-mono text-sm">
                          #{lastScanResult.ticket.seat?.seatNumber || '1'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-3xl bg-white border border-slate-200/90 p-8 text-center space-y-3 shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Awaiting Attendee Gate Pass</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  When a QR pass is scanned, the result, seat allocation, and attendee credentials will appear on this screen with instant turnstile verification.
                </p>
              </div>
            )}

            {/* Recent Scans Table */}
            <div className="rounded-3xl bg-white border border-slate-200/90 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#16a34a]" /> Recent Turnstile Scans Feed
                </h3>
                <button
                  type="button"
                  onClick={fetchRecentScans}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {loadingRecent ? (
                <div className="text-center py-6 text-xs text-slate-400">Loading audit feed...</div>
              ) : recentScans.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">No scans recorded yet this session.</div>
              ) : (
                <div className="space-y-2 overflow-x-auto">
                  {recentScans.slice(0, 6).map((scan) => (
                    <div
                      key={scan.id}
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs hover:bg-slate-100 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${
                          scan.result === 'VALID_FIRST_SCAN'
                            ? 'bg-emerald-500'
                            : scan.result === 'ALREADY_SCANNED'
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`} />
                        <div>
                          <div className="font-bold text-slate-900">
                            {scan.ticket?.user?.name || 'Attendee'} • {scan.ticket?.seat?.tier?.name} Row {scan.ticket?.seat?.row} #{scan.ticket?.seat?.seatNumber}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate max-w-[240px]">
                            {scan.ticket?.event?.name} • {scan.gateNumber || 'Gate 1'}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
                          scan.result === 'VALID_FIRST_SCAN'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : scan.result === 'ALREADY_SCANNED'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}>
                          {scan.result}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
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
