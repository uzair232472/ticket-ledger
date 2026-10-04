import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, RefreshCw, Search } from 'lucide-react';
import api from '../utils/api';
import { useWishlist } from '../context/WishlistContext';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import EventTile from '../components/events/EventTile';
import '../components/home/home.css';
import '../components/events/events.css';

const SORTS = [
  { value: 'saved', label: 'Recently saved' },
  { value: 'date', label: 'Date: soonest' },
  { value: 'price', label: 'Price: lowest' },
];

/**
 * The signed-in user's wishlist, laid out like Explore Events. Only their own saved events are listed;
 * removing the heart takes an event off the page straight away.
 */
export default function Wishlist() {
  const navigate = useNavigate();
  const pageRef = useRef(null);
  const { isSaved, toggle } = useWishlist();
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('saved');

  const load = async () => {
    setStatus('loading');
    try {
      const res = await api.get('/wishlist');
      setEvents(res.data?.data?.events || []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Hearts removed anywhere (here or on another page) drop the event from the list at once
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = events.filter((e) => isSaved(e.id) && (!term || `${e.name} ${e.venue} ${e.city}`.toLowerCase().includes(term)));
    if (sort === 'date') return [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sort === 'price') return [...list].sort((a, b) => (a.pricing?.minPrice ?? 0) - (b.pricing?.minPrice ?? 0));
    return list;
  }, [events, isSaved, search, sort]);
  const savedCount = events.filter((e) => isSaved(e.id)).length;

  return (
    <div className="tl-home tl-explore">
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/categories')} tone="light" />
      <div ref={pageRef}>
        <main className="tl-ex-main">
          <div className="tl-ex-head">
            <h1 className="tl-ex-title">Wishlist</h1>
            <p className="tl-wl-count" aria-live="polite">
              <Heart className="w-4 h-4" fill="currentColor" aria-hidden="true" /> {savedCount} saved event{savedCount === 1 ? '' : 's'}
            </p>
          </div>

          <div className="tl-ex-filters" role="search" aria-label="Search your wishlist">
            <label className="tl-ex-search">
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Search saved events</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search saved events, venues, cities" />
            </label>
            <label className="tl-ex-select">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {status === 'loading' && (
            <div className="tl-ex-grid" aria-busy="true" aria-label="Loading your wishlist">
              {[0, 1, 2].map((i) => (
                <div key={i} className="tl-tile tl-tile--skeleton" aria-hidden="true">
                  <div className="tl-tile-media" />
                  <div className="tl-tile-caption"><span /><span /></div>
                </div>
              ))}
            </div>
          )}

          {status === 'error' && (
            <div className="tl-ex-empty" role="alert">
              <p>We couldn’t load your wishlist right now.</p>
              <button type="button" className="tl-ex-btn" onClick={load}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again</button>
            </div>
          )}

          {status === 'ready' && savedCount === 0 && (
            <div className="tl-ex-empty">
              <span className="tl-wl-empty-icon" aria-hidden="true"><Heart className="w-8 h-8" /></span>
              <p>Your wishlist is empty.</p>
              <p className="tl-wl-hint">Tap the heart on any event to save it here.</p>
              <Link to="/events" className="tl-ex-btn">Explore events</Link>
            </div>
          )}

          {status === 'ready' && savedCount > 0 && shown.length === 0 && (
            <div className="tl-ex-empty">
              <p>No saved events match “{search}”.</p>
              <button type="button" className="tl-ex-btn" onClick={() => setSearch('')}>Clear search</button>
            </div>
          )}

          {shown.length > 0 && (
            <div className="tl-ex-grid">
              {shown.map((event, i) => (
                <EventTile key={event.id} event={event} index={i} isFavorite={isSaved(event.id)} onToggleFavorite={toggle} />
              ))}
            </div>
          )}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
