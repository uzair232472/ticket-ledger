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

const EVENT_TYPE_LABELS = {
  CRICKET_MATCH: '🏏 Cricket Match',
  FOOTBALL_MATCH: '⚽ Football Match',
  KABADDI: '🤼 Kabaddi Match',
  BOXING: '🥊 Boxing Match',
  MUSIC_CONCERT: '🎵 Music Concert',
  MUSIC_FESTIVAL: '🎪 Music Festival',
};

export default function EventDetails() {
  const { id } = useParams();
  const { user, token } = useAuth();
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

          // Track client-side event_view telemetry
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
        const res = await fetch(`${API_URL}/api/events/${id}/waitlist`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) {
          setOnWaitlist(data.data?.onWaitlist || false);
          setWaitlistCount(data.data?.totalWaitlistCount || 0);
        }
      } catch (err) {
        console.error('Error fetching waitlist status:', err);
      }
    }

    checkWaitlistStatus();
  }, [id, token]);

  const handleJoinWaitlist = async () => {
    if (!token) {
      alert('Please log in to join the event resale waitlist.');
      return;
    }

    setWaitlistLoading(true);
    setWaitlistMessage('');

    try {
      const res = await fetch(`${API_URL}/api/events/${id}/waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setOnWaitlist(true);
        setWaitlistCount(data.data?.totalWaitlistCount || waitlistCount + 1);
        setWaitlistMessage(data.message || 'You have joined the resale waitlist!');
      } else {
        setWaitlistMessage(data.message || 'Could not join waitlist');
      }
    } catch (err) {
      setWaitlistMessage(err.message);
    } finally {
      setWaitlistLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <h2 className="text-xl font-bold text-white">Event Not Found</h2>
        <p className="text-xs text-slate-400">{error || 'This event does not exist or may have ended.'}</p>
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Breadcrumb & Back */}
      <div className="flex items-center justify-between">
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to all events
        </Link>
        <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">
          {EVENT_TYPE_LABELS[event.type] || event.type}
        </span>
      </div>

      {/* Main Hero Header */}
      <div className="relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-800">
        <div className="h-64 sm:h-80 md:h-96 w-full relative">
          <img
            src={event.bannerUrl || 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=1200'}
            alt={event.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-950/80 text-emerald-400 border border-emerald-800 backdrop-blur-md">
              {event.status}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-900/80 text-slate-300 border border-slate-700 backdrop-blur-md flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Polygon Amoy NFT Verified
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
            {event.name}
          </h1>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs sm:text-sm text-slate-300">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span>{new Date(event.date).toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>{event.time}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>{event.venue}, {event.city}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Details & Itinerary */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-400" /> Event Information
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          </div>

          {/* Blockchain & Security Guarantee */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-emerald-950/30 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <ShieldCheck className="w-4 h-4" /> Polygon Amoy NFT Guarantee & Anti-Scalp Protection
            </div>
            <p className="text-slate-400 leading-relaxed">
              Every ticket issued for this event is minted as a genuine ERC721 NFT directly to your connected Web3 wallet. Secondary ticket resales are strictly capped at a maximum of 110% of the original face value on-chain, eliminating black-market scalping.
            </p>
          </div>
        </div>

        {/* Right Column: Organizer, Waitlist & Tiers */}
        <div className="space-y-6">
          {/* Organizer Card */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
            <div className="text-slate-400 font-medium">Hosted By</div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-white text-sm flex items-center gap-1.5">
                  {event.company?.companyName}
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" title="Verified Organizer" />
                </div>
                <div className="text-slate-400 text-[11px]">
                  Verified Organizer • {event.company?.city}
                </div>
              </div>
            </div>
          </div>

          {/* Waitlist Card (Module 11) */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-900/40 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-white">
                <Bell className="w-4 h-4 text-cyan-400" />
                <span>Secondary Resale Waitlist</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded-full font-mono">
                <Users className="w-3 h-3" />
                <span>{waitlistCount} waiting</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Can't find your desired tier or seats? Join the official waitlist to receive instant notifications when verified fans list tickets for resale within the 110% cap.
            </p>

            {waitlistMessage && (
              <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800 text-cyan-300 text-[11px]">
                {waitlistMessage}
              </div>
            )}

            <button
              onClick={handleJoinWaitlist}
              disabled={waitlistLoading || onWaitlist}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
                onWaitlist
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 cursor-default'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-md shadow-cyan-600/20'
              }`}
            >
              {onWaitlist ? (
                <>
                  <Check className="w-4 h-4 text-cyan-400" />
                  <span>On Resale Alert Waitlist</span>
                </>
              ) : waitlistLoading ? (
                <span>Joining Waitlist...</span>
              ) : (
                <>
                  <Bell className="w-4 h-4" />
                  <span>Join Waitlist for Resale Alerts</span>
                </>
              )}
            </button>
          </div>

          {/* Ticket Tiers / Classes */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Ticket className="w-4 h-4 text-emerald-400" /> Ticket Tiers & Pricing
              </h2>
              <span className="text-[10px] text-slate-400">All prices in PKR</span>
            </div>

            <div className="space-y-3">
              {event.tiers?.map((tier) => (
                <div
                  key={tier.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 transition flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-white text-xs">{tier.name}</h3>
                      <div className="text-[10px] text-emerald-400 mt-0.5">
                        {tier.availableQuantity} of {tier.totalQuantity} seats available
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-extrabold text-white">
                        Rs. {Number(tier.price).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <Link
                    to={`/events/${event.id}/seats`}
                    className="w-full mt-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1"
                  >
                    Select Seats in {tier.name} <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
