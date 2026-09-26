import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Wallet,
  QrCode,
  Download,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  MapPin,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  Ticket as TicketIcon,
  RefreshCw,
  Lock,
  Layers,
  FileText,
  Info,
  ChevronDown,
  ChevronUp,
  Tag,
  ArrowRightLeft,
  Send,
  History,
  X,
  UserCheck,
  DollarSign,
  Filter
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

export default function DigitalWallet() {
  const { user, token } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);
  const [expandedPayloadId, setExpandedPayloadId] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const [qrVerifyResult, setQrVerifyResult] = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(30);

  // Active Tab Filter (defaults to 'ACTIVE' so users see transferable tickets immediately)
  const [filterTab, setFilterTab] = useState('ACTIVE');

  // Transfer Modal State
  const [transferModalTicket, setTransferModalTicket] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState('');

  // Resale Modal State
  const [resaleModalTicket, setResaleModalTicket] = useState(null);
  const [resalePriceInput, setResalePriceInput] = useState('');
  const [resaleSubmitting, setResaleSubmitting] = useState(false);
  const [resaleError, setResaleError] = useState('');

  // Provenance / Transfer History Modal State
  const [historyModalTicket, setHistoryModalTicket] = useState(null);
  const [transferHistoryList, setTransferHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // My Transfers Global Modal State
  const [showMyTransfersModal, setShowMyTransfersModal] = useState(false);
  const [myTransfersData, setMyTransfersData] = useState({ sent: [], received: [] });
  const [myTransfersLoading, setMyTransfersLoading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchWallet = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/tickets/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch tickets');
      
      const loadedTickets = data.data?.tickets || [];
      // Sort: ACTIVE tickets first, then SCANNED, then RESOLD
      loadedTickets.sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      setTickets(loadedTickets);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchWallet();
    }
  }, [token]);

  const copyToClipboard = (text, fieldKey) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDownloadPDF = async (ticket) => {
    setDownloadingId(ticket.id);
    try {
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error('Failed to generate PDF ticket');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `TicketLedger-${ticket.event?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Pass'}-${ticket.id.slice(0, 6)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Download Error: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSimulateGateScan = async (ticket) => {
    setVerifyingId(ticket.id);
    setQrVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/tickets/verify-qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payload: ticket.qr.payload }),
      });
      const data = await res.json();
      setQrVerifyResult({
        ticketId: ticket.id,
        valid: data.valid ?? data.success,
        reason: data.reason,
        message: data.message,
      });
    } catch (err) {
      setQrVerifyResult({
        ticketId: ticket.id,
        valid: false,
        reason: 'NETWORK_ERROR',
        message: err.message,
      });
    } finally {
      setVerifyingId(null);
    }
  };

  // 1. Submit Direct P2P Transfer
  const handleExecuteTransfer = async (e) => {
    e.preventDefault();
    if (!transferModalTicket || !recipientEmail) return;

    setTransferSubmitting(true);
    setTransferError('');

    try {
      const res = await fetch(`${API_BASE}/tickets/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticketId: transferModalTicket.id,
          recipientEmail: recipientEmail.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Transfer failed');
      }

      setSuccessMessage(`✓ Ticket successfully transferred to ${data.data?.newOwner?.name || recipientEmail}! Gate pass has been revoked and reissued.`);
      setTransferModalTicket(null);
      setRecipientEmail('');
      fetchWallet();
      setTimeout(() => setSuccessMessage(''), 8000);
    } catch (err) {
      setTransferError(err.message);
    } finally {
      setTransferSubmitting(false);
    }
  };

  // 2. Submit Resale Listing with 110% Anti-Scalping cap check
  const handleExecuteResaleListing = async (e) => {
    e.preventDefault();
    if (!resaleModalTicket || !resalePriceInput) return;

    setResaleSubmitting(true);
    setResaleError('');

    try {
      const price = parseFloat(resalePriceInput);
      const original = Number(resaleModalTicket.price);
      const maxAllowed = Math.floor(original * 1.10);

      if (price > maxAllowed) {
        throw new Error(`Anti-scalping rule: Maximum allowed resale price is Rs. ${maxAllowed.toLocaleString()} (110% of face value).`);
      }

      const res = await fetch(`${API_BASE}/resale/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticketId: resaleModalTicket.id,
          resalePrice: price,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Listing failed');
      }

      setSuccessMessage(`✓ Ticket listed on secondary marketplace for Rs. ${price.toLocaleString()}! Fans on the waitlist have received instant notifications.`);
      setResaleModalTicket(null);
      setResalePriceInput('');
      fetchWallet();
      setTimeout(() => setSuccessMessage(''), 8000);
    } catch (err) {
      setResaleError(err.message);
    } finally {
      setResaleSubmitting(false);
    }
  };

  // 3. Open Ticket Transfer History / Provenance Modal
  const handleOpenTicketHistory = async (ticket) => {
    setHistoryModalTicket(ticket);
    setHistoryLoading(true);
    setTransferHistoryList([]);

    try {
      const res = await fetch(`${API_BASE}/tickets/${ticket.id}/transfer-history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setTransferHistoryList(data.data?.history || []);
      }
    } catch (err) {
      console.error('Error fetching ticket history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 4. Open My Overall Transfers Modal
  const handleOpenMyTransfers = async () => {
    setShowMyTransfersModal(true);
    setMyTransfersLoading(true);

    try {
      const res = await fetch(`${API_BASE}/tickets/my-transfers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMyTransfersData({
          sent: data.data?.sent || [],
          received: data.data?.received || [],
        });
      }
    } catch (err) {
      console.error('Error fetching my transfers:', err);
    } finally {
      setMyTransfersLoading(false);
    }
  };

  // Filtered tickets
  const activeTicketsCount = tickets.filter((t) => t.status === 'ACTIVE').length;
  const scannedTicketsCount = tickets.filter((t) => t.status === 'SCANNED').length;

  const displayedTickets = tickets.filter((t) => {
    if (filterTab === 'ACTIVE') return t.status === 'ACTIVE';
    if (filterTab === 'SCANNED') return t.status === 'SCANNED' || t.status === 'RESOLD' || t.status === 'TRANSFERRED';
    return true; // 'ALL'
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Cryptographic Gate Pass
              </span>
              <span className="text-[10px] font-bold text-purple-300 bg-purple-950/60 border border-purple-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" /> Polygon Amoy NFT
              </span>
              <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ArrowRightLeft className="w-3 h-3 text-cyan-400" /> P2P Transfer & 110% Resale
              </span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight mt-1">
              Digital Ticket & QR Wallet
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Your official stadium turnstile gate passes. Each ticket contains a rotating cryptographic HMAC QR code, on-chain NFT ownership badge, and controlled peer-to-peer transfer capabilities.
            </p>
          </div>

          {/* Action Buttons & Wallet Info Box */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleOpenMyTransfers}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-800 text-xs font-bold text-cyan-300 transition shadow-sm"
            >
              <History className="w-4 h-4 text-cyan-400" />
              <span>Transfer Log ({myTransfersData.sent.length + myTransfersData.received.length})</span>
            </button>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Wallet Holder</div>
                <div className="font-bold text-white text-xs">{user?.name || 'Customer'}</div>
                <div className="font-mono text-[10px] text-emerald-400 truncate max-w-[140px]">
                  {user?.walletAddress ? `0x...${user.walletAddress.slice(-6)}` : 'Custodial Web3 Vault'}
                </div>
              </div>
              <button
                onClick={fetchWallet}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition ml-1"
                title="Refresh Wallet"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Info Banner: How to Transfer Pass */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/50 via-slate-900 to-slate-900 border border-cyan-800/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Want to transfer a ticket to a friend or list it for resale?</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-700 px-2 py-0.5 rounded-full font-bold">MODULE 11</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Click the bright cyan <strong>"Transfer Pass"</strong> button on any active ticket card below. Your old QR will be safely revoked and a fresh pass issued to the recipient.
              </div>
            </div>
          </div>
        </div>

        {/* Global Success / Alert Banner */}
        {successMessage && (
          <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-700 text-emerald-300 text-xs flex items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="font-medium">{successMessage}</div>
            </div>
            <button onClick={() => setSuccessMessage('')} className="text-emerald-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button
            onClick={() => setFilterTab('ACTIVE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              filterTab === 'ACTIVE'
                ? 'bg-emerald-600 text-slate-950 shadow-md shadow-emerald-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>⚡ Active Passes (Ready for Transfer / Entry)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              filterTab === 'ACTIVE' ? 'bg-slate-950 text-emerald-400' : 'bg-slate-800 text-slate-300'
            }`}>
              {activeTicketsCount}
            </span>
          </button>

          <button
            onClick={() => setFilterTab('ALL')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              filterTab === 'ALL'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>All Tickets</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              filterTab === 'ALL' ? 'bg-slate-950 text-cyan-400' : 'bg-slate-800 text-slate-300'
            }`}>
              {tickets.length}
            </span>
          </button>

          <button
            onClick={() => setFilterTab('SCANNED')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              filterTab === 'SCANNED'
                ? 'bg-slate-700 text-white'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>Scanned / Revoked</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              filterTab === 'SCANNED' ? 'bg-slate-950 text-slate-300' : 'bg-slate-800 text-slate-300'
            }`}>
              {scannedTicketsCount}
            </span>
          </button>
        </div>

        {/* Tickets Grid */}
        {loading ? (
          <div className="text-center py-20 space-y-4">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading your cryptographically signed tickets & NFT passes...</p>
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="text-center py-16 space-y-4 max-w-md mx-auto bg-slate-900/40 border border-slate-800 rounded-3xl p-8">
            <div className="w-14 h-14 rounded-2xl bg-emerald-950/40 border border-emerald-800 flex items-center justify-center mx-auto text-emerald-400">
              <TicketIcon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white">No Tickets Found in this Tab</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {filterTab === 'ACTIVE'
                ? 'You do not have any active unscanned passes. Click "All Tickets" to view previously used passes or browse events to buy new tickets.'
                : 'No tickets matching the selected filter.'}
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                onClick={() => setFilterTab('ALL')}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition"
              >
                View All Passes
              </button>
              <Link
                to="/events"
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
              >
                Browse Events
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Showing <strong>{displayedTickets.length}</strong> passes ({filterTab} filter)</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> All passes secured with HMAC dynamic rotation & 110% resale cap
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {displayedTickets.map((t) => {
                const isActive = t.status === 'ACTIVE';
                const isResoldOrTransferred = t.status === 'RESOLD' || t.status === 'TRANSFERRED';
                const isScanned = t.status === 'SCANNED';
                const isPayloadExpanded = expandedPayloadId === t.id;
                const origPrice = Number(t.price);
                const maxResaleCeiling = Math.floor(origPrice * 1.10);

                return (
                  <div
                    key={t.id}
                    className={`rounded-3xl bg-slate-900 border ${
                      isActive
                        ? 'border-emerald-500/50 hover:border-emerald-400 shadow-emerald-950/20'
                        : isScanned
                        ? 'border-slate-800 opacity-75'
                        : 'border-rose-900/60 opacity-75'
                    } overflow-hidden shadow-2xl transition-all flex flex-col`}
                  >
                    {/* Top Status & Event Banner */}
                    <div className="relative p-5 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border-b border-slate-800 flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            isActive
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : isScanned
                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}>
                            {t.status}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Pass #{t.id.slice(0, 8)}
                          </span>
                        </div>
                        <h3 className="text-lg font-black text-white leading-tight mt-1">
                          {t.event?.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-slate-400 pt-0.5">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                            {t.event?.venue}, {t.event?.city}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            {t.event?.date ? new Date(t.event.date).toLocaleDateString('en-PK', { dateStyle: 'medium' }) : 'TBD'} • {t.event?.time}
                          </span>
                        </div>
                      </div>

                      {/* NFT Ownership Badge */}
                      <div className="text-right shrink-0">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950/60 border border-purple-800/80 text-purple-300 text-[11px] font-bold">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                          <span>NFT #{t.nft?.tokenId || '1024'}</span>
                        </div>
                        <div className="text-[9px] text-purple-400 mt-1 font-mono">
                          Polygon Amoy Verified
                        </div>
                      </div>
                    </div>

                    {/* Middle Section: Seat Info & QR Pass Side-by-Side */}
                    <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                      
                      {/* Left: Seat Coordinates & Pricing */}
                      <div className="space-y-4">
                        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2.5">
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Category / Tier</span>
                            <span className="font-bold text-white">{t.seat?.tierName}</span>
                          </div>
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Section</span>
                            <span className="font-semibold text-slate-300">{t.seat?.section}</span>
                          </div>
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Row & Seat #</span>
                            <span className="font-mono font-bold text-emerald-400 text-sm">
                              Row {t.seat?.row} • #{t.seat?.seatNumber}
                            </span>
                          </div>
                          <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                            <span className="text-slate-400 text-xs">Paid Face Value:</span>
                            <span className="font-mono font-black text-white text-sm">
                              PKR {origPrice.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {/* On-Chain Web3 Details */}
                        <div className="p-3 rounded-2xl bg-purple-950/20 border border-purple-900/40 text-[11px] font-mono space-y-1.5">
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Contract:</span>
                            <span className="text-purple-300 truncate max-w-[130px]">
                              {t.nft?.contractAddress}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Tx Hash:</span>
                            <div className="flex items-center gap-1">
                              <span className="text-purple-300 truncate max-w-[110px]">
                                {t.nft?.txHash}
                              </span>
                              <button
                                onClick={() => copyToClipboard(t.nft?.txHash, `tx-${t.id}`)}
                                className="text-slate-400 hover:text-white"
                                title="Copy Tx Hash"
                              >
                                {copiedField === `tx-${t.id}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="flex justify-between items-center text-slate-400">
                            <span>Owner Wallet:</span>
                            <span className="text-slate-300 truncate max-w-[120px]">
                              {t.nft?.ownerWallet}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Cryptographic QR Code Gate Pass */}
                      <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-950 border border-slate-800 relative group">
                        {isScanned && (
                          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center p-4 text-center">
                            <CheckCircle2 className="w-9 h-9 text-slate-400 mb-1" />
                            <div className="text-xs font-bold text-slate-200">PASS ALREADY SCANNED</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Admitted at turnstile gate. Cannot be transferred or reused.
                            </div>
                          </div>
                        )}

                        {isResoldOrTransferred && (
                          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center p-4 text-center">
                            <AlertTriangle className="w-8 h-8 text-rose-400 mb-1" />
                            <div className="text-xs font-bold text-rose-300">QR INVALIDATED</div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              This ticket was resold/transferred. The gate pass nonce has expired.
                            </div>
                          </div>
                        )}

                        <div className="mb-2 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700 text-emerald-400 text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          <span>Rotating TOTP • Refreshes in {secondsLeft}s</span>
                        </div>

                        <div className="bg-white p-2.5 rounded-2xl shadow-xl">
                          <img
                            src={t.qr?.qrCodeDataUrl}
                            alt="Ticket QR Code"
                            className="w-40 h-40 object-contain"
                          />
                        </div>

                        <div className="text-center mt-2.5 space-y-0.5">
                          <div className="text-[11px] font-bold text-white flex items-center justify-center gap-1">
                            <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Scan at Stadium Gate</span>
                          </div>
                          <div className="text-[9px] text-slate-400 font-mono">
                            Nonce: {t.qr?.nonce?.slice(0, 16)}...
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Signed QR Cryptographic Payload Accordion */}
                    <div className="px-6 py-2 bg-slate-950/60 border-t border-slate-800 text-xs">
                      <button
                        onClick={() => setExpandedPayloadId(isPayloadExpanded ? null : t.id)}
                        className="w-full flex items-center justify-between text-slate-400 hover:text-slate-200 transition py-1"
                      >
                        <span className="flex items-center gap-1.5 font-semibold text-[11px] text-emerald-400">
                          <Lock className="w-3 h-3" />
                          <span>QR Payload Details ({isPayloadExpanded ? 'Hide' : 'Show Signed JSON'})</span>
                        </span>
                        {isPayloadExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>

                      {isPayloadExpanded && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-300 space-y-1 overflow-x-auto">
                          <div><span className="text-emerald-400">"ticketId":</span> "{t.qr?.payload?.ticketId}"</div>
                          <div><span className="text-emerald-400">"eventId":</span> "{t.qr?.payload?.eventId}"</div>
                          <div><span className="text-emerald-400">"tokenId":</span> {t.qr?.payload?.tokenId}</div>
                          <div><span className="text-emerald-400">"nonce":</span> "{t.qr?.payload?.nonce}"</div>
                          <div><span className="text-emerald-400">"issuedAt":</span> {t.qr?.payload?.issuedAt}</div>
                          <div><span className="text-emerald-400">"qrVersion":</span> "{t.qr?.payload?.qrVersion}"</div>
                          <div><span className="text-purple-400">"signature":</span> "{t.qr?.payload?.signature}"</div>
                          <div className="pt-2 text-[9px] text-slate-500 font-sans flex items-center gap-1">
                            <Info className="w-3 h-3" />
                            HMAC-SHA256 signature generated by server secret key. Any alteration invalidates gate pass.
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Gate Scan Simulation Banner if triggered */}
                    {qrVerifyResult && qrVerifyResult.ticketId === t.id && (
                      <div className={`p-3.5 mx-6 my-2 rounded-2xl text-xs flex items-center gap-3 ${
                        qrVerifyResult.valid
                          ? 'bg-emerald-950/60 border border-emerald-700 text-emerald-300'
                          : 'bg-rose-950/60 border border-rose-700 text-rose-300'
                      }`}>
                        {qrVerifyResult.valid ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-bold">{qrVerifyResult.message}</div>
                          <div className="text-[10px] text-slate-300 font-mono">
                            {qrVerifyResult.valid
                              ? 'Turnstile green light activated. Seat coordinates confirmed.'
                              : `Rejection code: ${qrVerifyResult.reason}`}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Module 11 Action Bar: Direct Transfer, Resale & Provenance */}
                    <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        {isActive ? (
                          <>
                            {/* Prominent High-Visibility Direct Transfer Button */}
                            <button
                              type="button"
                              onClick={() => {
                                setTransferModalTicket(t);
                                setRecipientEmail('');
                                setTransferError('');
                              }}
                              className="py-2 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-xs shadow-md shadow-cyan-500/25 flex items-center gap-1.5 transition"
                            >
                              <Send className="w-3.5 h-3.5 text-slate-950" />
                              <span>Transfer Pass</span>
                            </button>

                            {/* List for Secondary Resale */}
                            <button
                              type="button"
                              onClick={() => {
                                setResaleModalTicket(t);
                                setResalePriceInput(String(t.price));
                                setResaleError('');
                              }}
                              className="py-2 px-3.5 rounded-xl bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 font-bold text-xs transition flex items-center gap-1.5"
                            >
                              <Tag className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Resale (≤110%)</span>
                            </button>
                          </>
                        ) : (
                          <div className="py-1.5 px-3 rounded-xl bg-slate-800/80 border border-slate-700/80 text-slate-400 text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed">
                            <Lock className="w-3 h-3 text-slate-500" />
                            <span>Cannot Transfer ({t.status})</span>
                          </div>
                        )}

                        {/* Provenance / Custody Chain */}
                        <button
                          type="button"
                          onClick={() => handleOpenTicketHistory(t)}
                          className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1 font-semibold"
                          title="View complete transfer & resale chain"
                        >
                          <History className="w-3.5 h-3.5 text-slate-400" />
                          <span>History</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Download PDF using PDFKit */}
                        <button
                          type="button"
                          onClick={() => handleDownloadPDF(t)}
                          disabled={downloadingId === t.id}
                          className="py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {downloadingId === t.id ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>PDF...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3 h-3" />
                              <span>PDF Pass</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSimulateGateScan(t)}
                          disabled={verifyingId === t.id}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                          title="Simulate Turnstile Gate Scan"
                        >
                          {verifyingId === t.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MODAL 1: Direct P2P Ticket Transfer Modal */}
        {transferModalTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Direct Ticket Transfer</h3>
                    <p className="text-[10px] text-slate-400">Transfer gate pass to another registered user</p>
                  </div>
                </div>
                <button
                  onClick={() => setTransferModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Ticket Preview Details */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                <div className="font-bold text-white text-sm">{transferModalTicket.event?.name}</div>
                <div className="text-slate-400 text-[11px]">
                  {transferModalTicket.seat?.tierName} • Section {transferModalTicket.seat?.section} • Row {transferModalTicket.seat?.row} #{transferModalTicket.seat?.seatNumber}
                </div>
                <div className="text-purple-300 font-mono text-[10px] pt-1">
                  Polygon NFT #{transferModalTicket.nft?.tokenId || '1024'}
                </div>
              </div>

              {/* Security Alert */}
              <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-800 text-amber-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Important:</strong> Once transferred, your gate pass and QR code will be <strong>permanently revoked</strong>. The recipient will receive a brand-new cryptographic rotating QR pass.
                </div>
              </div>

              <form onSubmit={handleExecuteTransfer} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Recipient Registered Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="friend@ticketledger.pk"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    The recipient must have a registered TicketLedger account.
                  </p>
                </div>

                {transferError && (
                  <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                    {transferError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setTransferModalTicket(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transferSubmitting || !recipientEmail}
                    className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {transferSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Transferring...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Confirm Transfer</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 2: Resale Listing Modal with 110% Anti-Scalping Rule */}
        {resaleModalTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">List for Controlled Resale</h3>
                    <p className="text-[10px] text-slate-400">Strictly regulated 110% anti-scalping price ceiling</p>
                  </div>
                </div>
                <button
                  onClick={() => setResaleModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Price Ceiling Card */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Original Face Value:</span>
                  <span className="font-mono font-bold text-white">PKR {Number(resaleModalTicket.price).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-emerald-400 font-semibold border-t border-slate-800 pt-2">
                  <span>Maximum Resale Ceiling (110%):</span>
                  <span className="font-mono font-black text-sm">PKR {Math.floor(Number(resaleModalTicket.price) * 1.10).toLocaleString()}</span>
                </div>
              </div>

              {/* Smart Contract / On-Chain Protection Note */}
              <div className="p-3 rounded-2xl bg-purple-950/40 border border-purple-800 text-purple-300 text-xs flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  Secondary resale prices are verified on-chain. Predatory markups are blocked. <strong>Waitlist fans will be immediately notified</strong> when this listing is activated.
                </div>
              </div>

              <form onSubmit={handleExecuteResaleListing} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Resale Listing Price (PKR)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Math.floor(Number(resaleModalTicket.price) * 1.10)}
                    required
                    value={resalePriceInput}
                    onChange={(e) => setResalePriceInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono font-bold focus:outline-none focus:border-emerald-500 transition"
                  />
                  <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                    <span>Min: PKR 1</span>
                    <span>Max Allowed: PKR {Math.floor(Number(resaleModalTicket.price) * 1.10).toLocaleString()}</span>
                  </div>
                </div>

                {resaleError && (
                  <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                    {resaleError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setResaleModalTicket(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resaleSubmitting || !resalePriceInput}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {resaleSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Publishing...</span>
                      </>
                    ) : (
                      <>
                        <Tag className="w-3.5 h-3.5" />
                        <span>Publish Listing</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL 3: Ticket Provenance & Custody History Modal */}
        {historyModalTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Ticket Provenance Chain</h3>
                    <p className="text-[10px] text-slate-400">Verifiable custody and transfer record</p>
                  </div>
                </div>
                <button
                  onClick={() => setHistoryModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {historyLoading ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-400">Loading custody provenance...</p>
                </div>
              ) : transferHistoryList.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <UserCheck className="w-10 h-10 text-slate-600 mx-auto" />
                  <div className="text-xs font-bold text-white">Original Primary Issuance</div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    This ticket is in the possession of the original purchaser. No secondary transfers have occurred.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto pr-1">
                  {transferHistoryList.map((h, idx) => (
                    <div
                      key={h.id || idx}
                      className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          h.transferType === 'DIRECT_TRANSFER'
                            ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                            : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        }`}>
                          {h.transferType === 'DIRECT_TRANSFER' ? 'Direct P2P Transfer' : 'Marketplace Resale'}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(h.createdAt).toLocaleString('en-PK')}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                        <div>
                          <span className="text-slate-500">From: </span>
                          <span className="font-medium text-slate-300">{h.fromUser?.name || 'Seller'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">To: </span>
                          <span className="font-medium text-slate-300">{h.toUser?.name || 'Buyer'}</span>
                        </div>
                      </div>

                      {h.price > 0 && (
                        <div className="text-[11px] text-emerald-400 font-mono">
                          Settled Price: PKR {Number(h.price).toLocaleString()}
                        </div>
                      )}

                      <div className="pt-1.5 border-t border-slate-900 flex justify-between items-center text-[10px] font-mono text-slate-500">
                        <span>Nonce Rotated:</span>
                        <span className="text-slate-400">{h.newNonce?.slice(0, 12)}...</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setHistoryModalTicket(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 4: User's Overall Sent & Received Transfers Log */}
        {showMyTransfersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Personal Transfer Activity Log</h3>
                    <p className="text-[10px] text-slate-400">All passes sent and received by your account</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMyTransfersModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {myTransfersLoading ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-400">Loading transfer history...</p>
                </div>
              ) : myTransfersData.sent.length === 0 && myTransfersData.received.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <History className="w-10 h-10 text-slate-600 mx-auto" />
                  <div className="text-xs font-bold text-white">No Transfer Records</div>
                  <p className="text-[11px] text-slate-400">
                    You have not sent or received any tickets through peer-to-peer transfer or resale.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 overflow-y-auto pr-1">
                  {/* Received Passes */}
                  {myTransfersData.received.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Passes Received ({myTransfersData.received.length})</span>
                      </div>
                      <div className="space-y-2">
                        {myTransfersData.received.map((rec) => (
                          <div key={rec.id} className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs flex justify-between items-center gap-3">
                            <div>
                              <div className="font-bold text-white">{rec.ticket?.event?.name}</div>
                              <div className="text-[11px] text-slate-400">
                                Transferred by: <strong className="text-slate-200">{rec.fromUser?.name}</strong> ({rec.fromUser?.email})
                              </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-400">
                              {new Date(rec.createdAt).toLocaleDateString('en-PK')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sent Passes */}
                  {myTransfersData.sent.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <div className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" />
                        <span>Passes Sent ({myTransfersData.sent.length})</span>
                      </div>
                      <div className="space-y-2">
                        {myTransfersData.sent.map((sen) => (
                          <div key={sen.id} className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs flex justify-between items-center gap-3">
                            <div>
                              <div className="font-bold text-white">{sen.ticket?.event?.name}</div>
                              <div className="text-[11px] text-slate-400">
                                Transferred to: <strong className="text-slate-200">{sen.toUser?.name}</strong> ({sen.toUser?.email})
                              </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-400">
                              {new Date(sen.createdAt).toLocaleDateString('en-PK')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setShowMyTransfersModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
