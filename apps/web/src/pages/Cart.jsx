import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Clock,
  ArrowRight,
  Trash2,
  MapPin,
  Calendar,
  AlertCircle,
  ShieldCheck,
  ChevronLeft,
  Sparkles,
  Ticket
} from 'lucide-react';
import { useCartHolds } from '../hooks/useCartHolds';

const formatClock = (s) => {
  if (s == null || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

export default function Cart() {
  const navigate = useNavigate();
  const { holds, first, totalCount, secondsLeft, releasing, releaseAll, deleteItem } = useCartHolds();

  const hasItems = totalCount > 0 && first && secondsLeft > 0;
  const isUrgent = secondsLeft != null && secondsLeft < 120;

  const handleCheckout = (eventId) => {
    navigate(`/events/${eventId}/checkout`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20 pt-6 sm:pt-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Breadcrumb / Back Link */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/events"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Continue Browsing Events</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200/70 text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>10-Minute Guaranteed Seat Hold</span>
            </span>
          </div>
        </div>

        {/* Page Title & Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              <span className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <ShoppingBag className="w-6 h-6" />
              </span>
              <span>Your Ticket Cart</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {hasItems
                ? `You have ${totalCount} reserved ticket${totalCount === 1 ? '' : 's'} waiting for booking completion.`
                : 'Review your held tickets and proceed to complete your booking.'}
            </p>
          </div>

          {/* Active Hold Countdown Badge */}
          {hasItems && (
            <div
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border shadow-sm ${
                isUrgent
                  ? 'bg-rose-50 border-rose-200 text-rose-800 animate-pulse'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              <Clock className={`w-5 h-5 ${isUrgent ? 'text-rose-600' : 'text-emerald-600'}`} />
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">
                  {isUrgent ? 'Expiring Soon' : 'Hold Time Left'}
                </div>
                <div className="text-lg font-black tracking-mono font-mono leading-none">
                  {formatClock(secondsLeft)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Empty State */}
        {!hasItems ? (
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-8 sm:p-14 text-center max-w-xl mx-auto my-8">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-5">
              <ShoppingBag className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Your ticket cart is empty</h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              When you choose seats or reserve tickets for any match, concert, or festival, they will stay reserved here in your cart for 10 minutes so you can complete your booking.
            </p>
            <Link
              to="/events"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#16a34a] hover:bg-[#15803d] text-white font-bold text-sm rounded-xl shadow-md transition transform active:scale-98"
            >
              <span>Explore Live Events</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          /* Active Cart with Items */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left 8 Cols: Event Cards & Itemized Seats */}
            <div className="lg:col-span-8 space-y-6">
              {holds.map((hold) => (
                <div
                  key={hold.eventId}
                  className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  {/* Event Header Banner */}
                  <div className="p-5 sm:p-6 border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {hold.bannerUrl ? (
                        <img
                          src={hold.bannerUrl}
                          alt={hold.eventName}
                          className="w-16 h-16 rounded-xl object-cover border border-white/20 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-white/10 flex items-center justify-center text-emerald-400 shrink-0">
                          <Ticket className="w-8 h-8" />
                        </div>
                      )}
                      <div>
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 mb-1">
                          Active Hold
                        </span>
                        <h2 className="text-lg sm:text-xl font-extrabold text-white leading-tight">
                          {hold.eventName}
                        </h2>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-1">
                          {hold.venue && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              <span>{hold.venue}{hold.city ? `, ${hold.city}` : ''}</span>
                            </span>
                          )}
                          {hold.date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              <span>{new Date(hold.date).toLocaleDateString()} {hold.time || ''}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick Link to Change Seats */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Link
                        to={`/events/${hold.eventId}/seats`}
                        className="text-xs text-slate-300 hover:text-white underline font-semibold transition"
                      >
                        Change seats
                      </Link>
                    </div>
                  </div>

                  {/* Itemized Seats Table / List */}
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Held Seats ({hold.count})
                      </h3>
                      <button
                        type="button"
                        disabled={releasing}
                        onClick={() => releaseAll(hold.eventId, hold.keys)}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear all for this event</span>
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {hold.seats && hold.seats.length > 0 ? (
                        hold.seats.map((seat, idx) => (
                          <div
                            key={seat.id || seat.key || idx}
                            className="py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/60 px-3 rounded-xl transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                                #{seat.seatNumber || idx + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-900 truncate">
                                  {seat.tierName || 'Standard'} · {seat.section || 'General'} {seat.row ? `Row ${seat.row}` : ''}
                                </div>
                                <div className="text-xs text-slate-500 flex items-center gap-2 font-mono">
                                  <span>Seat: {seat.seatNumber || 'N/A'}</span>
                                  {seat.key && <span className="text-[10px] text-slate-400">ID: {seat.key}</span>}
                                </div>
                              </div>
                            </div>

                            {/* Price and Delete Button (Alibaba style) */}
                            <div className="flex items-center gap-4 shrink-0">
                              <div className="text-right">
                                <div className="text-sm font-black text-slate-900">
                                  Rs. {Number(seat.price || 0).toLocaleString()}
                                </div>
                                <div className="text-[10px] text-emerald-600 font-semibold">
                                  Official Price
                                </div>
                              </div>

                              {/* Alibaba-style Delete / Trash Button */}
                              <button
                                type="button"
                                disabled={releasing}
                                onClick={() => deleteItem(hold.eventId, seat)}
                                className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition duration-150 flex items-center gap-1 text-xs font-semibold group disabled:opacity-50"
                                title="Remove this seat from cart"
                                aria-label={`Delete seat ${seat.seatNumber}`}
                              >
                                <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-rose-600 transition" />
                                <span className="hidden sm:inline text-slate-500 group-hover:text-rose-600">Delete</span>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-4 text-center text-xs text-slate-500">
                          {hold.count} seats held
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right 4 Cols: Order Summary & Complete Booking */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sticky top-24">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4">
                  Order Summary
                </h3>

                <div className="space-y-3 text-xs mb-6">
                  <div className="flex justify-between text-slate-600">
                    <span>Total Reserved Seats:</span>
                    <span className="font-bold text-slate-900">{totalCount}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-bold text-slate-900">
                      Rs. {holds.reduce((acc, h) => acc + (h.totalPrice || 0), 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Platform Booking Fee:</span>
                    <span className="font-bold text-emerald-600">Rs. 0 (Free)</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Blockchain Smart Contract:</span>
                    <span className="font-bold text-emerald-600">Included (Free)</span>
                  </div>

                  <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline">
                    <span className="text-sm font-bold text-slate-900">Estimated Total:</span>
                    <span className="text-xl font-black text-emerald-600">
                      Rs. {holds.reduce((acc, h) => acc + (h.totalPrice || 0), 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Primary CTA: Complete Booking */}
                {first && (
                  <button
                    type="button"
                    onClick={() => handleCheckout(first.eventId)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-[#16a34a] hover:bg-[#15803d] text-white font-extrabold text-sm rounded-2xl shadow-lg shadow-emerald-600/25 transition duration-150 transform active:scale-98"
                  >
                    <span>Complete Booking</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                <div className="mt-4 text-[11px] text-slate-400 text-center leading-normal">
                  Secured by 256-bit encryption. Your seats are held exclusively for your session until the timer expires.
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
