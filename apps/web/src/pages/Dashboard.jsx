import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUpRight, Search, RefreshCw, CalendarDays, Wallet, MapPin, Tag, List } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import markUrl from '../assets/ticketledger-mark.svg';
import HomeHeader from '../components/home/HomeHeader';
import EventCard from '../components/home/EventCard';
import SiteFooter, { organizerAction } from '../components/home/SiteFooter';
import EventMap, { CITY_COORDS } from '../components/home/EventMap';
import { initHomeMotion, refreshScrollScenes, TICKET_HOLE_RADIUS } from '../components/home/homeMotion';
import { HERO_IMAGE, COLLAGE_IMAGES, STAGE_IMAGE, CATEGORIES, STRIP_COUNT, TRAIL_SIZES } from '../components/home/homeData';
import '../components/home/home.css';

const INTRO_WORDS = 'brings Pakistan’s matches, concerts and festivals into one place. Choose your seats on a live map, carry a rotating QR ticket on your phone, and resell fairly if plans change.'.split(' ');
const CLOSING_WORDS = 'Host your next event on TicketLedger.'.split(' ');
const FEATURED_LIMIT = 6;
const hideBroken = (e) => e.currentTarget.classList.add('is-broken');

const Strips = ({ count }) =>
  Array.from({ length: count }, (_, i) => (
    // Strip heights grow linearly from top to bottom
    <div key={i} className="tl-strip" style={{ flex: `${i + 1} 1 0` }} />
  ));

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const featureHeadingRef = useRef(null);

  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [favorites, setFavorites] = useState({});
  const [filters, setFilters] = useState({ search: '', when: '', type: '', maxPrice: '', city: '' });

  const loadEvents = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await api.get('/events');
      setEvents(res.data?.data?.events || []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Scroll scenes: created once per mount, fully reverted on unmount (also covers React Strict Mode's double mount)
  useLayoutEffect(() => {
    const mm = initHomeMotion(rootRef.current);
    return () => mm.revert();
  }, []);

  // The browser restores scroll before the tall scenes and the event cards exist, so a refresh midway down
  // would land too high. Remember the position ourselves and restore it once the layout is complete.
  const pendingRestoreRef = useRef(null);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const nav = performance.getEntriesByType('navigation')[0];
    const saved = Number(sessionStorage.getItem('tl-home-scroll'));
    if (nav?.type === 'reload' && saved > 0) pendingRestoreRef.current = saved;
    const save = () => sessionStorage.setItem('tl-home-scroll', String(Math.round(window.scrollY)));
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      sessionStorage.removeItem('tl-home-scroll');
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Loaded cards change the page height, so pinned scenes below must be re-measured
  useEffect(() => {
    if (status === 'loading') return;
    requestAnimationFrame(() => {
      refreshScrollScenes();
      if (pendingRestoreRef.current != null) {
        window.scrollTo({ top: pendingRestoreRef.current, behavior: 'instant' });
        pendingRestoreRef.current = null;
      }
    });
  }, [status, events.length]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return [...events].filter((e) => new Date(e.date).getTime() >= now).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [events]);
  const featured = upcoming.slice(0, FEATURED_LIMIT);

  const countsByType = useMemo(
    () => upcoming.reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {}),
    [upcoming]
  );
  const cities = useMemo(() => {
    const map = new Map();
    upcoming.forEach((e) => map.set(e.city, (map.get(e.city) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [upcoming]);

  const toggleFavorite = (id) => setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));

  const skipIntro = () => {
    const el = featureHeadingRef.current;
    if (!el) return;
    const headerH = 84;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerH, behavior: 'instant' });
    el.focus({ preventScroll: true });
  };

  const scrollToCategories = useCallback(() => {
    const el = document.getElementById('categories');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: reduce ? 'instant' : 'smooth' });
    el.focus({ preventScroll: true });
  }, []);

  // Map filters apply instantly to the markers; "View in list" opens the Events page with the same filters
  // (it supports search, type, city and maxPrice; the date window only narrows the map)
  const mapEvents = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const days = Number(filters.when);
    const limit = days ? Date.now() + days * 86400000 : Infinity;
    return upcoming.filter((e) => {
      if (term && !`${e.name} ${e.venue} ${e.city}`.toLowerCase().includes(term)) return false;
      if (filters.type && e.type !== filters.type) return false;
      if (filters.city && e.city !== filters.city) return false;
      if (filters.maxPrice && !(e.pricing?.minPrice != null && Number(e.pricing.minPrice) <= Number(filters.maxPrice))) return false;
      return new Date(e.date).getTime() <= limit;
    });
  }, [upcoming, filters]);
  const unmapped = mapEvents.filter((e) => !CITY_COORDS[(e.city || '').trim().toLowerCase()]).length;
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const submitSearch = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    ['search', 'type', 'city', 'maxPrice'].forEach((k) => filters[k].trim() && params.set(k, filters[k].trim()));
    navigate(`/events${params.toString() ? `?${params}` : ''}`);
  };

  const organizer = organizerAction(user, isAuthenticated);

  return (
    <div ref={rootRef} className="tl-home">
      <HomeHeader pageRef={pageRef} onCategories={scrollToCategories} />

      <div ref={pageRef}>
        {/* ---------- 1. Pinned hero ---------- */}
        <section className="tl-hero-track" aria-label="Welcome">
          <div className="tl-hero-stage">
            <div className="tl-collage" aria-hidden="true">
              {COLLAGE_IMAGES.slice(0, 4).map((src) => (
                <div key={src} className="tl-collage-tile"><img src={src} alt="" loading="lazy" decoding="async" onError={hideBroken} /></div>
              ))}
              <div className="tl-collage-center" />
              {COLLAGE_IMAGES.slice(4).map((src) => (
                <div key={src} className="tl-collage-tile"><img src={src} alt="" loading="lazy" decoding="async" onError={hideBroken} /></div>
              ))}
              <div className="tl-collage-shade" style={{ gridArea: '1 / 1 / -1 / -1' }} />
            </div>

            <div className="tl-hero-panel">
              <img src={HERO_IMAGE.src} srcSet={HERO_IMAGE.srcSet} sizes="100vw" alt={HERO_IMAGE.alt} fetchpriority="high" onError={hideBroken} />
              <div className="tl-hero-panel-shade" />
              <div className="tl-hero-panel-dim" />
            </div>

            <div className="tl-hero-content">
              <div className="tl-hero-lead">
                <p className="tl-eyebrow">Live events across Pakistan</p>
                <h1>Your seat at every big night.</h1>
                <p>Cricket finals, concerts and festivals. Find what’s on and book your tickets in minutes.</p>
                <div className="tl-hero-actions">
                  <Link to="/events" className="tl-btn tl-btn--green">
                    Explore events <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
              <span className="tl-wordmark" aria-hidden="true">TicketLedger</span>
            </div>

            <div className="tl-hero-intro">
              <p className="tl-hero-intro-text">
                <span className="tl-intro-word tl-accent">TicketLedger </span>
                {INTRO_WORDS.map((w, i) => (
                  <span key={i} className="tl-intro-word">{w} </span>
                ))}
              </p>
              <div className="tl-hero-intro-cta">
                <Link to="/events" className="tl-btn tl-btn--green">
                  Browse events <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <button type="button" className="tl-skip" onClick={skipIntro}>
              Skip intro <ArrowDown className="w-4 h-4" aria-hidden="true" />
            </button>
            <div className="tl-cover-shade" aria-hidden="true" />
          </div>
        </section>

        {/* ---------- 2. Category panels ---------- */}
        <div className="tl-cat-track">
        <section id="categories" className="tl-categories" tabIndex={-1} aria-labelledby="tl-categories-title">
          <div className="tl-categories-head">
            <h2 id="tl-categories-title" className="tl-section-title">Categories</h2>
            <p>From floodlit stadiums to festival grounds, pick a category to see what’s coming up.</p>
          </div>
          <div className="tl-category-grid">
            {CATEGORIES.map((cat, i) => {
              const count = countsByType[cat.type] || 0;
              return (
                <Link
                  key={cat.type}
                  to={`/events?type=${cat.type}`}
                  className="tl-category"
                  style={{ '--panel': cat.panel, '--strip': cat.strip, '--ink': cat.ink }}
                  aria-label={`${cat.name}: ${status === 'ready' ? `${count} upcoming event${count === 1 ? '' : 's'}` : 'browse events'}`}
                >
                  {/* The face grows below the row on hover/focus without changing the page layout */}
                  <span className="tl-category-face">
                    <span className="tl-category-media" aria-hidden="true">
                      <img src={cat.image} alt="" loading="lazy" decoding="async" onError={hideBroken} />
                    </span>
                    <span className="tl-category-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="tl-category-foot">
                      {status === 'ready' && (
                        <span className="tl-category-count">{count ? `${count} upcoming` : 'Nothing scheduled yet'}</span>
                      )}
                      <span className="tl-category-label">
                        {cat.name}
                        <ArrowUpRight className="w-5 h-5" aria-hidden="true" />
                      </span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="tl-cover-shade" aria-hidden="true" />
        </section>
        </div>

        {/* ---------- 3–4. Strip reveal, featured events and discovery over one background ---------- */}
        <section className="tl-feature" aria-labelledby="tl-featured-title">
          <div className="tl-feature-bg" aria-hidden="true">
            <img src={STAGE_IMAGE} alt="" loading="lazy" decoding="async" onError={hideBroken} />
            <div className="tl-feature-dim" />
            <div className="tl-strips">
              <Strips count={STRIP_COUNT} />
            </div>
          </div>

          <div className="tl-feature-content">
            <div className="tl-feature-spacer" aria-hidden="true" />
            <div className="tl-cards-block">
            <div className="tl-cards-block-inner">
            <div className="tl-feature-head">
              <h2 id="tl-featured-title" ref={featureHeadingRef} tabIndex={-1} className="tl-section-title">
                Featured events
              </h2>
              <Link to="/events" className="tl-btn tl-btn--green">
                View all events <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>

            {status === 'loading' && (
              <div className="tl-cards" aria-busy="true" aria-label="Loading events">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="tl-card" aria-hidden="true">
                    <div className="tl-card-media tl-skeleton" />
                    <div className="tl-card-body"><div className="tl-skeleton" style={{ height: 120, borderRadius: 6 }} /></div>
                  </div>
                ))}
              </div>
            )}
            {status === 'error' && (
              <div className="tl-card-state" role="alert">
                <p>We couldn’t load events right now.</p>
                <button type="button" className="tl-btn tl-btn--green" style={{ marginTop: 16 }} onClick={loadEvents}>
                  <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again
                </button>
              </div>
            )}
            {status === 'ready' && featured.length === 0 && (
              <div className="tl-card-state">
                <p>No upcoming events are published yet. Check back soon.</p>
              </div>
            )}
            {status === 'ready' && featured.length > 0 && (
              <div className="tl-cards">
                {featured.map((event, i) => (
                  <EventCard key={event.id} event={event} index={i} isFavorite={favorites[event.id]} onToggleFavorite={toggleFavorite} />
                ))}
              </div>
            )}

            </div>
            <div className="tl-cover-shade" aria-hidden="true" />
            </div>
            <div className="tl-cards-hold" aria-hidden="true" />

            {/* Full-screen event map: slides over the featured events, then stays pinned while the closing
                scene slides over it. The map is drawn over the same concert background. */}
            <section className="tl-mapscene" aria-labelledby="tl-map-title">
              <div className="tl-mapscene-bg" aria-hidden="true">
                <img src={STAGE_IMAGE} alt="" loading="lazy" decoding="async" onError={hideBroken} />
              </div>
              <EventMap events={mapEvents} />
              <div className="tl-mapscene-overlay">
                <div className="tl-discover-head">
                  <div>
                    <p className="tl-eyebrow">Find your next event</p>
                    <h2 id="tl-map-title" style={{ marginTop: 8 }}>Events across Pakistan</h2>
                  </div>
                  <p className="tl-discover-count" aria-live="polite">
                    {status === 'ready' ? `${mapEvents.length} event${mapEvents.length === 1 ? '' : 's'} match` : 'Loading events…'}
                  </p>
                </div>

                <form className="tl-filter-bar" onSubmit={submitSearch} role="search" aria-label="Filter events on the map">
                  <label className="tl-pill tl-pill--wide">
                    <Search className="w-4 h-4" aria-hidden="true" />
                    <span className="tl-pill-text">
                      <span className="tl-pill-label">search</span>
                      <input type="search" value={filters.search} onChange={setFilter('search')} placeholder="event or venue" />
                    </span>
                  </label>
                  <label className="tl-pill">
                    <CalendarDays className="w-4 h-4" aria-hidden="true" />
                    <span className="tl-pill-text">
                      <span className="tl-pill-label">when</span>
                      <select value={filters.when} onChange={setFilter('when')}>
                        <option value="">any date</option>
                        <option value="7">next 7 days</option>
                        <option value="30">next 30 days</option>
                        <option value="90">next 3 months</option>
                      </select>
                    </span>
                  </label>
                  <label className="tl-pill">
                    <Tag className="w-4 h-4" aria-hidden="true" />
                    <span className="tl-pill-text">
                      <span className="tl-pill-label">category</span>
                      <select value={filters.type} onChange={setFilter('type')}>
                        <option value="">any</option>
                        {CATEGORIES.map((c) => (
                          <option key={c.type} value={c.type}>{c.name}</option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <label className="tl-pill">
                    <Wallet className="w-4 h-4" aria-hidden="true" />
                    <span className="tl-pill-text">
                      <span className="tl-pill-label">budget</span>
                      <select value={filters.maxPrice} onChange={setFilter('maxPrice')}>
                        <option value="">any</option>
                        <option value="1500">up to PKR 1,500</option>
                        <option value="3000">up to PKR 3,000</option>
                        <option value="5000">up to PKR 5,000</option>
                        <option value="10000">up to PKR 10,000</option>
                      </select>
                    </span>
                  </label>
                  <label className="tl-pill">
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                    <span className="tl-pill-text">
                      <span className="tl-pill-label">where</span>
                      <select value={filters.city} onChange={setFilter('city')}>
                        <option value="">all of Pakistan</option>
                        {cities.map(([city]) => (
                          <option key={city} value={city}>{city}</option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <button type="submit" className="tl-pill tl-pill--action">
                    <List className="w-4 h-4" aria-hidden="true" /> View in list
                  </button>
                </form>

                {unmapped > 0 && (
                  <p className="tl-map-note">
                    {unmapped} matching event{unmapped === 1 ? ' is' : 's are'} in a city not shown on the map. Use “View in list” to see {unmapped === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </div>
              {status === 'ready' && mapEvents.length === 0 && (
                <p className="tl-map-empty">No events match these filters.</p>
              )}
              {status === 'error' && <p className="tl-map-empty" role="alert">Events couldn’t be loaded.</p>}
              <div className="tl-cover-shade" aria-hidden="true" />
            </section>
            <div className="tl-feature-tail" aria-hidden="true" />
          </div>
        </section>

        {/* ---------- 5. Zoom through the ticket into the organizer section ---------- */}
        <section className="tl-closing tl-closing-track" aria-labelledby="tl-closing-title">
          <div className="tl-closing-stage">
            {/* The stadium from the opening scene: a distinct scene sliding over the discovery block, seen again through the ticket hole */}
            <div className="tl-closing-bg" aria-hidden="true">
              <img src={HERO_IMAGE.src} srcSet={HERO_IMAGE.srcSet} sizes="100vw" alt="" loading="lazy" decoding="async" onError={hideBroken} />
            </div>

            <svg className="tl-ticket-svg" viewBox="-500 -300 1000 600" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              <g className="tl-ticket-g">
                {/* Ticket body with side notches and a punched hole at its centre (even-odd fill) */}
                <path
                  fillRule="evenodd"
                  fill="#22c55e"
                  d={[
                    'M -352 -170 H 352 A 28 28 0 0 1 380 -142 V -34 A 34 34 0 0 0 380 34 V 142 A 28 28 0 0 1 352 170',
                    'H -352 A 28 28 0 0 1 -380 142 V 34 A 34 34 0 0 0 -380 -34 V -142 A 28 28 0 0 1 -352 -170 Z',
                    `M ${TICKET_HOLE_RADIUS} 0 A ${TICKET_HOLE_RADIUS} ${TICKET_HOLE_RADIUS} 0 1 0 ${-TICKET_HOLE_RADIUS} 0 A ${TICKET_HOLE_RADIUS} ${TICKET_HOLE_RADIUS} 0 1 0 ${TICKET_HOLE_RADIUS} 0 Z`,
                  ].join(' ')}
                />
                <line x1="200" y1="-150" x2="200" y2="150" stroke="#052e16" strokeOpacity="0.35" strokeWidth="3" strokeDasharray="10 10" />
                <text x="-330" y="-112" fill="#052e16" fontFamily="JetBrains Mono, monospace" fontSize="22" fontWeight="700" letterSpacing="5">ADMIT ONE</text>
                <text x="-330" y="128" fill="#052e16" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="46" fontWeight="800" letterSpacing="-2">TicketLedger</text>
                <text x="232" y="-112" fill="#052e16" fontFamily="JetBrains Mono, monospace" fontSize="18" fontWeight="600" letterSpacing="3">SEAT</text>
                <text x="232" y="-62" fill="#052e16" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="44" fontWeight="800">A-12</text>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
                  <rect key={i} x={232 + i * 10} y="70" width={i % 3 === 0 ? 6 : 3} height="64" fill="#052e16" opacity="0.8" />
                ))}
              </g>
            </svg>

            <div className="tl-closing-green" aria-hidden="true" />

            <div className="tl-closing-content">
              <p className="tl-eyebrow" data-closing-reveal>For organizers</p>
              <h2 id="tl-closing-title" className="tl-closing-title">
                {CLOSING_WORDS.map((w, i) => (
                  <span key={i} className="tl-closing-word">{w} </span>
                ))}
              </h2>
              <p className="tl-closing-text" data-closing-reveal>
                Register your company for approval, set up ticket tiers and seating, check a demand forecast before you
                publish, and invite gate staff to scan tickets at the door.
              </p>
              <div className="tl-closing-actions" data-closing-reveal>
                <Link to={organizer.primary.to} className="tl-btn tl-btn--dark">
                  {organizer.primary.label} <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                {organizer.secondary && (
                  <Link to={organizer.secondary.to} className="tl-link">{organizer.secondary.label}</Link>
                )}
              </div>
            </div>

            <div className="tl-trail" aria-hidden="true">
              {TRAIL_SIZES.map((size, i) => (
                <span key={size} className="tl-trail-dot" style={{ '--size': `${size}px`, '--alpha': [1, 0.6, 0.45, 0.32, 0.22, 0.14][i] }}>
                  <span className="tl-trail-icon" style={{ backgroundImage: `url(${markUrl})` }} />
                </span>
              ))}
            </div>
            <div className="tl-cover-shade" aria-hidden="true" />
          </div>
        </section>

        {/* ---------- Footer ---------- */}
        <SiteFooter onCategories={scrollToCategories} />
      </div>
    </div>
  );
}
