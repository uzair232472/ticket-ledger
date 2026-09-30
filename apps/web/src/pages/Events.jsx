import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { 
  Search, 
  MapPin, 
  Clock, 
  ChevronRight,
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Heart
} from 'lucide-react';
import api, { trackClientBehavior } from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';

const CATEGORY_OPTIONS = [
  { id: '', label: 'All Categories' },
  { id: 'CRICKET_MATCH', label: '🏏 PSL Cricket Match' },
  { id: 'MUSIC_CONCERT', label: '🎵 Live Concerts' },
  { id: 'MUSIC_FESTIVAL', label: '🎪 Music Festivals' },
  { id: 'KABADDI', label: '🤼 Kabaddi Clash' },
  { id: 'FOOTBALL_MATCH', label: '⚽ Football Match' },
  { id: 'BOXING', label: '🥊 Boxing Match' },
];

export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState({});

  // Filters initialized from URL query parameters (if navigated from Dashboard or Navbar)
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [city, setCity] = useState(searchParams.get('city') || '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') || '');

  // Synchronize when URL searchParams change
  useEffect(() => {
    const qSearch = searchParams.get('search') || '';
    const qType = searchParams.get('type') || '';
    const qCity = searchParams.get('city') || '';
    const qMaxPrice = searchParams.get('maxPrice') || '';
    setSearch(qSearch);
    setType(qType);
    setCity(qCity);
    setMaxPrice(qMaxPrice);
  }, [searchParams]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (type) params.append('type', type);
      if (city) params.append('city', city);
      if (maxPrice) params.append('maxPrice', maxPrice);

      const res = await api.get(`/events?${params.toString()}`);
      if (res.data.success) {
        setEvents(res.data.data.events || []);
      }

      if (type) {
        trackClientBehavior('category_view', null, { category: type, city: city || null });
      }
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [type, city, maxPrice, search]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchParams({ search, type, city, maxPrice });
    loadEvents();
  };

  const handleResetFilters = () => {
    setSearch('');
    setType('');
    setCity('');
    setMaxPrice('');
    setSearchParams({});
  };

  const toggleFavorite = (eventId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(prev => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  return (
    <div className="space-y-8 pb-16">
      
      {/* Top Banner */}
      <div className="bg-white rounded-3xl p-6 sm:p-10 border border-slate-200/90 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-[#16a34a] text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Official Event Lineup</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
            Discover Events & Book Tickets
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Browse upcoming sports matches, music concerts, festivals, and cultural events with verified smart contract seating and 100% entry guarantee.
          </p>
        </div>

        <Link
          to="/company"
          className="btn-eventfrog text-xs whitespace-nowrap px-5 py-3 shadow"
        >
          <span>Host an Event</span>
        </Link>
      </div>

      {/* Multi-Criteria Filter Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
          
          {/* Keyword Search */}
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search event, artist, or venue..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#22c55e] transition"
            />
          </div>

          {/* Category */}
          <div className="md:col-span-3">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e]"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* City */}
          <div className="md:col-span-3">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e]"
            >
              <option value="">All Cities in Pakistan</option>
              <option value="Lahore">Lahore (Gaddafi Stadium / Alhamra)</option>
              <option value="Karachi">Karachi (National Arena)</option>
              <option value="Islamabad">Islamabad / Rawalpindi</option>
              <option value="Faisalabad">Faisalabad</option>
              <option value="Multan">Multan</option>
            </select>
          </div>

          {/* Filter & Reset Buttons */}
          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              className="flex-1 btn-eventfrog text-xs py-2"
            >
              Filter
            </button>
            {(search || type || city || maxPrice) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                title="Reset Filters"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Event Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-80 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
          <SlidersHorizontal className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-base font-bold text-slate-900">No events found</div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Try adjusting your search criteria or resetting filters to see upcoming fixtures.
          </p>
          <button
            onClick={handleResetFilters}
            className="btn-eventfrog text-xs mt-2"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map((event, idx) => {
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
                  {/* Image with Category Badge & Heart */}
                  <div className="relative h-48 overflow-hidden bg-slate-100">
                    <img
                      src={visual.image}
                      alt={event.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                    <span className="absolute top-3 left-3 text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900/80 text-white backdrop-blur-md">
                      {visual.badge}
                    </span>

                    <button
                      onClick={(e) => toggleFavorite(event.id, e)}
                      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-rose-500 flex items-center justify-center transition shadow-sm"
                      title="Save Event"
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-600'}`} />
                    </button>
                  </div>

                  {/* Card Body */}
                  <div className="p-5 flex items-start gap-4">
                    {/* Eventfrog-Style Date Stamp */}
                    <div className="ec-date-badge flex-shrink-0">
                      <span className="ec-date-month">{monthStr}</span>
                      <span className="ec-date-day">{dayNum}</span>
                    </div>

                    {/* Details */}
                    <div className="space-y-1 flex-1 min-w-0">
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

                {/* Footer with Price & Green Get Tickets CTA */}
                <div className="p-5 pt-0 border-t border-slate-100 flex items-center justify-between mt-2">
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
      )}

    </div>
  );
}
