import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Clock,
  ArrowRight,
  ArrowLeft,
  Trash2,
  MapPin,
  Calendar,
  ShieldCheck,
  Ticket
} from 'lucide-react';
import BookingShell from '../components/booking/BookingShell';
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
  const grandTotal = holds.reduce((acc, h) => acc + (h.totalPrice || 0), 0);

  const handleCheckout = (eventId) => {
    navigate(`/events/${eventId}/checkout`);
  };

  return (
    <BookingShell>
      {/* Back to Events Navigation */}
      <Link to="/events" className="tl-bk-back">
        <ArrowLeft style={{ width: 14, height: 14 }} />
        <span>Discover Events</span>
      </Link>

      {/* Page Header */}
      <div className="tl-bk-head">
        <div>
          <p className="tl-bk-kicker">Held Ticket Cart</p>
          <h1 className="tl-bk-title">Your Cart</h1>
          <div className="tl-bk-meta">
            <span>
              <ShieldCheck style={{ width: 16, height: 16, color: 'var(--bk-accent)' }} />
              10-Minute Guaranteed Seat Hold
            </span>
            {hasItems && (
              <span>
                <Ticket style={{ width: 16, height: 16 }} />
                {totalCount} seat{totalCount === 1 ? '' : 's'} held
              </span>
            )}
          </div>
        </div>

        {/* Steps and Live Expiration Timer */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
          <ol className="tl-bk-steps" aria-label="Booking progress">
            <li aria-current="step">Cart</li>
            <li>Checkout</li>
            <li>Confirmation</li>
          </ol>

          {hasItems && (
            <div
              className={`tl-vb-timer${isUrgent ? ' is-urgent' : ''}`}
              style={{ fontSize: 13, padding: '8px 14px' }}
              role="timer"
              aria-label="Hold countdown"
            >
              <Clock style={{ width: 14, height: 14 }} />
              <span>{formatClock(secondsLeft)} left to book</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Cart Content */}
      {!hasItems ? (
        <section className="tl-bk-panel tl-bk-rise" style={{ marginTop: 20 }}>
          <div className="tl-bk-empty">
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(11, 11, 11, 0.05)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--bk-dim)',
              }}
            >
              <ShoppingBag style={{ width: 30, height: 30 }} />
            </div>
            <h2 className="tl-bk-h2" style={{ marginBottom: 0 }}>Your ticket cart is empty</h2>
            <p className="tl-bk-muted" style={{ maxWidth: 440 }}>
              When you select and reserve seats on any upcoming match, concert, or festival, they are locked exclusively for you here for 10 minutes so you can complete your booking.
            </p>
            <Link to="/events" className="tl-bk-btn" style={{ marginTop: 12 }}>
              Explore Events
            </Link>
          </div>
        </section>
      ) : (
        <div className="tl-cart-grid tl-bk-rise" style={{ marginTop: 24 }}>
          {/* Left Column: Reserved Events & Seats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {holds.map((hold) => (
              <section key={hold.eventId} className="tl-bk-panel">
                {/* Event Information Header */}
                <div className="tl-cart-event-head">
                  <div>
                    <h2 className="tl-cart-event-title">{hold.eventName}</h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 4, fontSize: 13, color: 'var(--bk-dim)' }}>
                      {hold.venue && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin style={{ width: 13, height: 13 }} />
                          {hold.venue}{hold.city ? `, ${hold.city}` : ''}
                        </span>
                      )}
                      {hold.date && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Calendar style={{ width: 13, height: 13 }} />
                          {new Date(hold.date).toLocaleDateString()} {hold.time || ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <Link to={`/events/${hold.eventId}/seats`} className="tl-bk-link">
                    Change seats
                  </Link>
                </div>

                {/* Itemized Held Seats with Alibaba-style Delete */}
                <div>
                  <p className="tl-bk-label" style={{ marginBottom: 8 }}>
                    Reserved Seats ({hold.count})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {hold.seats && hold.seats.length > 0 ? (
                      hold.seats.map((seat, idx) => (
                        <div key={seat.id || seat.key || idx} className="tl-cart-item">
                          <div className="tl-cart-item-info">
                            <span className="tl-cart-item-badge">
                              #{seat.seatNumber || idx + 1}
                            </span>
                            <div>
                              <div className="tl-cart-item-title">
                                {seat.tierName || 'Standard'} · {seat.section || 'General'}{seat.row ? `, Row ${seat.row}` : ''}
                              </div>
                              <div className="tl-cart-item-sub">
                                Seat: {seat.seatNumber || 'N/A'}{seat.key ? ` · ID: ${seat.key}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="tl-cart-item-actions">
                            <div className="tl-cart-price">
                              Rs. {Number(seat.price || 0).toLocaleString()}
                            </div>

                            {/* Alibaba-style individual Delete Button */}
                            <button
                              type="button"
                              disabled={releasing}
                              onClick={() => deleteItem(hold.eventId, seat)}
                              className="tl-cart-delete-btn"
                              title="Delete this seat from cart"
                              aria-label={`Delete seat ${seat.seatNumber}`}
                            >
                              <Trash2 style={{ width: 13, height: 13 }} />
                              <span>Delete</span>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="tl-cart-item">
                        <span>{hold.count} seats held</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Event Footer with Clear All */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--bk-line)' }}>
                  <button
                    type="button"
                    disabled={releasing}
                    onClick={() => releaseAll(hold.eventId, hold.keys)}
                    className="tl-bk-link"
                    style={{ color: 'var(--bk-error)' }}
                  >
                    Clear all for this event
                  </button>
                </div>
              </section>
            ))}
          </div>

          {/* Right Column: Order Summary & Complete Booking */}
          <aside className="tl-cart-summary">
            <section className="tl-bk-panel">
              <h2 className="tl-bk-h2">
                <span>Summary</span>
                <small>Guaranteed</small>
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '16px 0' }}>
                <div className="tl-cart-line">
                  <span>Reserved Seats</span>
                  <span style={{ font: '600 13px/1 var(--bk-mono)', color: 'var(--bk-ink)' }}>{totalCount}</span>
                </div>
                <div className="tl-cart-line">
                  <span>Subtotal</span>
                  <span style={{ font: '600 13px/1 var(--bk-mono)', color: 'var(--bk-ink)' }}>
                    Rs. {grandTotal.toLocaleString()}
                  </span>
                </div>
                <div className="tl-cart-line">
                  <span>Booking & Service Fee</span>
                  <span style={{ font: '600 13px/1 var(--bk-mono)', color: 'var(--bk-ok)' }}>Rs. 0 (Free)</span>
                </div>
                <div className="tl-cart-line">
                  <span>Polygon NFT Minting</span>
                  <span style={{ font: '600 13px/1 var(--bk-mono)', color: 'var(--bk-ok)' }}>Included</span>
                </div>

                <div className="tl-cart-line is-total">
                  <span>Total Amount</span>
                  <strong>Rs. {grandTotal.toLocaleString()}</strong>
                </div>
              </div>

              {/* Complete Booking CTA Button */}
              {first && (
                <button
                  type="button"
                  onClick={() => handleCheckout(first.eventId)}
                  className="tl-bk-btn tl-bk-btn--lg tl-bk-btn--block"
                  style={{
                    background: 'var(--bk-accent)',
                    borderColor: 'var(--bk-accent)',
                    color: '#fff',
                    marginTop: 18,
                  }}
                >
                  <span>Complete Booking</span>
                  <ArrowRight style={{ width: 16, height: 16 }} />
                </button>
              )}

              <p className="tl-bk-muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 14 }}>
                Guaranteed by Polygon Amoy smart contracts. Your hold expires automatically when the timer reaches 00:00.
              </p>
            </section>
          </aside>
        </div>
      )}
    </BookingShell>
  );
}
