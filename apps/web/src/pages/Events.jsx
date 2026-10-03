import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigationType, useSearchParams } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Search, X, RefreshCw, ChevronDown, Check } from 'lucide-react';
import api, { trackClientBehavior } from '../utils/api';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import EventTile from '../components/events/EventTile';
import { ALL_CATEGORIES, categoryName } from '../components/home/homeData';
import '../components/home/home.css';
import '../components/events/events.css';

gsap.registerPlugin(ScrollTrigger);

const BATCH = 6; // the reference reveals six projects at a time
const SWAP_DELAY = 180; // results fade briefly before being replaced (as on the reference)
const RETURN_KEY = 'tl-explore-return';
// Lets the event page step back through history (restoring this list) instead of reloading it
const EXPLORE_LINK_STATE = { exploreDepth: 1 };

// Cities offered before results load (the list the page already used), plus any found in the results
const KNOWN_CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Faisalabad', 'Multan'];

const WHEN_OPTIONS = [
  { value: '', label: 'Any date' },
  { value: '7', label: 'Next 7 days' },
  { value: '30', label: 'Next 30 days' },
  { value: '90', label: 'Next 3 months' },
];
const PRICE_OPTIONS = [
  { value: '', label: 'Any price' },
  { value: '1500', label: 'Up to PKR 1,500' },
  { value: '3000', label: 'Up to PKR 3,000' },
  { value: '5000', label: 'Up to PKR 5,000' },
  { value: '10000', label: 'Up to PKR 10,000' },
];
const SORT_OPTIONS = [
  { value: '', label: 'Date: soonest' },
  { value: 'date-desc', label: 'Date: latest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

const FILTER_KEYS = ['search', 'type', 'city', 'maxPrice', 'when', 'sort'];
const labelOf = (options, value) => options.find((o) => o.value === value)?.label || value;

const sortEvents = (list, sort) => {
  const price = (e) => (e.pricing?.minPrice == null ? Infinity : Number(e.pricing.minPrice));
  const time = (e) => new Date(e.date).getTime();
  const sorted = [...list];
  if (sort === 'date-desc') sorted.sort((a, b) => time(b) - time(a));
  else if (sort === 'price-asc') sorted.sort((a, b) => price(a) - price(b) || time(a) - time(b));
  else if (sort === 'price-desc') sorted.sort((a, b) => (price(b) === Infinity ? -1 : price(a) === Infinity ? 1 : price(b) - price(a)) || time(a) - time(b));
  else sorted.sort((a, b) => time(a) - time(b));
  return sorted;
};

export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const categoriesRef = useRef(null);
  const requestRef = useRef(0);

  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ''])), [searchParams]);
  const [searchText, setSearchText] = useState(filters.search);

  // Returning from an event page restores the batch count and scroll position
  const saved = useMemo(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
      return navigationType === 'POP' && s && s.query === searchParams.toString() ? s : null;
    } catch {
      return null;
    }
    // Only read on first render
  }, []);

  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [leaving, setLeaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [visible, setVisible] = useState(saved?.visible || BATCH);
  const [favorites, setFavorites] = useState({});

  const setFilter = useCallback(
    (key, value) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const clearFilters = () => {
    setSearchText('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  // Debounced search box → URL
  useEffect(() => {
    if (searchText === filters.search) return undefined;
    const t = setTimeout(() => setFilter('search', searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText, filters.search, setFilter]);
  useEffect(() => setSearchText(filters.search), [filters.search]);

  // Fetch: only the newest request may update the page (rapid filter changes cannot show stale results)
  const fetchKey = ['search', 'type', 'city', 'maxPrice', 'when'].map((k) => filters[k]).join('|');
  const load = useCallback(async () => {
    const id = ++requestRef.current;
    const params = new URLSearchParams();
    ['search', 'type', 'city', 'maxPrice'].forEach((k) => filters[k] && params.set(k, filters[k]));
    if (filters.when) {
      const end = new Date(Date.now() + Number(filters.when) * 86400000);
      params.set('startDate', new Date().toISOString());
      params.set('endDate', end.toISOString());
    }
    setLeaving(true);
    setStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
    const started = Date.now();
    try {
      const res = await api.get(`/events?${params}`);
      const wait = SWAP_DELAY - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (id !== requestRef.current) return;
      setEvents(res.data?.data?.events || []);
      setStatus('ready');
    } catch {
      if (id !== requestRef.current) return;
      setStatus('error');
    } finally {
      if (id === requestRef.current) {
        setLeaving(false);
        setVersion((v) => v + 1);
      }
    }
    if (filters.type) trackClientBehavior('category_view', null, { category: filters.type, city: filters.city || null });
    // fetchKey captures every filter that changes the request
  }, [fetchKey]);

  // A filter change starts a new result set: back to the first batch. Comparing keys (rather than
  // "not the first run") keeps a restored batch intact when Strict Mode re-runs the effect.
  const lastKey = useRef(null);
  useEffect(() => {
    if (lastKey.current !== null && lastKey.current !== fetchKey) setVisible(BATCH);
    lastKey.current = fetchKey;
    load();
  }, [load, fetchKey]);

  const sorted = useMemo(() => sortEvents(events, filters.sort), [events, filters.sort]);
  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;

  const cities = useMemo(() => {
    const set = new Set(KNOWN_CITIES);
    events.forEach((e) => e.city && set.add(e.city));
    if (filters.city) set.add(filters.city);
    return [...set];
  }, [events, filters.city]);

  const activeChips = [
    filters.search && { key: 'search', label: `“${filters.search}”` },
    filters.type && { key: 'type', label: categoryName(filters.type) },
    filters.city && { key: 'city', label: filters.city },
    filters.when && { key: 'when', label: labelOf(WHEN_OPTIONS, filters.when) },
    filters.maxPrice && { key: 'maxPrice', label: labelOf(PRICE_OPTIONS, filters.maxPrice) },
  ].filter(Boolean);
  const hasFilters = activeChips.length > 0;

  // Restore scroll after the saved batch has rendered
  const restored = useRef(false);
  useEffect(() => {
    if (!saved || restored.current || status !== 'ready') return;
    restored.current = true;
    requestAnimationFrame(() => window.scrollTo({ top: saved.y, behavior: 'instant' }));
    sessionStorage.removeItem(RETURN_KEY);
  }, [saved, status]);

  const rememberPosition = () => {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ query: searchParams.toString(), visible, y: Math.round(window.scrollY) }));
  };

  // Categories: one button that opens the full list (there are too many for a single row)
  const [catsOpen, setCatsOpen] = useState(false);
  const focusCategories = useCallback(() => {
    categoriesRef.current?.querySelector('button')?.focus({ preventScroll: true });
    categoriesRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setCatsOpen(true);
  }, []);
  useEffect(() => {
    if (!catsOpen) return undefined;
    const onDown = (e) => !categoriesRef.current?.contains(e.target) && setCatsOpen(false);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setCatsOpen(false);
      categoriesRef.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [catsOpen]);
  const pickCategory = (type) => {
    setFilter('type', type);
    setCatsOpen(false);
    categoriesRef.current?.querySelector('button')?.focus({ preventScroll: true });
  };

  // Footer: header logo steps aside; the footer lettering rises in (toggle actions, like the reference)
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root.querySelector('[data-home-header]');
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: '.tl-footer',
        start: 'top 80px',
        onToggle: (self) => { header.dataset.atFooter = String(self.isActive); },
      });
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.fromTo(
          '.tl-footer-wordmark',
          { yPercent: 30, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: '.tl-footer', start: 'top 70%', toggleActions: 'play none none reverse' } }
        );
      }
    }, root);
    return () => {
      ctx.revert();
      delete header.dataset.atFooter;
    };
  }, []);
  useEffect(() => {
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }, [version, visible]);

  return (
    <div ref={rootRef} className="tl-home tl-explore">
      <HomeHeader pageRef={pageRef} onCategories={focusCategories} tone="light" />

      <div ref={pageRef}>
        <main className="tl-ex-main">
          <div className="tl-ex-head">
            <h1 className="tl-ex-title">Explore Events</h1>
            <div ref={categoriesRef} className="tl-ex-cats">
              <button
                type="button"
                className={`tl-ex-cats-btn${catsOpen ? ' is-open' : ''}`}
                aria-expanded={catsOpen}
                aria-controls="tl-ex-cats-panel"
                onClick={() => setCatsOpen((o) => !o)}
              >
                <span className="tl-ex-cats-btn-label">Category</span>
                <span className="tl-ex-cats-btn-value">{filters.type ? categoryName(filters.type) : 'All'}</span>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              </button>
              {catsOpen && (
                <div id="tl-ex-cats-panel" className="tl-ex-cats-panel" role="group" aria-label="Categories">
                  {[{ type: '', name: 'All categories' }, ...ALL_CATEGORIES].map((c) => {
                    const active = filters.type === c.type;
                    return (
                      <button
                        key={c.type || 'all'}
                        type="button"
                        className={`tl-ex-cat${active ? ' is-active' : ''}`}
                        aria-pressed={active}
                        onClick={() => pickCategory(c.type)}
                      >
                        <span>{c.name}</span>
                        {active && <Check className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <form className="tl-ex-filters" role="search" aria-label="Search and filter events" onSubmit={(e) => { e.preventDefault(); setFilter('search', searchText.trim()); }}>
            <label className="tl-ex-search">
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="sr-only">Search events</span>
              <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search events, venues, cities" />
            </label>
            <label className="tl-ex-select">
              <span>When</span>
              <select value={filters.when} onChange={(e) => setFilter('when', e.target.value)}>
                {WHEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="tl-ex-select">
              <span>City</span>
              <select value={filters.city} onChange={(e) => setFilter('city', e.target.value)}>
                <option value="">All cities</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="tl-ex-select">
              <span>Price</span>
              <select value={filters.maxPrice} onChange={(e) => setFilter('maxPrice', e.target.value)}>
                {PRICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="tl-ex-select">
              <span>Sort</span>
              <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </form>

          <div className="tl-ex-status">
            <p aria-live="polite">
              {status === 'loading' ? 'Loading events…' : status === 'error' ? '' : `${sorted.length} event${sorted.length === 1 ? '' : 's'}`}
            </p>
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" className="tl-ex-chip" onClick={() => (chip.key === 'search' ? (setSearchText(''), setFilter('search', '')) : setFilter(chip.key, ''))} aria-label={`Remove filter ${chip.label}`}>
                {chip.label} <X className="w-3 h-3" aria-hidden="true" />
              </button>
            ))}
            {hasFilters && (
              <button type="button" className="tl-ex-clear" onClick={clearFilters}>Clear filters</button>
            )}
          </div>

          {status === 'loading' && events.length === 0 && (
            <div className="tl-ex-grid" aria-busy="true" aria-label="Loading events">
              {Array.from({ length: BATCH }, (_, i) => (
                <div key={i} className="tl-tile tl-tile--skeleton" aria-hidden="true">
                  <div className="tl-tile-media" />
                  <div className="tl-tile-caption"><span /><span /></div>
                </div>
              ))}
            </div>
          )}

          {status === 'error' && (
            <div className="tl-ex-empty" role="alert">
              <p>We couldn’t load events right now.</p>
              <button type="button" className="tl-ex-btn" onClick={load}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again</button>
            </div>
          )}

          {status === 'ready' && sorted.length === 0 && !leaving && (
            <div className="tl-ex-empty">
              <p>No events match {hasFilters ? 'these filters' : 'right now'}.</p>
              {hasFilters && <button type="button" className="tl-ex-btn" onClick={clearFilters}>Clear filters</button>}
            </div>
          )}

          {sorted.length > 0 && (
            <div key={`${version}|${filters.sort}`} className={`tl-ex-grid${leaving ? ' is-leaving' : ''}`}>
              {shown.map((event, i) => (
                <EventTile
                  key={event.id}
                  event={event}
                  index={i}
                  isFavorite={favorites[event.id]}
                  onToggleFavorite={(id) => setFavorites((f) => ({ ...f, [id]: !f[id] }))}
                  onOpen={rememberPosition}
                  linkState={EXPLORE_LINK_STATE}
                />
              ))}
            </div>
          )}

          {status === 'ready' && sorted.length > 0 && (
            <div className="tl-ex-more">
              {remaining > 0 ? (
                <button type="button" className="tl-ex-btn tl-ex-btn--more" onClick={() => setVisible((v) => v + BATCH)}>
                  Load more <span className="tl-ex-plus" aria-hidden="true" />
                </button>
              ) : (
                <p>{sorted.length > BATCH ? 'You’ve seen every event.' : ''}</p>
              )}
              <p className="tl-ex-progress">Showing {shown.length} of {sorted.length}</p>
            </div>
          )}
        </main>

        <SiteFooter onCategories={focusCategories} />
      </div>
    </div>
  );
}
