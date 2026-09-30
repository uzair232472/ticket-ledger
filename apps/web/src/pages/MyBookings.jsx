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
        <RefreshCw className="w-10 h-10 text-[#22c55e] animate-spin mb-4" />
        <p className="text-slate-500 text-sm">Loading your ticket ledger bookings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 py-4 pb-16 text-slate-800">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-[#16a34a]" /> My Ticket Bookings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            View all confirmed purchases and issued digital passes
          </p>
        </div>

        <Link
          to="/events"
          className="btn-eventfrog text-xs whitespace-nowrap px-4 py-2.5 shadow-sm"
        >
          <Ticket className="w-3.5 h-3.5" />
          <span>Browse More Events</span>
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="text-center py-16 space-y-4 max-w-md mx-auto bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
            <Ticket className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">No Bookings Found</h2>
          <p className="text-xs text-slate-500">
            You haven't reserved any match or concert tickets yet. Explore upcoming Pakistani events to book your seats.
          </p>
          <Link
            to="/events"
            className="btn-eventfrog text-xs px-5 py-2.5 shadow-sm"
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
                className="p-6 rounded-3xl bg-white border border-slate-200/90 hover:shadow-md transition space-y-4 shadow-sm"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                        {event?.type?.replace('_', ' ') || 'Event'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Ref #{order.id.substring(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">{event?.name}</h3>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600" /> {event?.venue}, {event?.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />{' '}
                        {new Date(event?.date).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <div className="text-[11px] text-slate-500">Paid Amount</div>
                    <div className="text-xl font-black text-slate-900 font-mono">
                      Rs. {Number(order.totalAmount).toLocaleString()}
                    </div>
                    <span
                      className={`inline-block mt-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        isConfirmed
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {order.status} • {order.paymentMethod}
                    </span>
                  </div>
                </div>

                {/* Tickets in this booking */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Reserved Seats ({tickets.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {tickets.map((t, idx) => (
                      <div
                        key={t.id}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            Section {t.seat?.section} • Row {t.seat?.row}, Seat {t.seat?.seatNumber}
                          </div>
                          <div className="text-[10px] text-emerald-700 font-medium">
                            {t.seat?.tier?.name || 'Pass'}
                          </div>
                        </div>
                        <QrCode className="w-4 h-4 text-slate-400" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer link to receipt */}
                <div className="pt-2 flex justify-end">
                  <Link
                    to={`/bookings/${order.id}/confirmation`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#16a34a] hover:text-[#15803d] transition"
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
