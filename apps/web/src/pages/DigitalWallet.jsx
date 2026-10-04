import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountShell, { AccountSection, AccountPortal } from '../components/account/AccountShell';
import { HERO_IMAGE } from '../components/home/homeData';
import WalletPass from '../components/account/WalletPass';
import '../components/account/passes.css';
import { useDialog } from '../components/ui/DialogProvider';
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

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

export default function DigitalWallet() {
  const dialog = useDialog();
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
      dialog.alert({ tone: 'error', title: 'Download failed', message: err.message });
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
      dialog.alert({ tone: 'success', title: 'Ticket transferred', message: `The ticket now belongs to ${data.data?.newOwner?.name || recipientEmail}. Your old QR code no longer works; they’ve received a new one.` });
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
      dialog.alert({ tone: 'success', title: 'Listed for resale', message: `Your ticket is on fan resale for Rs. ${price.toLocaleString()}. We’ll email you when it sells.` });
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
    <AccountShell
      eyebrow="My account · Cryptographic gate passes"
      title={['Your', 'tickets']}
      intro="Gate passes with a rotating QR code, ready to scan at the turnstile. Transfer a pass to a friend, list it for fan resale, or download it as a PDF."
      image={HERO_IMAGE.src}
      stats={loading ? [] : [
        { value: activeTicketsCount, label: 'Active passes' },
        { value: tickets.length, label: 'All tickets' },
        { value: scannedTicketsCount, label: 'Scanned' },
      ]}
      actions={
        <>
          <button type="button" onClick={handleOpenMyTransfers} className="tl-btn tl-btn--green">
            <History className="w-4 h-4" aria-hidden="true" />
            <span>Transfer log ({myTransfersData.sent.length + myTransfersData.received.length})</span>
          </button>
          <Link to="/my-nfts" className="tl-btn tl-btn--ghost">
            <Sparkles className="w-4 h-4" aria-hidden="true" /> On-chain NFTs
          </Link>
          <div className="tl-acct-wallet">
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span>
              <small>{user?.name || 'Customer'}</small>
              {user?.walletAddress ? `0x...${user.walletAddress.slice(-6)}` : 'Custodial Web3 Vault'}
            </span>
            <button type="button" onClick={fetchWallet} className="tl-acct-wallet-link" title="Refresh Wallet" aria-label="Refresh wallet">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </>
      }
      contentKey={`${loading}-${filterTab}-${displayedTickets.length}-${Boolean(error)}-${Boolean(successMessage)}-${expandedPayloadId}-${qrVerifyResult?.ticketId || ''}`}
    >
    <AccountSection
      id="tl-passes"
      kicker="Gate passes"
      title="Passes"
      aside={`QR codes rotate every 30 seconds. Next refresh in ${secondsLeft}s.`}
    >
    <div className="max-w-7xl space-y-8 text-slate-800">
      <div className="space-y-8">

        {/* Global Success / Alert Banner */}
        {successMessage && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#16a34a] shrink-0" />
              <div className="font-semibold">{successMessage}</div>
            </div>
            <button onClick={() => setSuccessMessage('')} className="text-emerald-700 hover:text-emerald-950">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <button
            onClick={() => setFilterTab('ACTIVE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${filterTab === 'ACTIVE'
              ? 'bg-[#22c55e] text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
              }`}
          >
            <span>Active Passes</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${filterTab === 'ACTIVE' ? 'bg-black/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
              {activeTicketsCount}
            </span>
          </button>

          <button
            onClick={() => setFilterTab('ALL')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${filterTab === 'ALL'
              ? 'bg-[#22c55e] text-white shadow-sm'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
              }`}
          >
            <span>All Tickets</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${filterTab === 'ALL' ? 'bg-black/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
              {tickets.length}
            </span>
          </button>

          <button
            onClick={() => setFilterTab('SCANNED')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${filterTab === 'SCANNED'
              ? 'bg-slate-800 text-white'
              : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50'
              }`}
          >
            <span>Scanned / Revoked</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${filterTab === 'SCANNED' ? 'bg-black/20 text-white' : 'bg-slate-100 text-slate-700'
              }`}>
              {scannedTicketsCount}
            </span>
          </button>
        </div>

        {/* Tickets Grid */}
        {loading ? (
          <div className="text-center py-20 space-y-4">
            <div className="w-10 h-10 border-4 border-[#22c55e] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Loading your cryptographically signed tickets & NFT passes...</p>
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="text-center py-16 space-y-4 max-w-md mx-auto bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-[#16a34a]">
              <TicketIcon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">No Tickets Found in this Tab</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              {filterTab === 'ACTIVE'
                ? 'You do not have any active unscanned passes. Click "All Tickets" to view previously used passes or browse events to buy new tickets.'
                : 'No tickets matching the selected filter.'}
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                onClick={() => setFilterTab('ALL')}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 transition"
              >
                View All Passes
              </button>
              <Link
                to="/events"
                className="btn-eventfrog text-xs px-5 py-2 shadow-sm"
              >
                Browse Events
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Showing <strong className="text-slate-900">{displayedTickets.length}</strong> passes ({filterTab} filter)</span>
              <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16a34a]" /> All passes secured with HMAC dynamic rotation & 110% resale cap
              </span>
            </div>

            <div className="tl-passes">
              {displayedTickets.map((t) => (
                <WalletPass
                  key={t.id}
                  ticket={t}
                  secondsLeft={secondsLeft}
                  downloading={downloadingId === t.id}
                  verifying={verifyingId === t.id}
                  verifyResult={qrVerifyResult?.ticketId === t.id ? qrVerifyResult : null}
                  payloadOpen={expandedPayloadId === t.id}
                  onDownload={() => handleDownloadPDF(t)}
                  onTransfer={() => {
                    setTransferModalTicket(t);
                    setRecipientEmail('');
                    setTransferError('');
                  }}
                  onResale={() => {
                    setResaleModalTicket(t);
                    setResalePriceInput(String(t.price));
                    setResaleError('');
                  }}
                  onHistory={() => handleOpenTicketHistory(t)}
                  onVerify={() => handleSimulateGateScan(t)}
                  onTogglePayload={() => setExpandedPayloadId(expandedPayloadId === t.id ? null : t.id)}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
    </AccountSection>

    <AccountSection id="tl-wallet-howto" tone="light" kicker="Smart pass" title="Transfer, resell or keep">
      <ol className="tl-acct-rows">
        <li className="tl-acct-row" data-reveal>
          <span className="tl-acct-row-num" aria-hidden="true">01</span>
          <h3>Transfer</h3>
          <p>Choose <strong>Transfer Pass</strong> on an active ticket and enter your friend’s email. Your old QR is revoked and a fresh pass is issued to them.</p>
        </li>
        <li className="tl-acct-row" data-reveal>
          <span className="tl-acct-row-num" aria-hidden="true">02</span>
          <h3>Resell</h3>
          <p>Choose <strong>Resale (≤110%)</strong> to list the ticket on <Link to="/resale" className="underline underline-offset-4 font-semibold">Fan Resale</Link> at up to 110% of its face value.</p>
        </li>
        <li className="tl-acct-row" data-reveal>
          <span className="tl-acct-row-num" aria-hidden="true">03</span>
          <h3>Keep track</h3>
          <p><strong>History</strong> shows a ticket’s chain of custody, and the transfer log lists every pass you’ve sent and received.</p>
        </li>
      </ol>
    </AccountSection>

    <AccountPortal>
      <div>
        {/* MODAL 1: Direct P2P Ticket Transfer Modal */}
        {transferModalTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-md rounded-3xl bg-white border border-slate-200 p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Direct Ticket Transfer</h3>
                    <p className="text-[10px] text-slate-500">Transfer gate pass to another registered user</p>
                  </div>
                </div>
                <button
                  onClick={() => setTransferModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Ticket Preview Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="font-bold text-slate-900 text-sm">{transferModalTicket.event?.name}</div>
                <div className="text-slate-600 text-[11px]">
                  {transferModalTicket.seat?.tierName} • Section {transferModalTicket.seat?.section} • Row {transferModalTicket.seat?.row} #{transferModalTicket.seat?.seatNumber}
                </div>
                <div className="text-purple-700 font-mono text-[10px] pt-1">
                  Polygon NFT #{transferModalTicket.nft?.tokenId || '1024'}
                </div>
              </div>

              {/* Security Alert */}
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <strong>Important:</strong> Once transferred, your gate pass and QR code will be <strong>permanently revoked</strong>. The recipient will receive a brand-new cryptographic rotating QR pass.
                </div>
              </div>

              <form onSubmit={handleExecuteTransfer} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Recipient Registered Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="friend@ticketledger.pk"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs placeholder-slate-400 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    The recipient must have a registered TicketLedger account.
                  </p>
                </div>

                {transferError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                    {transferError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setTransferModalTicket(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={transferSubmitting || !recipientEmail}
                    className="btn-eventfrog text-xs py-2 px-5 disabled:opacity-50"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-md rounded-3xl bg-white border border-slate-200 p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">List for Controlled Resale</h3>
                    <p className="text-[10px] text-slate-500">Strictly regulated 110% anti-scalping price ceiling</p>
                  </div>
                </div>
                <button
                  onClick={() => setResaleModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Price Ceiling Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>Original Face Value:</span>
                  <span className="font-mono font-bold text-slate-900">PKR {Number(resaleModalTicket.price).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-emerald-800 font-semibold border-t border-slate-200 pt-2">
                  <span>Maximum Resale Ceiling (110%):</span>
                  <span className="font-mono font-black text-sm text-slate-900">PKR {Math.floor(Number(resaleModalTicket.price) * 1.10).toLocaleString()}</span>
                </div>
              </div>

              {/* Smart Contract / On-Chain Protection Note */}
              <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  Secondary resale prices are verified on-chain. Predatory markups are blocked. <strong>Waitlist fans will be immediately notified</strong> when this listing is activated.
                </div>
              </div>

              <form onSubmit={handleExecuteResaleListing} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Resale Listing Price (PKR)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Math.floor(Number(resaleModalTicket.price) * 1.10)}
                    required
                    value={resalePriceInput}
                    onChange={(e) => setResalePriceInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-mono font-bold focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                  />
                  <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                    <span>Min: PKR 1</span>
                    <span>Max Allowed: PKR {Math.floor(Number(resaleModalTicket.price) * 1.10).toLocaleString()}</span>
                  </div>
                </div>

                {resaleError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                    {resaleError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setResaleModalTicket(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resaleSubmitting || !resalePriceInput}
                    className="btn-eventfrog text-xs py-2 px-5 disabled:opacity-50"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-4xl rounded-3xl bg-white border border-slate-200 p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Ticket Provenance Chain</h3>
                    <p className="text-[10px] text-slate-500">Verifiable custody and transfer record</p>
                  </div>
                </div>
                <button
                  onClick={() => setHistoryModalTicket(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {historyLoading ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500">Loading custody provenance...</p>
                </div>
              ) : transferHistoryList.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <UserCheck className="w-10 h-10 text-slate-400 mx-auto" />
                  <div className="text-xs font-bold text-slate-900">Original Primary Issuance</div>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    This ticket is in the possession of the original purchaser. No secondary transfers have occurred.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto pr-1">
                  {transferHistoryList.map((h, idx) => (
                    <div
                      key={h.id || idx}
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${h.transferType === 'DIRECT_TRANSFER'
                          ? 'bg-sky-50 text-sky-800 border border-sky-200'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
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
                          <span className="font-semibold text-slate-800">{h.fromUser?.name || 'Seller'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">To: </span>
                          <span className="font-semibold text-slate-800">{h.toUser?.name || 'Buyer'}</span>
                        </div>
                      </div>

                      {h.price > 0 && (
                        <div className="text-[11px] text-emerald-700 font-mono font-bold">
                          Settled Price: PKR {Number(h.price).toLocaleString()}
                        </div>
                      )}

                      <div className="pt-1.5 border-t border-slate-200 flex justify-between items-center text-[10px] font-mono text-slate-500">
                        <span>Nonce Rotated:</span>
                        <span className="text-slate-700">{h.newNonce?.slice(0, 12)}...</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => setHistoryModalTicket(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL 4: User's Overall Sent & Received Transfers Log */}
        {showMyTransfersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-4xl rounded-3xl bg-white border border-slate-200 p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Personal Transfer Activity Log</h3>
                    <p className="text-[10px] text-slate-500">All passes sent and received by your account</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMyTransfersModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {myTransfersLoading ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500">Loading transfer history...</p>
                </div>
              ) : myTransfersData.sent.length === 0 && myTransfersData.received.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <History className="w-10 h-10 text-slate-400 mx-auto" />
                  <div className="text-xs font-bold text-slate-900">No Transfer Records</div>
                  <p className="text-[11px] text-slate-500">
                    You have not sent or received any tickets through peer-to-peer transfer or resale.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 overflow-y-auto pr-1">
                  {/* Received Passes */}
                  {myTransfersData.received.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#16a34a]" />
                        <span>Passes Received ({myTransfersData.received.length})</span>
                      </div>
                      <div className="space-y-2">
                        {myTransfersData.received.map((rec) => (
                          <div key={rec.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-center gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{rec.ticket?.event?.name}</div>
                              <div className="text-[11px] text-slate-500">
                                Transferred by: <strong className="text-slate-800">{rec.fromUser?.name}</strong> ({rec.fromUser?.email})
                              </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-500">
                              {new Date(rec.createdAt).toLocaleDateString('en-PK')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sent Passes */}
                  {myTransfersData.sent.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="text-xs font-bold text-sky-800 flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5 text-sky-600" />
                        <span>Passes Sent ({myTransfersData.sent.length})</span>
                      </div>
                      <div className="space-y-2">
                        {myTransfersData.sent.map((sen) => (
                          <div key={sen.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-center gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{sen.ticket?.event?.name}</div>
                              <div className="text-[11px] text-slate-500">
                                Transferred to: <strong className="text-slate-800">{sen.toUser?.name}</strong> ({sen.toUser?.email})
                              </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-500">
                              {new Date(sen.createdAt).toLocaleDateString('en-PK')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => setShowMyTransfersModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AccountPortal>
    </AccountShell>
  );
}
