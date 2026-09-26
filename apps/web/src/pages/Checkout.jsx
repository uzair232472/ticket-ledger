import React, { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import {
  CreditCard,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Lock,
  ChevronRight,
  Ticket,
  MapPin,
  Calendar,
  Sparkles,
  Zap,
  Info
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000';

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const checkoutState = location.state || {};
  const { eventId, event, seats = [], totalPrice = 0 } = checkoutState;

  const [paymentMethod, setPaymentMethod] = useState('MOCK'); // 'STRIPE', 'JAZZCASH', 'EASYPAISA', 'MOCK'
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '03001234567');
  const [otpCode, setOtpCode] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stripe mock fields
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvc, setCardCvc] = useState('123');
  const [cardName, setCardName] = useState(user?.name || 'Hamza Khan');

  if (!seats || seats.length === 0 || !eventId) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">No Seats Selected for Checkout</h2>
        <p className="text-xs text-slate-400">
          Your seat lock may have expired or you have not chosen any seats yet.
        </p>
        <Link
          to="/events"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
        >
          <ArrowLeft className="w-4 h-4" /> Browse Available Events
        </Link>
      </div>
    );
  }

  const handleProcessPayment = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const authHeaders = { Authorization: `Bearer ${token}` };

      // Step 1: Initiate Booking (Creates Pending Order & holds inventory)
      const initiateRes = await axios.post(
        `${API_BASE_URL}/api/bookings/initiate`,
        {
          eventId,
          seatIds: seats.map((s) => s.id),
          paymentMethod,
          customerPhone: phoneNumber,
        },
        { headers: authHeaders }
      );

      if (!initiateRes.data.success) {
        throw new Error(initiateRes.data.message || 'Failed to initiate booking.');
      }

      const { orderId, paymentParams } = initiateRes.data.data;

      // Step 2: Confirm Payment
      let paymentDetails = {};
      if (paymentMethod === 'JAZZCASH') {
        paymentDetails = {
          otpCode,
          ppTxnRefNo: paymentParams.ppTxnRefNo,
        };
      } else if (paymentMethod === 'EASYPAISA') {
        paymentDetails = {
          otpCode,
          epOrderId: paymentParams.epOrderId,
        };
      } else if (paymentMethod === 'STRIPE') {
        paymentDetails = {
          clientSecret: paymentParams.clientSecret,
          paymentTxId: `ch_${Date.now()}`,
          cardLast4: cardNumber.slice(-4),
        };
      } else {
        paymentDetails = {
          paymentTxId: paymentParams.mockTxId,
        };
      }

      const confirmRes = await axios.post(
        `${API_BASE_URL}/api/bookings/confirm`,
        {
          orderId,
          paymentDetails,
        },
        { headers: authHeaders }
      );

      if (confirmRes.data.success) {
        // Navigate to confirmation page
        navigate(`/bookings/${orderId}/confirmation`, {
          state: {
            order: confirmRes.data.data.order,
            receipt: confirmRes.data.data.paymentReceipt,
          },
        });
      }
    } catch (err) {
      console.error('Payment checkout error:', err);
      setError(
        err.response?.data?.message || err.message || 'Payment processing failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <Link
            to={`/events/${eventId}/seats`}
            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition mb-2 font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Seat Map
          </Link>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            Secure Ticket Checkout <Lock className="w-5 h-5 text-emerald-400" />
          </h1>
          <p className="text-xs text-slate-400">
            Complete payment to issue Polygon Amoy ERC721 NFT tickets
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-300">256-Bit SSL Encrypted</span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Left Column (7 cols): Payment Method & Form */}
        <div className="md:col-span-7 space-y-6">
          {/* Payment Gateway Tabs */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" /> Select Payment Method
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {/* 1-Click Fast Test Checkout */}
              <button
                type="button"
                onClick={() => setPaymentMethod('MOCK')}
                className={`p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                  paymentMethod === 'MOCK'
                    ? 'bg-emerald-950/60 border-emerald-500 shadow-md shadow-emerald-950/50'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <Zap className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">1-Click Instant Test</div>
                  <div className="text-[10px] text-emerald-400">Recommended for demo</div>
                </div>
              </button>

              {/* JazzCash */}
              <button
                type="button"
                onClick={() => setPaymentMethod('JAZZCASH')}
                className={`p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                  paymentMethod === 'JAZZCASH'
                    ? 'bg-red-950/40 border-red-500 shadow-md shadow-red-950/50'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <Smartphone className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">JazzCash</div>
                  <div className="text-[10px] text-slate-400">Mobile Wallet / MPIN</div>
                </div>
              </button>

              {/* EasyPaisa */}
              <button
                type="button"
                onClick={() => setPaymentMethod('EASYPAISA')}
                className={`p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                  paymentMethod === 'EASYPAISA'
                    ? 'bg-emerald-950/40 border-emerald-500 shadow-md shadow-emerald-950/50'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <Smartphone className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">EasyPaisa</div>
                  <div className="text-[10px] text-slate-400">Mobile Wallet / OTP</div>
                </div>
              </button>

              {/* Stripe Credit/Debit */}
              <button
                type="button"
                onClick={() => setPaymentMethod('STRIPE')}
                className={`p-3.5 rounded-xl border text-left transition flex items-start gap-3 ${
                  paymentMethod === 'STRIPE'
                    ? 'bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-950/50'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <CreditCard className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white">Card (Stripe)</div>
                  <div className="text-[10px] text-slate-400">Visa / Mastercard</div>
                </div>
              </button>
            </div>

            {/* Dynamic Gateway Form Fields */}
            <form onSubmit={handleProcessPayment} className="space-y-4 pt-2">
              {paymentMethod === 'STRIPE' && (
                <div className="space-y-3 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                  <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4" /> Stripe Test Card Details
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Cardholder Name</label>
                    <input
                      type="text"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-medium focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Card Number</label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Expiry</label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">CVC / CVV</label>
                      <input
                        type="text"
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(paymentMethod === 'JAZZCASH' || paymentMethod === 'EASYPAISA') && (
                <div className="space-y-3 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                  <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4" />
                    {paymentMethod === 'JAZZCASH' ? 'JazzCash' : 'EasyPaisa'} Mobile Account
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Account Mobile Number (03XX-XXXXXXX)
                    </label>
                    <input
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="03001234567"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono focus:border-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] text-slate-400">
                        {paymentMethod === 'JAZZCASH' ? 'MPIN / SMS OTP' : 'Authorization Code / OTP'}
                      </label>
                      <span className="text-[10px] text-emerald-400 font-mono">Demo OTP: 123456</span>
                    </div>
                    <input
                      type="password"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-center tracking-widest text-base focus:border-emerald-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {paymentMethod === 'MOCK' && (
                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-xs space-y-1">
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-emerald-400" /> Instant Sandbox Mode
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Fast 1-click checkout configured for testing and immediate NFT generation.
                  </p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm uppercase tracking-wider transition shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                    <span>Processing Payment...</span>
                  </>
                ) : (
                  <>
                    <span>Pay Rs. {Number(totalPrice).toLocaleString()}</span>
                    <ChevronRight className="w-4 h-4 font-bold" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column (5 cols): Order Summary */}
        <div className="md:col-span-5 space-y-6">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Ticket className="w-4 h-4 text-emerald-400" /> Order Summary
            </h2>

            {/* Event Info Card */}
            {event && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="font-bold text-white text-sm">{event.name}</div>
                <div className="text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" /> {event.venue}, {event.city}
                </div>
                <div className="text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />{' '}
                  {new Date(event.date).toLocaleDateString()}
                </div>
              </div>
            )}

            {/* Seat List */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {seats.map((seat) => (
                <div
                  key={seat.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-white">
                      {seat.section} • Row {seat.row}, Seat {seat.seatNumber}
                    </div>
                    <div className="text-[10px] text-emerald-400">
                      {seat.tier?.name || seat.tierName || 'Standard'}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-white">
                    Rs. {Number(seat.tier?.price || seat.price || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* Cost Breakdown */}
            <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Seats Subtotal ({seats.length})</span>
                <span className="font-mono text-white">Rs. {Number(totalPrice).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Polygon Gas & NFT Minting</span>
                <span className="font-mono text-emerald-400">Free (Organizer Sponsored)</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Platform Convenience Fee</span>
                <span className="font-mono text-emerald-400">Rs. 0</span>
              </div>
              <div className="flex items-center justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                <span>Total Amount Due</span>
                <span className="font-mono text-emerald-400 text-lg">
                  Rs. {Number(totalPrice).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Guarantee Note */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              NFT Ticket Delivery
            </div>
            <p className="text-[10px] leading-relaxed">
              Once payment is authorized, your digital pass will be cryptographically minted on the Polygon Amoy blockchain with a rotating QR code to prevent gate fraud.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
