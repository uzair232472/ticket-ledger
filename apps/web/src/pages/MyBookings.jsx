import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import AccountShell, { AccountSection } from '../components/account/AccountShell';
import { STAGE_IMAGE } from '../components/home/homeData';
import '../components/lifecycle/lifecycle.css';
import '../components/account/bookingTools.css';
import api from '../utils/api';
import BookingTools from '../components/account/BookingTools';
import Pager, { pageOf } from '../components/dash/Pager';
import AccountSearch, { haystack, matchesQuery } from '../components/account/AccountSearch';
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

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ORDER_STATUS = { SUCCESSFUL: 'Paid', PENDING: 'Pending', FAILED: 'Failed', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partly refunded' };

export default function MyBookings() {
  const { token, user } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const again = () => setReloadKey((k) => k + 1);
    window.addEventListener('tl:bookings-changed', again);
    return () => window.removeEventListener('tl:bookings-changed', again);
  }, []);
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Events of mine that were cancelled, postponed or moved (with refunds open), and refunds paid to me
  const [notices, setNotices] = useState([]);
  const [refunds, setRefunds] = useState([]);
  // Gifts I sent (status per ticket) and gifts waiting for my email
  const [gifts, setGifts] = useState({ sent: [], waitingForMe: [] });
  const [giftMsg, setGiftMsg] = useState('');
  const loadGifts = () => api.get('/bookings/gifts').then((r) => setGifts(r.data.data)).catch(() => {});
  useEffect(() => { loadGifts(); }, []);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        setLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const [res, noticeRes, refundRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/bookings/my-bookings`, { headers }),
          axios.get(`${API_BASE_URL}/api/bookings/event-notices`, { headers }).catch(() => null),
          axios.get(`${API_BASE_URL}/api/bookings/refunds`, { headers }).catch(() => null),
        ]);
        setNotices(noticeRes?.data?.data?.events || []);
        setRefunds(refundRes?.data?.data?.refunds || []);

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
  }, [token, reloadKey]);

  const ticketCount = orders.reduce((n, o) => n + (o.tickets?.length || 0), 0);

  const orderText = (o) => haystack(o.event?.name, o.event?.venue, o.event?.city, o.event?.type, o.id, o.id?.slice(0, 8), o.paymentMethod, o.status, ...(o.tickets || []).map((t) => [t.seat?.section, t.seat?.row && `row ${t.seat.row}`, t.seat?.seatNumber && `seat ${t.seat.seatNumber}`, t.seat?.tier?.name].filter(Boolean).join(' ')));
  const shownOrders = query.trim() ? orders.filter((o) => matchesQuery(orderText(o), query)) : orders;
  const paged = pageOf(shownOrders, page, 5);

  return (
    <AccountShell
      eyebrow="My account · Orders"
      title={['Your', 'orders']}
      intro="Every confirmed purchase and the seats issued with it. Open a receipt to see its QR passes."
      image={STAGE_IMAGE}
      stats={loading ? [] : [
        { value: orders.length, label: orders.length === 1 ? 'Order' : 'Orders' },
        { value: ticketCount, label: ticketCount === 1 ? 'Seat booked' : 'Seats booked' },
      ]}
      actions={
        <Link to="/events" className="tl-btn tl-btn--green">
          <Ticket className="w-4 h-4" aria-hidden="true" /> Browse more events
        </Link>
      }
      contentKey={`${loading}-${query}-${paged.page}-${orders.length}-${Boolean(error)}`}
    >
      <AccountSection id="tl-orders" kicker="Booking history" title="Purchases" aside="Orders are listed newest first, with their payment status and the seats in each booking.">
      {loading ? (
        <div className="tl-acct-loading">
          <RefreshCw className="w-10 h-10 text-[#22c55e] animate-spin" />
          <p>Loading your ticket ledger bookings...</p>
        </div>
      ) : (
      <div className="w-full space-y-8 text-slate-800 pb-32">
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {notices.length > 0 && (
        <section className="tl-lcu-notices" aria-label="Event updates">
          {notices.map((ev) => (
            <div key={ev.id} className={`tl-lcu-notice ${ev.status === 'CANCELLED' ? 'is-bad' : 'is-wait'}`}>
              <div>
                <strong>
                  {ev.status === 'CANCELLED' ? `Cancelled: ${ev.name}` : ev.postponedAt ? `Postponed: ${ev.name}` : `New date: ${ev.name}`}
                </strong>
                {ev.status === 'CANCELLED'
                  ? `${ev.cancelReason ? `${ev.cancelReason} ` : ''}Your tickets are refunded automatically.`
                  : ev.postponedAt
                    ? 'Your tickets stay valid for the new date. You can get a refund until it’s announced.'
                    : `Now ${new Date(ev.date).toLocaleDateString()} at ${ev.venue}. Can’t make it? Get a refund until ${new Date(ev.refundWindowEndsAt).toLocaleString()}.`}
              </div>
              <Link to={`/events/${ev.id}/refund`}>{ev.status === 'CANCELLED' ? 'See refund' : 'Keep or refund'}</Link>
            </div>
          ))}
        </section>
      )}

      {refunds.length > 0 && (
        <section aria-label="Refunds">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Refunds ({refunds.length})</div>
          <div className="tl-lcu-refund-list">
            {refunds.map((r) => (
              <div key={r.id} className="tl-lcu-refund-row">
                <span>
                  {r.event?.name}
                  {r.ticket?.seat ? ` · Row ${r.ticket.seat.row}, Seat ${r.ticket.seat.seatNumber}` : ''}
                  {r.providerRef ? ` · Ref ${r.providerRef}` : ''}
                </span>
                <span className={r.status === 'SUCCEEDED' ? 'is-done' : 'is-wait'}>
                  Rs. {Number(r.amount).toLocaleString()} · {r.status === 'SUCCEEDED' ? 'Refunded' : r.status === 'FAILED' ? 'Delayed, retrying' : 'Processing'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {gifts.waitingForMe.length > 0 && (
        <section className="tl-bt-panel mb-4" aria-label="Tickets sent to you">
          <p className="font-bold">🎁 Tickets waiting for you</p>
          {gifts.waitingForMe.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{g.kind === 'GROUP' ? 'A group ticket' : 'A gift'}{g.message ? ` · "${g.message}"` : ''}</span>
              <button type="button" className="tl-bt-btn is-primary" onClick={async () => { try { const r = await api.post(`/bookings/gifts/${g.id}/claim`); setGiftMsg(r.data.message); loadGifts(); } catch (e) { setGiftMsg(e.response?.data?.message || 'Could not claim it.'); } }}>Claim ticket</button>
            </div>
          ))}
          {giftMsg && <p className="tl-bt-msg" role="status">{giftMsg}</p>}
        </section>
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
        <div className="space-y-4 tl-orders">
          <AccountSearch id="orders-search" value={query} onChange={setQuery} placeholder="Search by event, venue, city, order ref or seat" shown={shownOrders.length} total={orders.length} noun="orders" />
          {shownOrders.length === 0 && <p className="tl-asearch-empty">No order matches “{query.trim()}”.<button type="button" onClick={() => setQuery('')}>Clear search</button></p>}
          {paged.rows.map((order) => {
            const { event, tickets = [] } = order;
            const isConfirmed = order.status === 'SUCCESSFUL';

            return (
              <div
                key={order.id}
                data-reveal
                className="tl-order-card p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 hover:shadow-md transition space-y-3 shadow-sm"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                        {event?.type?.replace('_', ' ') || 'Event'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Ref #{order.id.substring(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900">{event?.name}</h3>
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
                    <div className="text-lg font-black text-slate-900 font-mono">
                      Rs. {Number(order.totalAmount).toLocaleString()}
                    </div>
                    <span
                      className={`inline-block mt-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase ${isConfirmed
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                    >
                      {ORDER_STATUS[order.status] || order.status} • {order.paymentMethod}
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
                        className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
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

                <BookingTools order={order} userId={user?.id} gifts={gifts.sent} onChanged={() => { loadGifts(); window.dispatchEvent(new Event('tl:bookings-changed')); }} />

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
          <Pager page={paged.page} total={shownOrders.length} onPage={(p) => { setPage(p); document.getElementById('orders-search')?.scrollIntoView({ block: 'center' }); }} label="Orders" size={5} />
        </div>
      )}
      </div>
      )}
      </AccountSection>
    </AccountShell>
  );
}
