import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Tag,
  Search,
  Filter,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  MapPin,
  Ticket as TicketIcon,
  CreditCard,
  Lock,
  RefreshCw,
  ShoppingBag,
  ExternalLink,
  ChevronRight,
  Layers,
  Percent
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

export default function ResaleMarketplace() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');

  // Purchase modal states
  const [selectedListing, setSelectedListing] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(null);
  const [purchaseError, setPurchaseError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('TEST_INSTANT');

  // Fetch listings
  const fetchListings = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (selectedCity) params.append('city', selectedCity);
      if (maxPriceFilter) params.append('maxPrice', maxPriceFilter);

      const res = await fetch(`${API_BASE}/resale/market?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch resale tickets');
      setListings(data.data?.listings || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchListings();
  }, [selectedCity]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchListings();
  };

  const handleBuyTicket = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!selectedListing) return;

    setPurchasing(true);
    setPurchaseError('');

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/resale/buy/${selectedListing.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentMethod }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Secondary ticket purchase failed');
      }

      setPurchaseSuccess(data.data);
      // Refresh listings
      fetchListings();
    } catch (err) {
      setPurchaseError(err.message);
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Anti-Scalping Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950/60 via-slate-900 to-purple-950/40 border border-emerald-800/40 p-6 sm:p-10 shadow-2xl">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-900/60 border border-emerald-600/50 text-emerald-300 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Anti-Scalping Protected P2P Marketplace
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                Verified Secondary Fan Exchange
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Buy and resell authentic event tickets directly with fellow fans. All listings are bounded by an 
                <strong className="text-emerald-400"> immutable 110% price ceiling</strong> enforced by our Polygon smart contracts, preventing predatory black-market markups and ticket botting.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-400">
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Max 10% Profit Margin
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800">
                  <Lock className="w-4 h-4 text-purple-400" /> Instant QR Nonce Revocation
                </div>
                <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800">
                  <Sparkles className="w-4 h-4 text-teal-400" /> ERC721 NFT On-Chain Transfer
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0">
              <Link
                to="/my-nfts"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20"
              >
                <Tag className="w-4 h-4" />
                <span>List My Ticket for Resale</span>
              </Link>
              <Link
                to="/events"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-sm transition"
              >
                <TicketIcon className="w-4 h-4 text-slate-400" />
                <span>Explore Primary Box Office</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-slate-900/70 border border-slate-800 p-4 rounded-2xl backdrop-blur-sm">
          <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search event, team, artist..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* City Filter */}
            <div>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">All Pakistan Cities</option>
                <option value="Lahore">Lahore</option>
                <option value="Karachi">Karachi</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Multan">Multan</option>
                <option value="Peshawar">Peshawar</option>
              </select>
            </div>

            {/* Max Price Filter */}
            <div>
              <input
                type="number"
                value={maxPriceFilter}
                onChange={(e) => setMaxPriceFilter(e.target.value)}
                placeholder="Max Price (PKR)"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Submit & Reset Button */}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20"
              >
                <Filter className="w-3.5 h-3.5" /> Apply
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCity('');
                  setMaxPriceFilter('');
                  fetchListings();
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                title="Reset filters"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

        {/* Listings Content */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 space-y-4">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading verified secondary marketplace tickets...</p>
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-16 space-y-4 bg-slate-900/40 border border-slate-800 rounded-3xl p-8 max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
              <Tag className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white">No Resale Tickets Available Right Now</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              There are currently no tickets listed for resale matching your filters. You can check back later or explore primary box office tickets.
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <Link
                to="/events"
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
              >
                Browse All Events
              </Link>
              <Link
                to="/my-nfts"
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
              >
                List a Ticket
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((item) => {
              const { event, seat, seller } = item;
              const isOwner = user?.id === seller?.id;

              return (
                <div
                  key={item.id}
                  className="rounded-3xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl hover:border-emerald-500/50 transition-all flex flex-col group"
                >
                  {/* Event Banner */}
                  <div className="relative h-44 w-full bg-slate-950 overflow-hidden">
                    {event?.bannerUrl ? (
                      <img
                        src={event.bannerUrl}
                        alt={event.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-tr from-slate-900 to-slate-800 flex items-center justify-center">
                        <TicketIcon className="w-12 h-12 text-slate-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

                    {/* Anti-Scalping Verification Badge */}
                    <div className="absolute top-3 left-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950/90 border border-emerald-600/70 text-emerald-300 backdrop-blur-md shadow">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" /> Max 110% Compliant
                      </span>
                    </div>

                    {/* Markup Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-950/90 border border-purple-600/70 text-purple-300 backdrop-blur-md">
                        <Percent className="w-2.5 h-2.5" /> +{item.markupPercent}% Markup
                      </span>
                    </div>

                    {/* Event Title on Image */}
                    <div className="absolute bottom-3 left-3 right-3">
                      <span className="text-[10px] font-bold uppercase text-emerald-400 tracking-wider">
                        {event?.type?.replace('_', ' ')}
                      </span>
                      <h3 className="text-base font-bold text-white truncate drop-shadow">
                        {event?.name}
                      </h3>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      {/* Venue & Time */}
                      <div className="space-y-1 text-xs text-slate-400">
                        <div className="flex items-center gap-1.5 truncate">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{event?.venue}, {event?.city}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span>{event?.date ? new Date(event.date).toLocaleDateString('en-PK', { dateStyle: 'medium' }) : 'TBD'} • {event?.time}</span>
                        </div>
                      </div>

                      {/* Seat Coordinate Details */}
                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Tier</div>
                          <div className="text-white font-bold truncate">{seat?.tierName || 'Standard'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Row</div>
                          <div className="text-white font-bold font-mono">{seat?.row || 'GA'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">Seat</div>
                          <div className="text-emerald-400 font-bold font-mono">#{seat?.seatNumber}</div>
                        </div>
                      </div>

                      {/* Price Matrix Comparison */}
                      <div className="p-3 rounded-2xl bg-emerald-950/20 border border-emerald-900/40 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Resale Price</span>
                          <span className="text-lg font-black text-white font-mono">
                            Rs. {item.resalePrice.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                          <span>Original Box-Office Price:</span>
                          <span className="font-mono text-slate-300">Rs. {item.originalPrice.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-emerald-400">
                          <span>Anti-Scalping Ceiling (110%):</span>
                          <span className="font-mono font-bold">Rs. {item.maxAllowedCeiling.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Verified Seller Info */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                        <span>Seller: <strong className="text-slate-300">{seller?.name || 'Verified Fan'}</strong></span>
                        <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> Legit Ticket
                        </span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div>
                      {isOwner ? (
                        <div className="w-full py-2.5 px-4 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold text-center border border-slate-700">
                          Your Active Listing
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!isAuthenticated) {
                              navigate('/login');
                              return;
                            }
                            setSelectedListing(item);
                            setPurchaseSuccess(null);
                            setPurchaseError('');
                          }}
                          className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                        >
                          <ShoppingBag className="w-4 h-4" />
                          <span>Buy for Rs. {item.resalePrice.toLocaleString()}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Instant Purchase & Ownership Transfer Modal */}
      {selectedListing && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 space-y-6 shadow-2xl relative">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase text-emerald-400 tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Anti-Scalp Verified Secondary Purchase
                </span>
                <h3 className="text-xl font-black text-white mt-1">
                  Confirm Ticket Transfer
                </h3>
              </div>
              <button
                onClick={() => setSelectedListing(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>

            {purchaseSuccess ? (
              <div className="space-y-5 text-center py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xl font-bold text-white">Ownership Transferred!</h4>
                  <p className="text-xs text-slate-300">
                    The ERC721 NFT ticket is now stored in your account. The seller's gate pass has been revoked, and a fresh rotating QR code is issued for you.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2 text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Event</span>
                    <span className="text-white font-bold">{purchaseSuccess.ticket?.event?.name || selectedListing.event.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Seat</span>
                    <span className="text-emerald-400 font-bold">
                      {selectedListing.seat?.tierName} • Row {selectedListing.seat?.row}, Seat #{selectedListing.seat?.seatNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Paid Amount</span>
                    <span className="text-white font-mono font-bold">Rs. {selectedListing.resalePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gate Security Nonce</span>
                    <span className="font-mono text-purple-400 truncate max-w-[150px]">
                      {purchaseSuccess.ticket?.qrNonce}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Link
                    to="/my-nfts"
                    className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-4 h-4" /> View My NFT Tickets
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedListing(null)}
                    className="py-3 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Event & Seat Summary */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                  <div className="text-white font-bold text-sm">{selectedListing.event.name}</div>
                  <div className="text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{selectedListing.event.venue}, {selectedListing.event.city}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-slate-300">
                    <span>Seat Coordinates:</span>
                    <span className="font-bold text-emerald-400">
                      {selectedListing.seat?.tierName} • Row {selectedListing.seat?.row} • #{selectedListing.seat?.seatNumber}
                    </span>
                  </div>
                </div>

                {/* Price Matrix */}
                <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-900/40 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Primary Face Value:</span>
                    <span className="text-slate-300 font-mono">Rs. {selectedListing.originalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Secondary Fan Price:</span>
                    <span className="text-emerald-400 font-mono font-bold">Rs. {selectedListing.resalePrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-purple-300">
                    <span>Markup:</span>
                    <span>+{selectedListing.markupPercent}% (Legally capped at 10%)</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between text-sm font-bold text-white">
                    <span>Total Due:</span>
                    <span className="font-mono text-emerald-400 text-base">Rs. {selectedListing.resalePrice.toLocaleString()}</span>
                  </div>
                </div>

                {/* Payment Gateway Picker */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Select Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('TEST_INSTANT')}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition ${
                        paymentMethod === 'TEST_INSTANT'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <CreditCard className="w-4 h-4 text-emerald-400" />
                      <span>1-Click Test</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('JAZZCASH')}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition ${
                        paymentMethod === 'JAZZCASH'
                          ? 'bg-red-950/60 border-red-500 text-red-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span className="font-bold text-red-400 text-sm">JC</span>
                      <span>JazzCash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('EASYPAISA')}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition ${
                        paymentMethod === 'EASYPAISA'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span className="font-bold text-emerald-400 text-sm">EP</span>
                      <span>EasyPaisa</span>
                    </button>
                  </div>
                </div>

                {purchaseError && (
                  <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{purchaseError}</span>
                  </div>
                )}

                {/* Confirm Button */}
                <button
                  type="button"
                  disabled={purchasing}
                  onClick={handleBuyTicket}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {purchasing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      <span>Processing Ownership Transfer...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Confirm & Claim Ownership (Rs. {selectedListing.resalePrice.toLocaleString()})</span>
                    </>
                  )}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
