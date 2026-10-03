import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Clock, ArrowRight, Trash2, MapPin, CheckCircle, AlertTriangle, X } from 'lucide-react';
import { useCartHolds } from '../../hooks/useCartHolds';

const formatClock = (s) => {
  if (s == null || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

export default function NavbarCart({ tone = 'light' }) {
  const navigate = useNavigate();
  const { holds, first, totalCount, secondsLeft, releasing, releaseAll } = useCartHolds();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close when clicked outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Don't render anything if no tickets held and tone is dark (home header only shows active cart)
  const hasItems = totalCount > 0 && first && secondsLeft > 0;
  const isUrgent = secondsLeft != null && secondsLeft < 90;

  const handleCheckout = (eventId) => {
    setOpen(false);
    navigate(`/events/${eventId}/checkout`);
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative inline-flex items-center justify-center p-2 rounded-xl transition duration-150 ${
          hasItems
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm hover:bg-emerald-100 ring-2 ring-emerald-400/30'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
        }`}
        aria-label={hasItems ? `Cart: ${totalCount} tickets reserved` : 'Shopping cart'}
        title={hasItems ? `${totalCount} seats held: Complete booking` : 'Shopping Cart'}
      >
        <ShoppingBag className="w-4 h-4" />
        {hasItems && (
          <>
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-[#16a34a] text-white text-[11px] font-black rounded-full flex items-center justify-center shadow-md animate-pulse">
              {totalCount}
            </span>
          </>
        )}
      </button>

      {/* Cart Popover */}
      {open && (
        <div
          className="absolute right-0 mt-2.5 w-80 sm:w-96 rounded-2xl bg-white border border-slate-200 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150 text-slate-800"
          style={{ transformOrigin: 'top right' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                <ShoppingBag className="w-3.5 h-3.5" />
              </div>
              <h3 className="font-bold text-sm text-slate-900">Your Ticket Cart</h3>
            </div>
            {hasItems && (
              <div
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                  isUrgent ? 'bg-rose-100 text-rose-800 animate-pulse' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>{formatClock(secondsLeft)}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="py-3">
            {!hasItems ? (
              <div className="text-center py-6 px-4 space-y-2">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <p className="font-semibold text-xs text-slate-800">Your cart is empty</p>
                <p className="text-[11px] text-slate-500">Select seats on any event to reserve them for 10 minutes.</p>
                <Link
                  to="/events"
                  onClick={() => setOpen(false)}
                  className="inline-block mt-2 px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition"
                >
                  Explore Events
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {holds.map((hold) => (
                  <div key={hold.eventId} className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 space-y-2.5">
                    <div>
                      <h4 className="font-bold text-xs text-slate-900 leading-snug line-clamp-1">{hold.eventName}</h4>
                      {hold.venue && (
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{hold.venue}{hold.city ? `, ${hold.city}` : ''}</span>
                        </p>
                      )}
                    </div>

                    {/* Seats details */}
                    <div className="bg-white rounded-lg p-2 border border-slate-200/60 space-y-1 text-[11px]">
                      <div className="flex justify-between font-semibold text-slate-700">
                        <span>Reserved Seats:</span>
                        <span className="font-bold text-slate-900">{hold.count} ticket{hold.count === 1 ? '' : 's'}</span>
                      </div>
                      {hold.seats && hold.seats.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {hold.seats.map((s, idx) => (
                            <span key={idx} className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-700 font-mono">
                              {s.section ? `${s.section} · ` : ''}{s.row ? `Row ${s.row} ` : ''}#{s.seatNumber}
                            </span>
                          ))}
                        </div>
                      )}
                      {hold.totalPrice > 0 && (
                        <div className="flex justify-between pt-1 border-t border-slate-100 font-bold text-slate-900">
                          <span>Total:</span>
                          <span className="text-[#16a34a]">Rs. {hold.totalPrice.toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Quick Action Button: Complete booking */}
                    <button
                      type="button"
                      onClick={() => handleCheckout(hold.eventId)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-[#16a34a] hover:bg-[#15803d] text-white font-bold text-xs rounded-xl shadow-md transition active:scale-[0.98]"
                    >
                      <span>Complete booking</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Secondary row: Modify or Release */}
                    <div className="flex items-center justify-between text-[11px] pt-1 px-1">
                      <Link
                        to={`/events/${hold.eventId}/seats`}
                        onClick={() => setOpen(false)}
                        className="text-slate-600 hover:text-emerald-700 font-medium underline"
                      >
                        Change seats
                      </Link>
                      <button
                        type="button"
                        disabled={releasing}
                        onClick={() => releaseAll(hold.eventId, hold.keys)}
                        className="text-rose-600 hover:text-rose-700 flex items-center gap-1 font-medium disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{releasing ? 'Releasing…' : 'Release'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
