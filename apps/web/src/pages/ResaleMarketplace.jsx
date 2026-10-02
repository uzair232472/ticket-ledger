import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useNavigationType } from 'react-router-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Tag,
  Search,
  Filter,
  ArrowDown,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  MapPin,
  Ticket as TicketIcon,
  CreditCard,
  Lock,
  ShoppingBag,
  Wallet,
  Plus,
  X,
} from 'lucide-react';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import { HERO_IMAGE, categoryName } from '../components/home/homeData';
import { getEventVisual } from '../utils/eventMedia';
import { formatEventDate, formatEventTime } from '../utils/eventTime';
import { initResaleMotion } from '../components/resale/resaleMotion';
import { RESALE_CITIES, RESALE_STEPS, RESALE_FAQS } from '../components/resale/resaleContent';
import '../components/home/home.css';
import '../components/resale/resale.css';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;
const SCROLL_KEY = 'tl-resale-scroll';
const HEADER_H = 84;
const hideBroken = (e) => e.currentTarget.classList.add('is-broken');
const rupees = (n) => `Rs. ${Number(n).toLocaleString()}`;

const markupLabel = (pct) => (pct > 0 ? `+${pct}% on face value` : pct < 0 ? `${pct}% below face value` : 'At face value');

export default function ResaleMarketplace() {
  const { user, token, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const requestRef = useRef(0);

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  // Whether the listings on screen were fetched with any filter (the inputs may hold unapplied edits)
  const [filtersApplied, setFiltersApplied] = useState(false);

  // Purchase modal states
  const [selectedListing, setSelectedListing] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(null);
  const [purchaseError, setPurchaseError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('TEST_INSTANT');
  // Synchronous guard: a double click fires twice before `purchasing` re-renders the button as disabled
  const purchasingRef = useRef(false);

  const [openFaq, setOpenFaq] = useState(0);

  // Fetch listings. `overrides` lets Reset fetch with cleared filters before the state update lands.
  // Only the newest request may update the page, so quick filter changes can't show stale results.
  const fetchListings = async (overrides = {}) => {
    const { search = searchQuery, city = selectedCity, maxPrice = maxPriceFilter } = overrides;
    const id = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (city) params.append('city', city);
      if (maxPrice) params.append('maxPrice', maxPrice);

      const res = await fetch(`${API_BASE}/resale/market?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch resale tickets');
      if (id === requestRef.current) {
        setListings(data.data?.listings || []);
        setFiltersApplied(Boolean(search || city || maxPrice));
      }
    } catch (err) {
      if (id === requestRef.current) setError(err.message);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchListings();
  }, [selectedCity]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchListings();
  };

  const handleReset = () => {
    setSearchQuery('');
    setMaxPriceFilter('');
    // Changing the city refetches through the effect above; otherwise fetch here with the cleared values
    if (selectedCity) setSelectedCity('');
    else fetchListings({ search: '', city: '', maxPrice: '' });
  };

  const handleBuyTicket = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!selectedListing || purchasingRef.current) return;

    purchasingRef.current = true;
    setPurchasing(true);
    setPurchaseError('');

    try {
      const res = await fetch(`${API_BASE}/resale/buy/${selectedListing.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentMethod }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Secondary ticket purchase failed');
      }

      setPurchaseSuccess(data.data);
      // Refresh listings
      fetchListings();
    } catch (err) {
      setPurchaseError(err.message);
      // The listing may have just sold or been cancelled; show current availability behind the dialog
      fetchListings();
    } finally {
      purchasingRef.current = false;
      setPurchasing(false);
    }
  };

  const openPurchase = (item) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setSelectedListing(item);
    setPurchaseSuccess(null);
    setPurchaseError('');
  };

  /* ---------- Scroll scenes (created once per mount, fully reverted on unmount) ---------- */
  useLayoutEffect(() => {
    const mm = initResaleMotion(rootRef.current);
    return () => mm.revert();
  }, []);

  // A fresh visit starts at the top. Back/forward (and reload) return to the previous position once the
  // listings have loaded and the scenes are measured, so the page never lands mid-scene at the wrong spot.
  const pendingRestoreRef = useRef(null);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const saved = Number(sessionStorage.getItem(SCROLL_KEY));
    const reload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
    if ((navigationType === 'POP' || reload) && saved > 0) pendingRestoreRef.current = saved;
    else window.scrollTo({ top: 0, behavior: 'instant' });
    const save = () => sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Loaded cards change the page height, so the pinned scenes below them must be re-measured
  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => {
      ScrollTrigger.refresh();
      if (pendingRestoreRef.current != null) {
        window.scrollTo({ top: pendingRestoreRef.current, behavior: 'instant' });
        pendingRestoreRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, listings.length, error]);

  const scrollToListings = useCallback(() => {
    const el = document.getElementById('listings');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: reduce ? 'instant' : 'smooth' });
    el.focus({ preventScroll: true });
  }, []);

  const lowestPrice = useMemo(
    () => (listings.length ? Math.min(...listings.map((l) => Number(l.resalePrice))) : null),
    [listings]
  );

  return (
    <div ref={rootRef} className="tl-home tl-resale">
      {/* Categories live on Explore Events, so the menu's Categories item goes there */}
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} />

      <div ref={pageRef}>
        {/* ---------- 1. Hero ---------- */}
        <section className="tl-rs-hero-track" aria-labelledby="tl-rs-title">
          <div className="tl-rs-hero-stage">
            <div className="tl-rs-hero-media" aria-hidden="true">
              <img src={HERO_IMAGE.src} srcSet={HERO_IMAGE.srcSet} sizes="100vw" alt="" fetchpriority="high" onError={hideBroken} />
              <div className="tl-rs-hero-shade" />
              <div className="tl-rs-hero-dim" />
            </div>

            <span className="tl-rs-cta-ghost" aria-hidden="true">Resell</span>

            <div className="tl-rs-hero-content">
              <div className="tl-rs-hero-title">
                <p className="tl-eyebrow">Fan resale · Can’t make it?</p>
                <h1 id="tl-rs-title" className="tl-rs-cta-title">
                  <span className="tl-rs-cta-line">List your ticket</span>
                  <span className="tl-rs-cta-line">at a fair price<span className="tl-rs-accent">.</span></span>
                </h1>
                <p className="tl-rs-hero-sub">Fan-to-fan tickets, capped at 110% of face value.</p>
                <div className="tl-hero-actions tl-rs-hero-actions">
                  <Link to="/wallet" className="tl-btn tl-btn--green">
                    List a ticket <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                  <button type="button" className="tl-btn tl-btn--ghost" onClick={scrollToListings}>
                    Browse tickets <ArrowDown className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <Link to="/my-nfts" className="tl-rs-textlink tl-rs-textlink--light">
                    Manage my listings <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div className="tl-rs-hero-stat">
                {loading && listings.length === 0 ? (
                  <span className="tl-rs-hero-stat-label">Checking listings…</span>
                ) : error ? (
                  <span className="tl-rs-hero-stat-label">Listings unavailable right now</span>
                ) : (
                  <>
                    <strong>{listings.length}</strong>
                    <span className="tl-rs-hero-stat-label">
                      {listings.length === 1 ? 'ticket' : 'tickets'} listed{filtersApplied ? ' for your filters' : ' now'}
                      {lowestPrice != null && <> · from {rupees(lowestPrice)}</>}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="tl-rs-hero-progress" aria-hidden="true" />
            <div className="tl-cover-shade" aria-hidden="true" />
          </div>
        </section>

        {/* ---------- 2. Live listings ---------- */}
        <section id="listings" className="tl-rs-market" tabIndex={-1} aria-labelledby="tl-rs-market-title">
          <div className="tl-rs-market-head">
            <div>
              <p className="tl-eyebrow">On sale now</p>
              <h2 id="tl-rs-market-title" className="tl-section-title">Tickets from fans</h2>
            </div>
            <p className="tl-rs-market-note">
              Every price is capped at 110% of face value. Listings disappear as soon as they sell or the seller takes them down.
            </p>
          </div>

          <form className="tl-filter-bar tl-rs-filters" onSubmit={handleSearchSubmit} role="search" aria-label="Filter resale tickets">
            <label className="tl-pill tl-pill--wide">
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="tl-pill-text">
                <span className="tl-pill-label">search</span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="event, team, artist or venue"
                />
              </span>
            </label>
            <label className="tl-pill">
              <MapPin className="w-4 h-4" aria-hidden="true" />
              <span className="tl-pill-text">
                <span className="tl-pill-label">where</span>
                <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
                  <option value="">all of Pakistan</option>
                  {RESALE_CITIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </span>
            </label>
            <label className="tl-pill">
              <Wallet className="w-4 h-4" aria-hidden="true" />
              <span className="tl-pill-text">
                <span className="tl-pill-label">max price (PKR)</span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={maxPriceFilter}
                  onChange={(e) => setMaxPriceFilter(e.target.value)}
                  placeholder="any"
                />
              </span>
            </label>
            <div className="tl-rs-filter-actions">
              <button type="submit" className="tl-pill tl-pill--action">
                <Filter className="w-4 h-4" aria-hidden="true" /> Apply
              </button>
              <button type="button" className="tl-rs-reset" onClick={handleReset}>
                Reset
              </button>
            </div>
          </form>

          <p className="tl-rs-count" aria-live="polite">
            {loading ? 'Loading resale tickets…' : error ? '' : `${listings.length} ${listings.length === 1 ? 'ticket' : 'tickets'} available`}
          </p>

          {error && (
            <div className="tl-rs-alert" role="alert">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
              <button type="button" className="tl-rs-alert-retry" onClick={() => fetchListings()}>Try again</button>
            </div>
          )}

          {loading && listings.length === 0 ? (
            <div className="tl-rs-grid" aria-busy="true" aria-label="Loading resale tickets">
              {[0, 1, 2].map((i) => (
                <div key={i} className="tl-card" aria-hidden="true">
                  <div className="tl-card-media tl-skeleton" />
                  <div className="tl-card-body"><div className="tl-skeleton" style={{ height: 180, borderRadius: 6 }} /></div>
                </div>
              ))}
            </div>
          ) : !error && listings.length === 0 ? (
            <div className="tl-rs-empty">
              <Tag className="w-7 h-7" aria-hidden="true" />
              <h3>No resale tickets {filtersApplied ? 'match these filters' : 'available right now'}</h3>
              <p>Check back later, or find tickets from the box office.</p>
              <div className="tl-rs-empty-actions">
                <Link to="/events" className="tl-btn tl-btn--green">Browse all events</Link>
                <Link to="/wallet" className="tl-btn tl-btn--ghost">List a ticket</Link>
              </div>
            </div>
          ) : listings.length > 0 ? (
            <div className={`tl-rs-grid${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
              {listings.map((item, i) => {
                const { event, seat, seller } = item;
                const isOwner = user?.id === seller?.id;
                const visual = getEventVisual(event, i);

                return (
                  <article key={item.id} className="tl-card tl-rs-card">
                    <div className="tl-card-media">
                      <img src={visual.image} alt="" loading="lazy" decoding="async" onError={hideBroken} />
                      <span className="tl-card-type">{categoryName(event?.type)}</span>
                      <span className="tl-rs-badge tl-rs-badge--cap">
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Within 110% cap
                      </span>
                    </div>

                    <div className="tl-card-body">
                      <h3 className="tl-card-title">{event?.name}</h3>
                      <p className="tl-card-meta">
                        <CalendarDays className="w-4 h-4" aria-hidden="true" />
                        <span>{event?.date ? formatEventDate(event.date) : 'Date TBA'}{event?.time ? ` · ${formatEventTime(event.time)}` : ''}</span>
                      </p>
                      <p className="tl-card-meta">
                        <MapPin className="w-4 h-4" aria-hidden="true" />
                        <span>{[event?.venue, event?.city].filter(Boolean).join(', ')}</span>
                      </p>

                      <div className="tl-rs-card-details">
                      <dl className="tl-rs-seat">
                        <div><dt>Tier</dt><dd>{seat?.tierName || 'Standard'}</dd></div>
                        <div><dt>Row</dt><dd>{seat?.row || 'GA'}</dd></div>
                        <div><dt>Seat</dt><dd>#{seat?.seatNumber}</dd></div>
                      </dl>

                      <dl className="tl-rs-price">
                        <div className="tl-rs-price-main">
                          <dt>Resale price</dt>
                          <dd>{rupees(item.resalePrice)}</dd>
                        </div>
                        <div><dt>Face value</dt><dd>{rupees(item.originalPrice)}</dd></div>
                        <div><dt>110% ceiling</dt><dd>{rupees(item.maxAllowedCeiling)}</dd></div>
                        <div><dt>Markup</dt><dd>{markupLabel(item.markupPercent)}</dd></div>
                      </dl>
                      </div>

                      <div className="tl-card-foot tl-rs-card-foot">
                        <p className="tl-rs-seller">
                          Sold by <strong>{seller?.name || 'Verified Fan'}</strong>
                        </p>
                        {isOwner ? (
                          <div className="tl-rs-own">
                            <span>Your active listing</span>
                            <Link to="/my-nfts" className="tl-rs-textlink">Manage <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
                          </div>
                        ) : (
                          <button type="button" className="tl-btn tl-btn--green tl-rs-buy" onClick={() => openPurchase(item)}>
                            <ShoppingBag className="w-4 h-4" aria-hidden="true" /> Buy for {rupees(item.resalePrice)}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
          <div className="tl-cover-shade" aria-hidden="true" />
        </section>

        {/* ---------- 3. How resale works (pinned on large screens) ---------- */}
        <section className="tl-rs-steps-track" aria-labelledby="tl-rs-steps-title" data-header-light>
          <div className="tl-rs-steps">
            <header className="tl-rs-steps-head">
              <p className="tl-eyebrow tl-rs-kicker">How resale works</p>
              <h2 id="tl-rs-steps-title" className="tl-rs-display">
                <span>List it fairly,</span>
                <span>buy it safely,</span>
                <span>walk in with a new QR.</span>
              </h2>
              <div className="tl-rs-steps-rail" aria-hidden="true"><span className="tl-rs-steps-fill" /></div>
            </header>

            <ol className="tl-rs-steps-list">
              {RESALE_STEPS.map((step, i) => (
                <li key={step.title} className="tl-rs-step">
                  <span className="tl-rs-step-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div className="tl-rs-step-title">
                    <p className="tl-rs-kicker">Step {i + 1}</p>
                    <h3>{step.title}</h3>
                  </div>
                  <div className="tl-rs-step-copy">
                    <p>{step.copy}</p>
                    {step.link && (
                      <Link to={step.link.to} className="tl-rs-textlink">
                        {step.link.label} <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="tl-cover-shade" aria-hidden="true" />
          </div>
        </section>

        {/* ---------- 4. FAQs ---------- */}
        <section className="tl-rs-faq" aria-labelledby="tl-rs-faq-title" data-header-light>
          <div className="tl-rs-faq-head">
            <p className="tl-rs-kicker">Resale rules</p>
            <h2 id="tl-rs-faq-title" className="tl-rs-display"><span>Resale</span><span>FAQs</span></h2>
          </div>
          <div className="tl-rs-faq-list">
            {RESALE_FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className={`tl-rs-faq-item${open ? ' is-open' : ''}`}>
                  <h3>
                    <button
                      type="button"
                      id={`tl-rs-faq-q${i}`}
                      aria-expanded={open}
                      aria-controls={`tl-rs-faq-a${i}`}
                      onClick={() => setOpenFaq(open ? -1 : i)}
                    >
                      <span className="tl-rs-faq-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="tl-rs-faq-q">{item.q}</span>
                      <Plus className="tl-rs-faq-icon w-4 h-4" aria-hidden="true" />
                    </button>
                  </h3>
                  <div id={`tl-rs-faq-a${i}`} role="region" aria-labelledby={`tl-rs-faq-q${i}`} className="tl-rs-faq-a" inert={open ? undefined : ''}>
                    <div><p>{item.a}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="tl-cover-shade" aria-hidden="true" />
        </section>

        {/* ---------- 5. Waitlist band ---------- */}
        <section className="tl-rs-band" aria-labelledby="tl-rs-band-title" data-header-light>
          <div className="tl-rs-band-inner">
            <div>
              <p className="tl-rs-kicker tl-rs-kicker--ink">Sold out?</p>
              <h2 id="tl-rs-band-title" className="tl-rs-band-title">
                <span>Be first</span>
                <span>to know.</span>
              </h2>
              <p className="tl-rs-band-text">
                Join the waitlist on a sold-out event’s page. When a fan lists a ticket for that event, you get a notification.
              </p>
            </div>
            <div className="tl-rs-band-card">
              <TicketIcon className="w-6 h-6" aria-hidden="true" />
              <p><strong>Waitlist alerts.</strong> Delivered to your TicketLedger notifications.</p>
              <Link to="/events" className="tl-btn tl-btn--dark">
                Find an event <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
          <ul className="tl-rs-band-ticker" aria-label="How resale alerts work">
            <li>Join a waitlist</li>
            <li>Fan lists a ticket</li>
            <li>You get notified</li>
            <li>Buy within the cap</li>
          </ul>
          <div className="tl-cover-shade" aria-hidden="true" />
        </section>

        <SiteFooter />
      </div>

      {selectedListing && (
        <PurchaseDialog
          listing={selectedListing}
          purchasing={purchasing}
          purchaseSuccess={purchaseSuccess}
          purchaseError={purchaseError}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          onConfirm={handleBuyTicket}
          onClose={() => setSelectedListing(null)}
        />
      )}
    </div>
  );
}

const PAYMENT_OPTIONS = [
  { value: 'TEST_INSTANT', label: '1-Click Test', icon: <CreditCard className="w-4 h-4" aria-hidden="true" /> },
  { value: 'JAZZCASH', label: 'JazzCash', icon: <span className="tl-rs-pay-mark">JC</span> },
  { value: 'EASYPAISA', label: 'EasyPaisa', icon: <span className="tl-rs-pay-mark">EP</span> },
];

/**
 * Purchase confirmation. Locks page scroll on <body> (the same lock the header menu uses, so sticky scenes
 * stay in place), traps focus, closes on Escape unless a purchase is in flight, and returns focus on close.
 */
function PurchaseDialog({ listing, purchasing, purchaseSuccess, purchaseError, paymentMethod, setPaymentMethod, onConfirm, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const returnTo = document.activeElement;
    const body = document.body;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    dialogRef.current?.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      returnTo?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !purchasing) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [purchasing, onClose]);

  const seatLine = `${listing.seat?.tierName} · Row ${listing.seat?.row} · Seat #${listing.seat?.seatNumber}`;

  return (
    <div className="tl-rs-modal" onMouseDown={(e) => e.target === e.currentTarget && !purchasing && onClose()}>
      <div ref={dialogRef} className="tl-rs-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-rs-dialog-title">
        <div className="tl-rs-dialog-head">
          <div>
            <p className="tl-eyebrow"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Fan resale purchase</p>
            <h2 id="tl-rs-dialog-title">{purchaseSuccess ? 'Ticket transferred' : 'Confirm ticket transfer'}</h2>
          </div>
          <button type="button" className="tl-rs-close" onClick={onClose} disabled={purchasing} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {purchaseSuccess ? (
          <div className="tl-rs-dialog-body">
            <div className="tl-rs-success">
              <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
              <p>
                The ticket is now in your account. The seller’s QR code has been revoked and a new rotating QR has been issued to you.
              </p>
            </div>
            <dl className="tl-rs-summary">
              <div><dt>Event</dt><dd>{purchaseSuccess.ticket?.event?.name || listing.event.name}</dd></div>
              <div><dt>Seat</dt><dd>{seatLine}</dd></div>
              <div><dt>Paid</dt><dd>{rupees(listing.resalePrice)}</dd></div>
              <div><dt>New QR nonce</dt><dd className="tl-rs-mono">{purchaseSuccess.ticket?.qrNonce}</dd></div>
            </dl>
            <div className="tl-rs-dialog-actions">
              <Link to="/wallet" className="tl-btn tl-btn--green" data-autofocus>
                View my tickets <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <button type="button" className="tl-btn tl-btn--ghost" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="tl-rs-dialog-body">
            <div className="tl-rs-summary-head">
              <strong>{listing.event.name}</strong>
              <span><MapPin className="w-3.5 h-3.5" aria-hidden="true" /> {listing.event.venue}, {listing.event.city}</span>
              <span>{seatLine}</span>
            </div>

            <dl className="tl-rs-summary">
              <div><dt>Face value</dt><dd>{rupees(listing.originalPrice)}</dd></div>
              <div><dt>Resale price</dt><dd>{rupees(listing.resalePrice)}</dd></div>
              <div><dt>Markup</dt><dd>{listing.markupPercent > 0 ? '+' : ''}{listing.markupPercent}% (capped at +10%)</dd></div>
              <div className="tl-rs-summary-total"><dt>Total due</dt><dd>{rupees(listing.resalePrice)}</dd></div>
            </dl>

            <fieldset className="tl-rs-pay">
              <legend>Payment method</legend>
              <div className="tl-rs-pay-grid">
                {PAYMENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={paymentMethod === opt.value}
                    className="tl-rs-pay-opt"
                    onClick={() => setPaymentMethod(opt.value)}
                    disabled={purchasing}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {purchaseError && (
              <div className="tl-rs-alert" role="alert">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{purchaseError}</span>
              </div>
            )}

            <button type="button" disabled={purchasing} onClick={onConfirm} className="tl-btn tl-btn--green tl-rs-confirm" data-autofocus>
              {purchasing ? (
                <>
                  <span className="tl-rs-spinner" aria-hidden="true" />
                  <span>Processing transfer…</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span>Confirm &amp; buy · {rupees(listing.resalePrice)}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
