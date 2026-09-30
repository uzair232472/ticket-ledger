import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Building2, 
  ShieldCheck, 
  Ticket, 
  ArrowLeft, 
  CheckCircle2, 
  Sparkles, 
  Info, 
  ChevronRight, 
  Bell, 
  Users, 
  Check 
} from 'lucide-react';
import api, { trackClientBehavior } from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';

export default function EventDetails() {
  const { id } = useParams();
  const { token } = useAuth();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Waitlist state
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState('');

  useEffect(() => {
    async function loadEvent() {
      try {
        setLoading(true);
        const res = await api.get(`/events/${id}`);
        if (res.data.success) {
          const loadedEvent = res.data.data.event;
          setEvent(loadedEvent);

          trackClientBehavior('event_view', id, {
            eventName: loadedEvent.name,
            category: loadedEvent.type,
            city: loadedEvent.city,
          });
        } else {
          setError(res.data.message || 'Event not found');
        }
      } catch (err) {
        setError(err.response?.data?.message || err.message);
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      loadEvent();
    }
  }, [id]);

  useEffect(() => {
    async function checkWaitlistStatus() {
      if (!token || !id) return;
      try {
        const res = await api.get(`/events/${id}/waitlist`);
        if (res.data?.success) {
          setOnWaitlist(res.data.data?.onWaitlist || false);
          setWaitlistCount(res.data.data?.totalWaitlistCount || 0);
        }
      } catch (err) {
        console.error('Error fetching waitlist status:', err);
      }
    }

    checkWaitlistStatus();
  }, [id, token]);

  const handleJoinWaitlist = async () => {
    if (!token) {
      alert('Please sign in to join the resale waitlist.');
      return;
    }

    setWaitlistLoading(true);
    setWaitlistMessage('');

    try {
      const res = await api.post(`/events/${id}/waitlist`);
      if (res.data?.success) {
        setOnWaitlist(true);
        setWaitlistCount(res.data.data?.totalWaitlistCount || waitlistCount + 1);
        setWaitlistMessage(res.data.message || 'You have joined the resale waitlist!');
      } else {
        setWaitlistMessage(res.data?.message || 'Could not join waitlist');
      }
    } catch (err) {
      setWaitlistMessage(err.response?.data?.message || err.message);
    } finally {
      setWaitlistLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-9 w-9 border-t-2 border-b-2 border-[#22c55e]"></div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-4 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Event Not Found</h2>
        <p className="text-xs text-slate-500">{error || 'This event does not exist or has concluded.'}</p>
        <Link
          to="/events"
          className="btn-eventfrog text-xs"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Discover
        </Link>
      </div>
    );
  }

  const visual = getEventVisual(event, 0);

  return (
    <div className="space-y-8 pb-14 text-slate-800">
      
      {/* Top Breadcrumb & Category */}
      <div className="flex items-center justify-between">
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-[#16a34a] transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to all events
        </Link>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
          {visual.badge}
        </span>
      </div>

      {/* Eventfrog Clean White Event Header Card */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm flex flex-col lg:flex-row gap-8 items-start">
        {/* Event Image */}
        <div className="w-full lg:w-96 h-64 sm:h-72 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm relative shrink-0">
          <img
            src={visual.image}
            alt={event.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900/80 text-white backdrop-blur-md">
              {visual.badge}
            </span>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-600/90 text-white backdrop-blur-md">
              {event.status}
            </span>
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/95 text-slate-900 shadow-sm border border-slate-200">
              <Sparkles className="w-3 h-3 text-amber-500" /> Polygon Amoy NFT Verified
            </span>
          </div>
        </div>

        {/* Event Header Information */}
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#212b36] tracking-tight leading-tight">
              {event.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Official verified ticketing powered by TicketLedger smart contracts
            </p>
          </div>

          {/* Key Event Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center font-bold shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Date & Time</div>
                <div className="font-bold text-slate-900">
                  {new Date(event.date).toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">{event.time} PKT</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center font-bold shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Venue Location</div>
                <div className="font-bold text-slate-900 truncate max-w-[200px]">{event.venue}</div>
                <div className="text-[11px] text-slate-500 font-medium">{event.city}, Pakistan</div>
              </div>
            </div>
          </div>

          {/* Price Range & Quick Action */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Tickets Available From</span>
              <div className="text-2xl font-black text-slate-900">
                PKR {Number(event.tiers?.[0]?.price || event.pricing?.minPrice || 1500).toLocaleString()}
              </div>
            </div>

            {event.tiers && event.tiers.length > 0 && (
              <Link
                to={`/events/${event.id}/seats`}
                className="btn-eventfrog text-xs px-6 py-3 shadow"
              >
                <Ticket className="w-4 h-4" />
                <span>Choose Seats on Stadium Map</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Details & Guarantee */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-[#16a34a]" /> Event Information
            </h2>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          </div>

          {/* Blockchain & Security Guarantee */}
          <div className="p-6 rounded-3xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs text-emerald-950">
            <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm">
              <ShieldCheck className="w-5 h-5 text-[#16a34a]" /> Official Smart Contract Ticket Guarantee
            </div>
            <p className="leading-relaxed text-emerald-800">
              Every pass for <strong className="text-emerald-950">{event.name}</strong> is cryptographically minted as an ERC-721 token on Polygon Amoy. Secondary transfers are automatically capped at <strong className="text-emerald-950">110% of face value</strong>, and stadium entry gates require an animated 15-second rotating HMAC QR code.
            </p>
          </div>
        </div>

        {/* Right Column: Ticket Tiers & Organizer */}
        <div className="space-y-6">
          
          {/* Ticket Tiers / Enclosures */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Ticket className="w-4 h-4 text-[#16a34a]" /> Select Ticket Category
              </h2>
              <span className="text-[10px] uppercase font-bold text-slate-400">PKR</span>
            </div>

            <div className="space-y-3">
              {event.tiers?.map((tier) => (
                <div
                  key={tier.id}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{tier.name}</h3>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-medium">
                        {tier.availableQuantity} of {tier.totalQuantity} seats available
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-extrabold text-slate-900">
                        Rs. {Number(tier.price).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <Link
                    to={`/events/${event.id}/seats`}
                    className="w-full btn-eventfrog text-xs py-2.5"
                  >
                    <span>Choose Seats in {tier.name}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>

          {/* Organizer Card */}
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3 text-xs">
            <div className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Organizer</div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#16a34a] flex items-center justify-center font-bold">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  {event.company?.companyName || 'Official Event Partner'}
                  <CheckCircle2 className="w-4 h-4 text-[#16a34a]" title="Verified Organizer" />
                </div>
                <div className="text-slate-500 text-[11px]">
                  Verified Organizer • {event.company?.city || event.city}
                </div>
              </div>
            </div>
          </div>

          {/* Resale Waitlist Card */}
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <Bell className="w-4 h-4 text-emerald-600" />
                <span>Resale Waitlist</span>
              </div>
              <div className="text-[11px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full font-bold">
                {waitlistCount} waiting
              </div>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              If your preferred category is sold out, join the waitlist to receive instant notifications when authentic tickets are listed for resale.
            </p>

            {waitlistMessage && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px]">
                {waitlistMessage}
              </div>
            )}

            <button
              onClick={handleJoinWaitlist}
              disabled={waitlistLoading || onWaitlist}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
                onWaitlist
                  ? 'bg-slate-100 text-slate-600 border border-slate-200 cursor-default'
                  : 'btn-eventfrog'
              }`}
            >
              {onWaitlist ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>On Resale Waitlist</span>
                </>
              ) : waitlistLoading ? (
                <span>Joining...</span>
              ) : (
                <>
                  <Bell className="w-4 h-4" />
                  <span>Join Resale Waitlist</span>
                </>
              )}
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
