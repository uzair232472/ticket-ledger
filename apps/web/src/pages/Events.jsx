import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Ticket, 
  Search, 
  MapPin, 
  Calendar, 
  Clock, 
  Tag, 
  Filter, 
  RefreshCw,
  Sparkles,
  ArrowRight,
  Building2
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

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [city, setCity] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

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
  }, [type, city, maxPrice]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadEvents();
  };

  const handleResetFilters = () => {
    setSearch('');
    setType('');
    setCity('');
    setMaxPrice('');
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 border border-slate-800 shadow-xl">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
            <Ticket className="w-3.5 h-3.5" /> Module 5: Event Discovery & Tiers
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Discover Live Sports & Concerts in Pakistan
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
            Browse authentic Pakistan Super League cricket, circle kabaddi clashes, and mega live music festivals. Every ticket is cryptographically backed by Polygon ERC721 smart contracts.
          </p>
        </div>
      </div>

      {/* Multi-Criteria Filter Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by event title, venue, or artist..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
          >
            Search
          </button>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          {/* Event Type Filter */}
          <div>
            <label className="block text-[11px] text-slate-400 font-medium mb-1">Event Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="">All Types (Cricket, Concerts, etc.)</option>
              <option value="CRICKET_MATCH">🏏 Cricket Match (PSL)</option>
              <option value="MUSIC_CONCERT">🎵 Music Concert</option>
              <option value="MUSIC_FESTIVAL">🎪 Music Festival</option>
              <option value="KABADDI">🤼 Kabaddi Clash</option>
              <option value="FOOTBALL_MATCH">⚽ Football Match</option>
              <option value="BOXING">🥊 Boxing</option>
            </select>
          </div>

          {/* Pakistani City Filter */}
          <div>
            <label className="block text-[11px] text-slate-400 font-medium mb-1">City in Pakistan</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="">All Cities</option>
              <option value="Lahore">Lahore (Gaddafi Stadium / Alhamra)</option>
              <option value="Karachi">Karachi (National Stadium / Arts Council)</option>
              <option value="Islamabad">Islamabad / Rawalpindi</option>
              <option value="Faisalabad">Faisalabad</option>
              <option value="Multan">Multan</option>
              <option value="Peshawar">Peshawar</option>
              <option value="Quetta">Quetta</option>
            </select>
          </div>

          {/* Price Class Filter */}
          <div>
            <label className="block text-[11px] text-slate-400 font-medium mb-1">Max Ticket Price (PKR)</label>
            <select
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            >
              <option value="">Any Price</option>
              <option value="2000">Under Rs. 2,000</option>
              <option value="5000">Under Rs. 5,000</option>
              <option value="10000">Under Rs. 10,000</option>
            </select>
          </div>

          {/* Reset Filters */}
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleResetFilters}
              className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Events Grid */}
      {loading ? (
        <div className="p-16 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500 mx-auto"></div>
        </div>
      ) : events.length === 0 ? (
        <div className="p-16 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl space-y-2">
          <p>No events found matching your filter criteria.</p>
          <button
            onClick={handleResetFilters}
            className="text-emerald-400 hover:underline font-semibold"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition overflow-hidden flex flex-col justify-between shadow-lg group"
            >
              <div>
                {/* Event Banner */}
                <div className="relative h-48 overflow-hidden bg-slate-950">
                  <img
                    src={event.bannerUrl}
                    alt={event.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

                  <span className="absolute top-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-950/80 text-emerald-400 border border-emerald-500/30 backdrop-blur">
                    {EVENT_TYPE_LABELS[event.type] || event.type}
                  </span>

                  <span className="absolute bottom-3 left-3 text-xs font-bold text-white flex items-center gap-1.5 drop-shadow">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    {event.city}, Pakistan
                  </span>
                </div>

                {/* Content */}
                <div className="p-5 space-y-3">
                  <h3 className="font-bold text-white text-base leading-snug group-hover:text-emerald-400 transition">
                    {event.name}
                  </h3>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {event.description}
                  </p>

                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span>{new Date(event.date).toLocaleDateString('en-PK', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <span>•</span>
                      <Clock className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span>{event.time}</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                      <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                      <span className="truncate">{event.venue}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer: Pricing & Action */}
              <div className="p-5 pt-0">
                <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Starting from</span>
                    <div className="text-base font-extrabold text-emerald-400">
                      Rs. {Number(event.pricing?.minPrice).toLocaleString()}
                    </div>
                  </div>

                  <Link
                    to={`/events/${event.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
                  >
                    View Details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
