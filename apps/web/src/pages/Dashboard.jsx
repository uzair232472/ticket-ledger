import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Clock, 
  MapPin, 
  ChevronRight,
  Flame,
  Heart,
  Sparkles,
  Building2,
  ArrowRight
} from 'lucide-react';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';

const CATEGORY_TILES = [
  {
    id: 'CRICKET_MATCH',
    name: 'Cricket & Sports',
    count: 'Gaddafi & National Stadium',
    image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'MUSIC_CONCERT',
    name: 'Concerts & Live Music',
    count: 'Atif Aslam, Strings & Arenas',
    image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'MUSIC_FESTIVAL',
    name: 'Festivals & Expos',
    count: 'Karachi & Lahore Festivals',
    image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'KABADDI',
    name: 'Kabaddi Clashes',
    count: 'Circle Championships',
    image: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 'THEATER',
    name: 'Theater & Performing Arts',
    count: 'Alhamra & Arts Council',
    image: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=800&q=80',
  }
];

export default function Dashboard() {
  const { user, isAuthenticated } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState({});

  useEffect(() => {
    async function loadEvents() {
      try {
        setLoading(true);
        const res = await api.get('/events');
        if (res.data.success) {
          setEvents(res.data.data.events || []);
        }
      } catch (err) {
        console.error('Failed to load events:', err);
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, []);

  const toggleFavorite = (eventId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  // Top Highlights (Featured large cards)
  const highlightEvents = events.slice(0, 3);
  // Trending events
  const trendingEvents = events.slice(0, 6);

  return (
    <div className="w-full pb-16">
      
      {/* 1. Full-Width Edge-to-Edge Video Hero Banner (Exact Eventfrog Layout matching Image 3) */}
      <section className="relative w-full min-h-[460px] sm:min-h-[520px] lg:min-h-[560px] flex items-center overflow-hidden">
        {/* Background Video playing smoothly */}
        <video 
          autoPlay 
          muted 
          loop 
          playsInline 
          poster="https://res.eventfrog.net/herbstfroggy-standbild-HSYG98UW-4BFR6E9B.jpg?_=1788253818000"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="https://res.eventfrog.net/froggy-in-action-herbst-GOT0Y1DZ-LK9KBPCL.mp4?_=1788253818000" type="video/mp4" />
        </video>

        {/* Ambient Dark Overlay for sharp white typography contrast */}
        <div className="absolute inset-0 bg-black/45" />

        {/* Text Content matching Eventfrog in Image 3 */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 w-full py-20 sm:py-28">
          <div className="max-w-2xl space-y-4">
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.08]">
              Find your<br />next event.
            </h1>
            <p className="text-base sm:text-xl text-white/95 font-normal leading-relaxed">
              Whether it’s a concert, sports match or festival – your next highlight is on TicketLedger!
            </p>
            <div className="pt-2">
              <Link
                to="/events"
                className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-[#45b549] hover:bg-[#3ca440] text-white font-bold text-sm sm:text-base transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
              >
                Discover events now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
        
        {/* Top Highlights (Eventfrog ec-large card structure) */}
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="space-y-0.5">
              <h2 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Top Highlights</h2>
              <p className="text-xs text-slate-500">Hand-picked matches and arena tours this week</p>
            </div>
            <Link to="/events" className="text-xs font-bold text-[#16a34a] hover:underline flex items-center gap-1">
              <span>View All Events</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {highlightEvents.map((event, idx) => {
              const visual = getEventVisual(event, idx);
              const dateObj = new Date(event.date);
              const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
              const dayNum = dateObj.getDate();
              const isFav = favorites[event.id];

              return (
                <div 
                  key={event.id}
                  className="ec-card overflow-hidden flex flex-col justify-between group"
                >
                  <div>
                    {/* Top Image with Badge & Favorite Heart */}
                    <div className="relative h-48 overflow-hidden bg-slate-100">
                      <img
                        src={visual.image}
                        alt={event.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                      <div className="absolute top-3 left-3">
                        <span className="badge-sponsored shadow">
                          <Sparkles className="w-3 h-3 text-amber-300" />
                          <span>Featured</span>
                        </span>
                      </div>

                      <button
                        onClick={(e) => toggleFavorite(event.id, e)}
                        className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-rose-500 flex items-center justify-center transition shadow-sm"
                        title="Save Event"
                      >
                        <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-600'}`} />
                      </button>
                    </div>

                    {/* Card Info with Stacked Date Stamp (Eventfrog style) */}
                    <div className="p-5 flex items-start gap-4">
                      <div className="ec-date-badge flex-shrink-0">
                        <span className="ec-date-month">{monthStr}</span>
                        <span className="ec-date-day">{dayNum}</span>
                      </div>

                      <div className="space-y-1.5 flex-1 min-w-0">
                        <h3 className="font-bold text-base text-[#212b36] group-hover:text-[#16a34a] transition line-clamp-1">
                          {event.name}
                        </h3>
                        
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{dateObj.toLocaleDateString('en-US', { weekday: 'short' })}, {event.time} PKT</span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate">{event.venue}, {event.city}</span>
                        </div>

                        <p className="text-xs text-slate-500 line-clamp-2 pt-1 leading-relaxed">
                          {event.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Footer with Price & Green CTA */}
                  <div className="p-5 pt-0 border-t border-slate-100 flex items-center justify-between mt-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">From</span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        PKR {Number(event.pricing?.minPrice || 1500).toLocaleString()}
                      </span>
                    </div>

                    <Link
                      to={`/events/${event.id}`}
                      className="btn-eventfrog text-xs py-2 px-4"
                    >
                      <span>Get Tickets</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Trending Events (Eventfrog Trending Scroller layout) */}
        <section className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold">
                <Flame className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-[#212b36] tracking-tight">Trending Events</h2>
                <span className="text-xs text-slate-500 font-medium">Top selling stadium fixtures and concerts</span>
              </div>
            </div>
            <Link to="/events" className="text-xs font-bold text-[#16a34a] hover:underline flex items-center gap-1">
              <span>View All</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {trendingEvents.map((event, idx) => {
              const visual = getEventVisual(event, idx);
              const dateObj = new Date(event.date);

              return (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  className="flex items-center gap-3.5 p-3 rounded-2xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/70 transition group"
                >
                  <div className="w-7 h-7 rounded-lg bg-slate-200/70 text-slate-700 flex items-center justify-center font-extrabold text-xs flex-shrink-0">
                    #{idx + 1}
                  </div>

                  <img
                    src={visual.image}
                    alt={event.name}
                    className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border border-slate-200"
                  />

                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-xs text-slate-900 group-hover:text-[#16a34a] transition truncate">
                      {event.name}
                    </h4>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, {event.time} PKT
                    </div>
                    <div className="text-[10px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      <span>{event.venue}, {event.city}</span>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition" />
                </Link>
              );
            })}
          </div>
        </section>

        {/* Organizer Callout Banner */}
        <section className="rounded-3xl bg-gradient-to-r from-emerald-50 via-teal-50 to-green-50 p-8 sm:p-12 border border-emerald-200 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-[#45b549] text-white flex items-center justify-center mx-auto shadow-md shadow-emerald-500/20">
            <Building2 className="w-6 h-6" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
            Are you an event organizer?
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
            Host your events on TicketLedger with automated digital box-office pre-sales, tier pricing, and instant turnstile smartphone check-in.
          </p>
          <div className="pt-2">
            <Link
              to={isAuthenticated && (user?.role === 'ORGANIZER' || user?.role === 'SUPER_ADMIN') ? "/organizer/dashboard" : "/company"}
              className="btn-eventfrog text-sm px-8 py-3 shadow"
            >
              <span>Host an Event with TicketLedger</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* Browse by Category */}
        <section className="space-y-6">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Browse by Category</h2>
            <p className="text-xs text-slate-500">Explore live events across sports, music, and cultural arenas</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {CATEGORY_TILES.map((cat) => (
              <Link
                key={cat.id}
                to={`/events?type=${cat.id}`}
                className="group rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm hover:shadow-md transition text-center flex flex-col"
              >
                <div className="h-28 overflow-hidden relative">
                  <img
                    src={cat.image}
                    alt={cat.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition duration-500 filter brightness-95"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                </div>
                <div className="p-3">
                  <h4 className="font-bold text-xs text-[#212b36] group-hover:text-[#16a34a] transition">
                    {cat.name}
                  </h4>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {cat.count}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
