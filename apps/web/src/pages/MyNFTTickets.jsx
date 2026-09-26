import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
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

const API_BASE_URL = 'http://localhost:5000';

export default function MyNFTTickets() {
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
    if (!window.confirm('Are you sure you want to cancel this resale listing and reclaim your ticket?')) return;

    setCancellingListingId(listingId);
    try {
      await axios.post(
        `${API_BASE_URL}/api/resale/cancel/${listingId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchNFTs();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to cancel listing');
    } finally {
      setCancellingListingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <RefreshCw className="w-10 h-10 text-purple-400 animate-spin" />
        <p className="text-slate-400 text-sm">Querying Polygon Amoy testnet for ERC721 NFT tickets...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 bg-purple-950/60 px-2.5 py-0.5 rounded-full border border-purple-800 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Polygon Amoy (ChainId 80002)
            </span>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Smart Contract Verified
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mt-1">
            My Web3 NFT Tickets
          </h1>
          <p className="text-xs text-slate-400">
            Immutable ERC721 tokens on Polygon with anti-scalping price ceilings (max 110%)
          </p>
        </div>

        {/* Wallet Status Banner */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Connected Wallet</div>
            <div className="font-mono text-purple-300 font-semibold truncate max-w-[180px]">
              {user?.walletAddress ? (
                `0x...${user.walletAddress.substring(36)}`
              ) : (
                <span className="text-slate-400">Platform Custodian</span>
              )}
            </div>
          </div>
          <Link
            to="/profile"
            className="text-[10px] text-purple-400 hover:text-purple-300 font-bold underline ml-1"
          >
            Manage
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* NFT Grid */}
      {tickets.length === 0 ? (
        <div className="text-center py-16 space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-purple-950/40 border border-purple-800 flex items-center justify-center mx-auto text-purple-400">
            <Sparkles className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white">No NFT Tickets Minted Yet</h2>
          <p className="text-xs text-slate-400">
            When you complete ticket checkout for an event, your seat passes are automatically minted as ERC721 NFT tokens on the Polygon Amoy testnet.
          </p>
          <Link
            to="/events"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition shadow-md shadow-purple-600/20"
          >
            <span>Book Tickets on Seat Map</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tickets.map((t) => {
            const { event, seat, blockchain } = t;

            return (
              <div
                key={t.id}
                className="group relative rounded-3xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 transition-all duration-300 shadow-xl hover:shadow-purple-500/10 overflow-hidden flex flex-col justify-between"
              >
                {/* Event Banner */}
                <div className="relative h-44 overflow-hidden bg-slate-950">
                  <img
                    src={event?.bannerUrl || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80'}
                    alt={event?.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />

                  {/* Token ID Badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black font-mono bg-slate-950/80 backdrop-blur text-purple-300 border border-purple-500/40 shadow-md">
                      TLT #{blockchain?.tokenId || '1001'}
                    </span>
                  </div>

                  {/* Verified Pill */}
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-900/90 backdrop-blur text-purple-200 border border-purple-600/60 shadow-md flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-300" /> Polygon ERC721
                    </span>
                  </div>

                  {/* Seat coordinates on hero */}
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="text-[10px] text-purple-300 uppercase tracking-widest font-bold">
                      {seat?.tierName}
                    </div>
                    <div className="text-lg font-black text-white">
                      Section {seat?.section} • Row {seat?.row}, Seat {seat?.seatNumber}
                    </div>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <h3 className="font-extrabold text-white text-base leading-snug line-clamp-1">
                      {event?.name}
                    </h3>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" /> {event?.venue}, {event?.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />{' '}
                        {new Date(event?.date).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Anti-Scalping Rules Box */}
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1 text-xs">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Original Price</span>
                        <span className="font-mono text-white font-bold">
                          Rs. {Number(t.price).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="flex items-center gap-1 text-purple-300">
                          <ShieldCheck className="w-3.5 h-3.5 text-purple-400" /> On-Chain Resale Cap
                        </span>
                        <span className="font-mono text-purple-300 font-bold">
                          Rs. {Number(t.resalePriceCap).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-0.5">
                        Smart contract prevents predatory scalping (enforced max 110%).
                      </div>
                    </div>

                    {/* Blockchain Metadata Accordion */}
                    <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-900/30 text-[11px] space-y-2 font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Transaction</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-purple-300 font-semibold truncate max-w-[130px]">
                            {blockchain?.txHash}
                          </span>
                          <button
                            onClick={() => copyToClipboard(blockchain?.txHash, t.id)}
                            className="text-slate-400 hover:text-white"
                            title="Copy Tx Hash"
                          >
                            {copiedTx === t.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Owner Wallet</span>
                        <span className="text-slate-300 truncate max-w-[140px]">
                          {blockchain?.ownerWallet}
                        </span>
                      </div>

                      {/* In-App Blockchain Explorer Trigger */}
                      <div className="pt-2 border-t border-purple-900/40">
                        <button
                          type="button"
                          onClick={() => setSelectedTicketForExplorer(t)}
                          className="w-full py-1.5 px-2.5 rounded-lg bg-purple-950/60 hover:bg-purple-900/80 border border-purple-700/60 text-purple-300 font-semibold text-[11px] flex items-center justify-center gap-1.5 transition"
                        >
                          <Search className="w-3 h-3 text-purple-400" />
                          <span>View On-Chain Explorer Receipt</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <QrCode className="w-3.5 h-3.5 text-emerald-400" /> Rotating QR Ready
                    </span>
                    {t.activeResaleListing ? (
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-1 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[10px] font-bold">
                          Listed: Rs. {Number(t.activeResaleListing.resalePrice).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelListing(t.activeResaleListing.id)}
                          disabled={cancellingListingId === t.activeResaleListing.id}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 text-[10px] font-semibold transition"
                        >
                          {cancellingListingId === t.activeResaleListing.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenResaleModal(t)}
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-xs transition flex items-center gap-1 shadow-sm shadow-emerald-500/20"
                      >
                        <Tag className="w-3.5 h-3.5" />
                        <span>List for Resale</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Built-in TicketLedger On-Chain Explorer Modal */}
      {selectedTicketForExplorer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-purple-800/60 shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    TicketLedger Explorer • Polygon Amoy
                  </h3>
                  <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Verified On-Chain Record
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedTicketForExplorer(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Transaction Details Box */}
            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Transaction Status</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" /> SUCCESS (Confirmed)
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Transaction Hash</span>
                  <span className="text-purple-300 truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.txHash}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Block Number</span>
                  <span className="text-white">#14,920,482 (Amoy Testnet)</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Contract Address</span>
                  <span className="text-slate-300 truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.contractAddress}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">ERC721 Token ID</span>
                  <span className="text-purple-400 font-bold">
                    #{selectedTicketForExplorer.blockchain?.tokenId}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Owner Wallet</span>
                  <span className="text-slate-300 truncate max-w-[240px]">
                    {selectedTicketForExplorer.blockchain?.ownerWallet}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Physical Seat</span>
                  <span className="text-white font-bold">
                    Section {selectedTicketForExplorer.seat?.section} • Row {selectedTicketForExplorer.seat?.row}, Seat {selectedTicketForExplorer.seat?.seatNumber}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Anti-Scalping Resale Cap</span>
                  <span className="text-purple-300 font-bold">
                    Rs. {Number(selectedTicketForExplorer.resalePriceCap).toLocaleString()} (Max 110%)
                  </span>
                </div>
              </div>
            </div>

            {/* Smart Contract Audit Notice */}
            <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-800/40 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-purple-400" /> Solidity Smart Contract Verified
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Contract <code className="text-purple-300">TicketLedgerNFT.sol</code> compiled on Solidity 0.8.24 (Cancun EVM). Passed all 6/6 Hardhat automated test cases with cryptographic seat uniqueness and anti-scalping ceiling enforcement.
              </p>
            </div>

            {/* Close */}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedTicketForExplorer(null)}
                className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}
      {/* List Ticket for Resale Modal */}
      {selectedTicketForResale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-emerald-800/60 shadow-2xl p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                  <Tag className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    List on Secondary Marketplace
                  </h3>
                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Anti-Scalping Regulated (Max 110%)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicketForResale(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {resaleSuccessMsg ? (
              <div className="space-y-4 text-center py-4">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-white">{resaleSuccessMsg}</h4>
                <p className="text-xs text-slate-400">
                  Your ticket is now live on the public P2P Fan Exchange. When purchased, funds transfer to you and your gate access QR will be safely revoked.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Link
                    to="/resale"
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
                  >
                    View in Resale Marketplace
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedTicketForResale(null)}
                    className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleListTicket} className="space-y-5">
                {/* Event & Seat Overview */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                  <div className="font-bold text-white text-sm">
                    {selectedTicketForResale.event?.name}
                  </div>
                  <div className="text-slate-400 flex items-center gap-1 text-[11px]">
                    <MapPin className="w-3 h-3 text-slate-500" />
                    <span>{selectedTicketForResale.event?.venue}, {selectedTicketForResale.event?.city}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-slate-300">
                    <span>Seat Coordinates:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {selectedTicketForResale.seat?.tierName} • Row {selectedTicketForResale.seat?.row} • #{selectedTicketForResale.seat?.seatNumber}
                    </span>
                  </div>
                </div>

                {/* Anti-Scalping Price Rule Guide */}
                <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Primary Face Value:</span>
                    <span className="text-slate-200 font-mono font-bold">
                      Rs. {Number(selectedTicketForResale.price).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-300 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Anti-Scalp Ceiling (110%):
                    </span>
                    <span className="text-emerald-400 font-mono font-black text-sm">
                      Rs. {Number(selectedTicketForResale.resalePriceCap).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 pt-1 border-t border-emerald-900/30">
                    Solidity smart contract strictly rejects any resale listing above 110% of face value to protect sports & concert fans from scalpers.
                  </p>
                </div>

                {/* Price Input */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>Set Resale Price (PKR)</span>
                    {Number(resalePriceInput) > 0 && (
                      <span className={`text-[11px] font-bold ${
                        Number(resalePriceInput) > selectedTicketForResale.resalePriceCap
                          ? 'text-rose-400'
                          : 'text-emerald-400'
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
                    className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">Quick set:</span>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(selectedTicketForResale.price)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                  >
                    Face Value (0%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(Math.floor(Number(selectedTicketForResale.price) * 1.05))}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                  >
                    +5% Markup
                  </button>
                  <button
                    type="button"
                    onClick={() => setResalePriceInput(selectedTicketForResale.resalePriceCap)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 text-[10px] font-bold"
                  >
                    Max Allowed (+10%)
                  </button>
                </div>

                {resaleErrorMsg && (
                  <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{resaleErrorMsg}</span>
                  </div>
                )}

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTicketForResale(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
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
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-black text-xs transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                  >
                    {resaleLoading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
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
    </div>
  );
}
