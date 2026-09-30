import React, { useState, useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import {
  CheckCircle2,
  Ticket,
  Calendar,
  MapPin,
  ShieldCheck,
  ArrowRight,
  Download,
  Share2,
  RefreshCw,
  QrCode,
  Sparkles
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000';

export default function BookingSuccess() {
  const { id: orderId } = useParams();
  const location = useLocation();
  const { token } = useAuth();

  const [order, setOrder] = useState(location.state?.order || null);
  const [receipt, setReceipt] = useState(location.state?.receipt || null);
  const [loading, setLoading] = useState(!order);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!order && orderId) {
      const fetchOrder = async () => {
        try {
          setLoading(true);
          const res = await axios.get(`${API_BASE_URL}/api/bookings/${orderId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.data.success) {
            setOrder(res.data.data.order);
          }
        } catch (err) {
          console.error('Error fetching order receipt:', err);
          setError('Failed to load order receipt details.');
        } finally {
          setLoading(false);
        }
      };

      fetchOrder();
    }
  }, [orderId, order, token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading confirmed booking receipt...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="text-rose-400 font-bold">{error || 'Booking not found'}</div>
        <Link
          to="/events"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition"
        >
          Return to Events
        </Link>
      </div>
    );
  }

  const { event, tickets = [] } = order;

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-4 pb-16 text-slate-800">
      {/* Celebration Header */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-[#16a34a] flex items-center justify-center mx-auto shadow-sm">
          <CheckCircle2 className="w-10 h-10 font-black" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">Booking Confirmed!</h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
          Your payment was successful and your seats have been permanently secured. Your tickets are ready for gate validation.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-mono text-slate-700">
          Order Reference: #{order.id.substring(0, 8).toUpperCase()}
        </div>
      </div>

      {/* Main Ticket Receipt Card */}
      <div className="p-6 md:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-6">
        {/* Event Header */}
        <div className="pb-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              {event?.type?.replace('_', ' ') || 'Event Pass'}
            </span>
            <h2 className="text-xl font-bold text-slate-900 mt-2">{event?.name}</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-1">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" /> {event?.venue}, {event?.city}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />{' '}
                {new Date(event?.date).toLocaleDateString()} • {event?.time}
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] text-slate-500">Total Paid</div>
            <div className="text-2xl font-black text-slate-900 font-mono">
              Rs. {Number(order.totalAmount).toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-700 font-semibold uppercase">
              {order.paymentMethod} Payment Verified
            </div>
          </div>
        </div>

        {/* Issued Seat Passes */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
            <Ticket className="w-4 h-4 text-[#16a34a]" /> Issued Seats ({tickets.length})
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tickets.map((t, idx) => (
              <div
                key={t.id}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between"
              >
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Ticket #{idx + 1} • {t.seat?.tier?.name || 'Tier Pass'}
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-0.5">
                    Section {t.seat?.section}
                  </div>
                  <div className="text-xs font-mono text-emerald-700 font-semibold">
                    Row {t.seat?.row} — Seat {t.seat?.seatNumber}
                  </div>
                </div>

                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-[#16a34a] shadow-sm">
                  <QrCode className="w-5 h-5 text-[#16a34a]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transaction Metadata */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] text-slate-500">Transaction ID</div>
            <div className="font-mono text-slate-800 font-semibold truncate">
              {order.paymentTxId || 'TX_APPROVED'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Payment Gateway</div>
            <div className="font-semibold text-slate-800">{order.paymentMethod}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Booking Status</div>
            <div className="font-bold text-emerald-700">{order.status}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Date & Time</div>
            <div className="text-slate-800">
              {new Date(order.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Blockchain Notice */}
        <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-xs flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-purple-950 flex items-center gap-1.5">
              <span>Polygon Amoy ERC721 NFT Tickets Minted</span>
              <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-300 px-2 py-0.5 rounded font-mono">
                ChainId 80002
              </span>
            </div>
            <p className="text-[11px] text-purple-900 leading-relaxed">
              Your tickets are cryptographically minted on the Polygon Amoy testnet. Each pass contains an on-chain anti-scalping resale price ceiling (max 110%) and immutable seat coordinates.
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <Link
          to="/wallet"
          className="w-full sm:w-auto btn-eventfrog text-xs px-5 py-3 shadow-sm flex items-center justify-center gap-2"
        >
          <QrCode className="w-4 h-4" />
          <span>Open Digital Pass & QR Wallet</span>
        </Link>

        <Link
          to="/my-bookings"
          className="w-full sm:w-auto px-5 py-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-2 shadow-sm"
        >
          <span>View in My Bookings</span>
          <ArrowRight className="w-4 h-4 text-emerald-600" />
        </Link>

        <Link
          to="/events"
          className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-2"
        >
          <span>Browse More Events</span>
        </Link>
      </div>
    </div>
  );
}
