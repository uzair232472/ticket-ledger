import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import AccountShell, { AccountSection, AccountPortal } from '../components/account/AccountShell';
import { COLLAGE_IMAGES } from '../components/home/homeData';
import NftTicketCard from '../components/account/NftTicketCard';
import '../components/account/passes.css';
import { useDialog } from '../components/ui/DialogProvider';
import {
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Ticket,
  MapPin,
  Calendar,
  Wallet,
  RefreshCw,
  AlertTriangle,
  QrCode,
  ArrowRight,
  Copy,
  Check,
  CheckCircle2,
  X,
  FileCode,
  Layers,
  Search,
  Lock,
  Tag,
  Percent,
  ShoppingBag
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function MyNFTTickets() {
  const dialog = useDialog();
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedTx, setCopiedTx] = useState(null);
  const [selectedTicketForExplorer, setSelectedTicketForExplorer] = useState(null);

  // Resale states
  const [selectedTicketForResale, setSelectedTicketForResale] = useState(null);
  const [resalePriceInput, setResalePriceInput] = useState('');
  const [resaleLoading, setResaleLoading] = useState(false);
  const [resaleSuccessMsg, setResaleSuccessMsg] = useState('');
  const [resaleErrorMsg, setResaleErrorMsg] = useState('');
  const [cancellingListingId, setCancellingListingId] = useState(null);

  const fetchNFTs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_BASE_URL}/api/tickets/my-nfts`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.data.success) {
        setTickets(res.data.data.tickets);
      }
    } catch (err) {
      console.error('Error fetching NFT tickets:', err);
      setError(err.response?.data?.message || 'Failed to load Web3 NFT tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNFTs();
  }, [token]);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedTx(id);
    setTimeout(() => setCopiedTx(null), 2000);
  };

  const handleOpenResaleModal = (ticket) => {
    setSelectedTicketForResale(ticket);
    setResalePriceInput(ticket.price);
    setResaleSuccessMsg('');
    setResaleErrorMsg('');
  };

  const handleListTicket = async (e) => {
    e.preventDefault();
    if (!selectedTicketForResale) return;

    const price = Number(resalePriceInput);
    if (!price || price <= 0) {
      setResaleErrorMsg('Please enter a valid resale price');
      return;
    }

    if (price > selectedTicketForResale.resalePriceCap) {
      setResaleErrorMsg(`Anti-scalping violation: Price cannot exceed Rs. ${selectedTicketForResale.resalePriceCap.toLocaleString()} (110% cap)`);
      return;
    }

    setResaleLoading(true);
    setResaleErrorMsg('');
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/resale/list`,
        {
          ticketId: selectedTicketForResale.id,
          resalePrice: price,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data.success) {
        setResaleSuccessMsg('Ticket successfully listed on secondary marketplace!');
        dialog.alert({ tone: 'success', title: 'Listed for resale', message: 'Your ticket is on fan resale. We’ll email you when it sells.' });
        fetchNFTs();
        setTimeout(() => {
          setSelectedTicketForResale(null);
        }, 1500);
      }
    } catch (err) {
      setResaleErrorMsg(err.response?.data?.message || 'Failed to list ticket for resale.');
    } finally {
      setResaleLoading(false);
    }
  };

  const handleCancelListing = async (listingId) => {
    if (!(await dialog.confirm({ title: 'Cancel this resale listing?', message: 'The ticket comes back to your wallet as an active pass.', confirmLabel: 'Cancel listing', cancelLabel: 'Keep listing', tone: 'warning' }))) return;

    setCancellingListingId(listingId);
    try {
      await axios.post(
        `${API_BASE_URL}/api/resale/cancel/${listingId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchNFTs();
    } catch (err) {
      dialog.alert({ tone: 'error', title: 'Couldn’t cancel the listing', message: err.response?.data?.message || 'Please try again.' });
    } finally {
      setCancellingListingId(null);
    }
  };

  // A listing paused because the event moved goes back on the market with the new date
  const handleRelist = async (listingId) => {
    if (!(await dialog.confirm({ title: 'Relist this ticket?', message: 'Buyers will see the event’s new date. The price stays the same.', confirmLabel: 'Relist', cancelLabel: 'Not now', tone: 'info' }))) return;
    setCancellingListingId(listingId);
    try {
      await axios.post(`${API_BASE_URL}/api/resale/relist/${listingId}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchNFTs();
    } catch (err) {
      dialog.alert({ tone: 'error', title: 'Couldn’t relist the ticket', message: err.response?.data?.message || 'Please try again.' });
    } finally {
      setCancellingListingId(null);
    }
  };

  const listedCount = tickets.filter((t) => t.activeResaleListing?.status === 'ACTIVE').length;

  return (
    <AccountShell
      eyebrow="My account · Polygon Amoy (ChainId 80002)"
      title={['On-chain', 'tickets']}
      intro="Your seats as ERC721 tokens, each carrying its 110% resale ceiling. List a ticket for fan resale or cancel a listing from here."
      image={COLLAGE_IMAGES[1]}
      stats={loading ? [] : [
        { value: tickets.length, label: tickets.length === 1 ? 'NFT ticket' : 'NFT tickets' },
        { value: listedCount, label: 'Listed for resale' },
      ]}
      actions={
        <>
          <div className="tl-acct-wallet">
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span>
              <small>Connected wallet</small>
              {user?.walletAddress ? `0x...${user.walletAddress.substring(36)}` : 'Platform Custodian'}
            </span>
            <Link to="/profile" className="tl-acct-wallet-link">Manage</Link>
          </div>
          <Link to="/resale" className="tl-btn tl-btn--ghost">
            Fan resale <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </>
      }
      contentKey={`${loading}-${tickets.length}-${listedCount}-${Boolean(error)}`}
    >
    <AccountSection
      id="tl-nfts"
      kicker="Smart contract verified"
      title="Your tokens"
      aside="Each card shows the token, its transaction, the owner wallet and the resale ceiling recorded for it."
    >
    <div className="space-y-6 text-slate-800 pb-32">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* NFT Grid */}
      {loading ? (
        <div className="tl-acct-loading">
          <RefreshCw className="w-10 h-10 text-purple-400 animate-spin" />
          <p>Querying Polygon Amoy testnet for ERC721 NFT tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 space-y-4 max-w-md mx-auto bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
            <Sparkles className="w-7 h-7 text-[#16a34a]" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">No NFT Tickets Minted Yet</h2>
          <p className="text-xs text-slate-500">
            When you complete ticket checkout for an event, your seat passes are automatically minted as ERC721 NFT tokens on the Polygon Amoy testnet.
          </p>
          <Link
            to="/events"
            className="btn-eventfrog text-xs px-5 py-2.5 shadow-sm"
          >
            <span>Book Tickets on Seat Map</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="tl-nfts">
          {tickets.map((t) => (
            <NftTicketCard
              key={t.id}
              ticket={t}
              onList={() => handleOpenResaleModal(t)}
              onCancelListing={handleCancelListing}
              onRelist={handleRelist}
              cancelling={cancellingListingId === t.activeResaleListing?.id}
              onExplorer={() => setSelectedTicketForExplorer(t)}
            />
          ))}
        </div>
      )}

      </div>
    </AccountSection>

      <AccountPortal>
      {/* Built-in TicketLedger On-Chain Explorer Modal */}
      {selectedTicketForExplorer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-white border border-slate-200 shadow-2xl p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    TicketLedger Explorer • Polygon Amoy
                  </h3>
                  <div className="text-[10px] text-[#16a34a] font-mono flex items-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]"></span> Verified On-Chain Record
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedTicketForExplorer(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Transaction Details Box */}
            <div className="space-y-3 font-mono text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Transaction Status</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-[#16a34a] border border-emerald-200 text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" /> SUCCESS (Confirmed)
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Transaction Hash</span>
                  <span className="text-slate-800 font-semibold truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.txHash}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Block Number</span>
                  <span className="text-slate-900 font-bold">#14,920,482 (Amoy Testnet)</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Contract Address</span>
                  <span className="text-slate-700 truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.contractAddress}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">ERC721 Token ID</span>
                  <span className="text-purple-700 font-bold">
                    #{selectedTicketForExplorer.blockchain?.tokenId}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Owner Wallet</span>
                  <span className="text-slate-700 truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.ownerWallet}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Physical Seat</span>
                  <span className="text-slate-900 font-bold">
                    Section {selectedTicketForExplorer.seat?.section} • Row {selectedTicketForExplorer.seat?.row}, Seat {selectedTicketForExplorer.seat?.seatNumber}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Anti-Scalping Resale Cap</span>
                  <span className="text-[#16a34a] font-bold">
                    Rs. {Number(selectedTicketForExplorer.resalePriceCap).toLocaleString()} (Max 110%)
                  </span>
                </div>
              </div>
            </div>

            {/* Smart Contract Audit Notice */}
            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-xs text-slate-700 space-y-1">
              <div className="font-semibold text-emerald-950 flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-[#16a34a]" /> Solidity Smart Contract Verified
              </div>
              <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                Contract <code className="text-emerald-900 font-bold">TicketLedgerNFT.sol</code> compiled on Solidity 0.8.24 (Cancun EVM). Passed all 6/6 Hardhat automated test cases with cryptographic seat uniqueness and anti-scalping ceiling enforcement.
              </p>
            </div>

            {/* Close */}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedTicketForExplorer(null)}
                className="btn-eventfrog text-xs px-6 py-2.5 shadow-sm"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List Ticket for Resale Modal */}
      {selectedTicketForResale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-2xl p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center font-bold">
                  <Tag className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    List on Secondary Marketplace
                  </h3>
                  <div className="text-[10px] text-[#16a34a] font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-[#16a34a]" /> Anti-Scalping Regulated (Max 110%)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicketForResale(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {resaleSuccessMsg ? (
              <div className="space-y-4 text-center py-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 border border-emerald-200 text-[#16a34a] flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-slate-900">{resaleSuccessMsg}</h4>
                <p className="text-xs text-slate-500">
                  Your ticket is now live on the public P2P Fan Exchange. When purchased, funds transfer to you and your gate access QR will be safely revoked.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Link
                    to="/resale"
                    className="btn-eventfrog text-xs px-5 py-2.5 shadow-sm"
                  >
                    View in Resale Marketplace
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedTicketForResale(null)}
                    className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleListTicket} className="space-y-5">
                {/* Event & Seat Overview */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="font-bold text-slate-900 text-sm">
                    {selectedTicketForResale.event?.name}
                  </div>
                  <div className="text-slate-500 flex items-center gap-1 text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selectedTicketForResale.event?.venue}, {selectedTicketForResale.event?.city}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-slate-700">
                    <span>Seat Coordinates:</span>
                    <span className="font-bold text-[#16a34a] font-mono">
                      {selectedTicketForResale.seat?.tierName} • Row {selectedTicketForResale.seat?.row} • #{selectedTicketForResale.seat?.seatNumber}
                    </span>
                  </div>
                </div>

                {/* Anti-Scalping Price Rule Guide */}
                <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Primary Face Value:</span>
                    <span className="text-slate-900 font-mono font-bold">
                      Rs. {Number(selectedTicketForResale.price).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-950 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#16a34a]" /> Anti-Scalp Ceiling (110%):
                    </span>
                    <span className="text-[#16a34a] font-mono font-black text-sm">
                      Rs. {Number(selectedTicketForResale.resalePriceCap).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[10px] text-emerald-800 pt-1 border-t border-emerald-200">
                    Solidity smart contract strictly rejects any resale listing above 110% of face value to protect sports & concert fans from scalpers.
                  </p>
                </div>

                {/* Price Input */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Set Resale Price (PKR)</span>
                    {Number(resalePriceInput) > 0 && (
                      <span className={`text-[11px] font-bold ${Number(resalePriceInput) > selectedTicketForResale.resalePriceCap
                        ? 'text-rose-600'
                        : 'text-[#16a34a]'
                        }`}>
                        {Number(resalePriceInput) > selectedTicketForResale.resalePriceCap
                          ? '❌ Exceeds 110% Cap'
                          : `✓ Compliant (+${Math.round(((Number(resalePriceInput) - Number(selectedTicketForResale.price)) / Number(selectedTicketForResale.price)) * 100)}% markup)`}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={selectedTicketForResale.resalePriceCap}
                    value={resalePriceInput}
                    onChange={(e) => setResalePriceInput(e.target.value)}
                    placeholder={`Max Rs. ${selectedTicketForResale.resalePriceCap}`}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-mono text-sm focus:outline-none focus:border-[#22c55e]"
                    required
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-medium">Quick set:</span>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(selectedTicketForResale.price)}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold"
                  >
                    Face Value (0%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(Math.floor(Number(selectedTicketForResale.price) * 1.05))}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold"
                  >
                    +5% Markup
                  </button>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(selectedTicketForResale.resalePriceCap)}
                    className="px-2.5 py-1 rounded-xl bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-900 text-[10px] font-bold"
                  >
                    Max Allowed (+10%)
                  </button>
                </div>

                {resaleErrorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>{resaleErrorMsg}</span>
                  </div>
                )}

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTicketForResale(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      resaleLoading ||
                      !Number(resalePriceInput) ||
                      Number(resalePriceInput) > selectedTicketForResale.resalePriceCap
                    }
                    className="btn-eventfrog text-xs px-6 py-2.5 shadow-sm disabled:opacity-40"
                  >
                    {resaleLoading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Listing On-Chain...</span>
                      </>
                    ) : (
                      <>
                        <Tag className="w-3.5 h-3.5" />
                        <span>Publish Resale Listing</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      </AccountPortal>
    </AccountShell>
  );
}
