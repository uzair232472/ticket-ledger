import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import {
  Ticket,
  Calendar,
  MapPin,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ShoppingBag,
  QrCode,
  ArrowRight
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000';

export default function MyBookings() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE_URL}/api/bookings/my-bookings`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.data.success) {
          setOrders(res.data.data.orders);
        }
      } catch (err) {
        console.error('Error fetching bookings:', err);
        setError('Failed to load your booking history.');
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading your ticket ledger bookings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-400" /> My Ticket Bookings
          </h1>
          <p className="text-xs text-slate-400">
            View all confirmed purchases and issued digital passes
          </p>
        </div>

        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-white transition"
        >
          <Ticket className="w-3.5 h-3.5 text-emerald-400" /> Browse More Events
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="text-center py-16 space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-600">
            <Ticket className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white">No Bookings Found</h2>
          <p className="text-xs text-slate-400">
            You haven't reserved any match or concert tickets yet. Explore upcoming Pakistani events to book your seats.
          </p>
          <Link
            to="/events"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
          >
            <span>Explore Events</span>
            <ArrowRight className="w-4 h-4 font-bold" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const { event, tickets = [] } = order;
            const isConfirmed = order.status === 'SUCCESSFUL';

            return (
              <div
                key={order.id}
                className="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-4"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                        {event?.type?.replace('_', ' ') || 'Event'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Ref #{order.id.substring(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <h3 className="text-lg font-black text-white">{event?.name}</h3>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" /> {event?.venue}, {event?.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />{' '}
                        {new Date(event?.date).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <div className="text-[11px] text-slate-400">Paid Amount</div>
                    <div className="text-xl font-black text-white font-mono">
                      Rs. {Number(order.totalAmount).toLocaleString()}
                    </div>
                    <span
                      className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        isConfirmed
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {order.status} • {order.paymentMethod}
                    </span>
                  </div>
                </div>

                {/* Tickets in this booking */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Reserved Seats ({tickets.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {tickets.map((t, idx) => (
                      <div
                        key={t.id}
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-white">
                            Section {t.seat?.section} • Row {t.seat?.row}, Seat {t.seat?.seatNumber}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            {t.seat?.tier?.name || 'Pass'}
                          </div>
                        </div>
                        <QrCode className="w-4 h-4 text-slate-500" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer link to receipt */}
                <div className="pt-2 flex justify-end">
                  <Link
                    to={`/bookings/${order.id}/confirmation`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    <span>View Receipt & QR Pass</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
