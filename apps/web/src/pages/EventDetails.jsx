import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EventExtrasTop, EventPolicies, SalesWindowNote, useEventExtras } from '../components/event-detail/EventExtras';
import { Link, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';
import { ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, Check, Clock, LayoutGrid, MapPin, Music, RefreshCw, Share2, Sparkles, Tag, Ticket, Trophy, Users } from 'lucide-react';
import { useDialog } from '../components/ui/DialogProvider';
import { googleMapsUrl } from '../utils/maps';
import api, { trackClientBehavior } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getEventVisual, resolveMediaUrl } from '../utils/eventMedia';
import { EVENT_TIMEZONE_LABEL, eventDayEnd, formatEventDate, formatEventTime } from '../utils/eventTime';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import EventGallery, { GalleryLightbox, PhotoSlideshow, useEventPhotos } from '../components/event-detail/EventGallery';
import ContactOrganizer from '../components/event-detail/ContactOrganizer';
import { categoryName } from '../components/home/homeData';
import markUrl from '../assets/ticketledger-mark.svg';
import '../components/home/home.css';
import '../components/events/events.css';
import '../components/event-detail/detail.css';
import RecommendedEvents from '../components/ml/RecommendedEvents';

gsap.registerPlugin(ScrollTrigger, CustomEase);
// The reference's "verticalEase" (same curve as its Explore transitions)
const VERTICAL_EASE = CustomEase.create('tlVertical', '0.625,0.05,0,1');

const RETURN_KEY = 'tl-explore-return'; // written by Explore when a tile is opened
const LOW_AVAILABILITY = 50;
const LOADER_MS = 1400; // App-wide PixelLoader duration; content rises as it clears
const RELATED_COUNT = 3;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const formatPkr = (value) => `PKR ${Number(value).toLocaleString('en-PK')}`;

/** What a visitor can do with this event right now, from its status, date and the API's tier counts. */
function getSaleState(event) {
  const tiers = event.tiers || [];
  const available = tiers.reduce((n, t) => n + Math.max(0, Number(t.availableQuantity) || 0), 0);
  if (event.status === 'CANCELLED') return { key: 'cancelled', label: 'Cancelled', note: 'This event has been cancelled. Tickets are no longer on sale.' };
  if (event.status === 'COMPLETED' || eventDayEnd(event.date) < Date.now()) return { key: 'ended', label: 'Event ended', note: 'This event has already taken place.' };
  if (event.status === 'PAUSED' && event.postponedAt) return { key: 'paused', label: 'Postponed', note: 'This event is postponed. Tickets go back on sale once the new date is announced.' };
  if (event.status === 'PAUSED') return { key: 'paused', label: 'Sales paused', note: 'The organizer has paused ticket sales. Check back later.' };
  // Organizer / admin preview of an event that isn't approved yet (the API hides these from everyone else)
  const preview = {
    PENDING_APPROVAL: 'Preview · awaiting approval',
    REJECTED: 'Preview · changes requested',
    DRAFT: 'Preview · not submitted',
    PRELAUNCH_ANALYSIS: 'Preview · not submitted',
  }[event.status];
  if (preview) return { key: 'unpublished', label: preview, note: 'Preview: only you and TicketLedger admins can see this page. Tickets go on sale once an admin approves the event.' };
  if (event.status !== 'PUBLISHED') return { key: 'unpublished', label: 'Not on sale yet', note: 'Tickets for this event are not on sale yet.' };
  if (!tiers.length || !event._count?.seats) return { key: 'unavailable', label: 'Tickets coming soon', note: 'Seating for this event has not been released for online booking yet.' };
  if (available === 0) return { key: 'soldout', label: 'Sold out', note: 'Every ticket has been sold.' };
  return { key: 'onsale', label: available <= LOW_AVAILABILITY ? `Only ${available} left` : 'On sale', available };
}

// "PKR 1,500 – 15,000" across every tier (one price when they're all the same)
function getPriceRange(tiers = []) {
  const prices = tiers.map((t) => Number(t.price)).filter((p) => Number.isFinite(p));
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === 0) return 'Free';
  if (min === max) return formatPkr(min);
  return `${min === 0 ? 'Free' : formatPkr(min)} – ${max.toLocaleString('en-PK')}`;
}

const SPORT_TYPES = ['CRICKET_MATCH', 'FOOTBALL_MATCH', 'KABADDI', 'BOXING', 'HOCKEY_MATCH'];
const MUSIC_TYPES = ['MUSIC_CONCERT', 'MUSIC_FESTIVAL', 'QAWWALI'];
const categoryIcon = (type) => (SPORT_TYPES.includes(type) ? Trophy : MUSIC_TYPES.includes(type) ? Music : Sparkles);

// Title in two tones, as the design: the first half of the words white, the rest green
function splitTitle(name = '') {
  const words = name.trim().split(/\s+/);
  const cut = Math.floor(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

const placeOf = (venue = '', city = '') =>
  city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city;

/** "Other Events" card: photo with the date chip, name, place, starting price and an arrow. */
function RelatedCard({ event, index, linkState }) {
  const visual = getEventVisual(event, index);
  const min = event.pricing?.minPrice;
  const price = min == null ? null : Number(min) === 0 ? 'Free' : `From ${formatPkr(min)}`;
  return (
    <Link to={`/events/${event.id}`} state={linkState} className="tl-dt-rcard">
      <img className="tl-dt-rcard-img" src={visual.image} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.classList.add('is-broken')} />
      <span className="tl-dt-rcard-shade" aria-hidden="true" />
      <span className="tl-dt-chip">
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {formatEventDate(event.date)}
      </span>
      <span className="tl-dt-rcard-body">
        <span className="tl-dt-rcard-title">{event.name}</span>
        <span className="tl-dt-rcard-place">
          <MapPin className="w-4 h-4" aria-hidden="true" /> {placeOf(event.venue, event.city)}
        </span>
        {price && <span className="tl-dt-rcard-price">{price}</span>}
      </span>
      <span className="tl-dt-rcard-go" aria-hidden="true"><ArrowRight className="w-4 h-4" /></span>
    </Link>
  );
}

// Same category first, then same city, then soonest; upcoming published events only
function pickRelated(events, current) {
  const now = Date.now();
  const score = (e) => (e.type === current.type ? 2 : 0) + (e.city === current.city ? 1 : 0);
  return events
    .filter((e) => e.id !== current.id && eventDayEnd(e.date) >= now)
    .sort((a, b) => score(b) - score(a) || new Date(a.date) - new Date(b.date))
    .slice(0, RELATED_COUNT);
}

/** Remount per event so every request, timer and animation starts fresh when the ID changes. */
export default function EventDetails() {
  const { id } = useParams();
  return <EventDetailsPage key={id} id={id} />;
}

function Row({ label, id, children }) {
  const headingId = `tl-dt-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section id={id} className="tl-dt-row" aria-labelledby={headingId}>
      <h2 id={headingId} className="tl-dt-label">{label}</h2>
      <div className="tl-dt-content">{children}</div>
    </section>
  );
}

function EventDetailsPage({ id }) {
  const extras = useEventExtras(id);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { isAuthenticated } = useAuth();

  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const mountedAt = useRef(Date.now());

  const [event, setEvent] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  const [attempt, setAttempt] = useState(0);
  const [related, setRelated] = useState([]);
  const [resale, setResale] = useState(null);
  const [waitlist, setWaitlist] = useState({ on: false, count: null, busy: false, message: '' });
  const [tab, setTab] = useState('details'); // details | venue
  const [viewer, setViewer] = useState(null); // index of the photo open in the viewer
  const dialog = useDialog();

  // Back to Explore: step back through history when we came from it (Explore then restores its
  // filters, batch and scroll position); otherwise open it with the last filters used.
  const exploreDepth = Number(location.state?.exploreDepth) || 0;
  const backHref = useMemo(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
      return saved?.query ? `/events?${saved.query}` : '/events';
    } catch {
      return '/events';
    }
  }, []);
  const onBack = (e) => {
    if (exploreDepth > 0) {
      e.preventDefault();
      navigate(-exploreDepth);
    }
  };
  const relatedLinkState = exploreDepth > 0 ? { exploreDepth: exploreDepth + 1 } : undefined;
  const toCategories = useCallback(() => navigate('/events'), [navigate]);

  // A new event page starts at the top (back/forward keeps the browser's position)
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [navigationType]);

  // Event. Responses for a request that is no longer current are ignored.
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    api
      .get(`/events/${id}`)
      .then((res) => {
        if (!alive) return;
        const loaded = res.data?.data?.event;
        if (!loaded) {
          setStatus('notfound');
          return;
        }
        setEvent(loaded);
        setStatus('ready');
        trackClientBehavior('event_view', id, { eventName: loaded.name, category: loaded.type, city: loaded.city });
      })
      .catch((err) => {
        if (alive) setStatus(err.response?.status === 404 ? 'notfound' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const sale = useMemo(() => (event ? getSaleState(event) : null), [event]);

  // Related events (excluding this one)
  useEffect(() => {
    if (!event) return undefined;
    let alive = true;
    api
      .get('/events')
      .then((res) => alive && setRelated(pickRelated(res.data?.data?.events || [], event)))
      .catch(() => alive && setRelated([]));
    return () => {
      alive = false;
    };
  }, [event]);

  // Waitlist and resale only matter once an event is sold out
  const soldOut = sale?.key === 'soldout';
  useEffect(() => {
    if (!soldOut || !isAuthenticated) return undefined;
    let alive = true;
    api
      .get(`/events/${id}/waitlist`)
      .then((res) => alive && setWaitlist((w) => ({ ...w, on: Boolean(res.data?.data?.onWaitlist), count: res.data?.data?.totalWaitlistCount ?? null })))
      .catch(() => { });
    return () => {
      alive = false;
    };
  }, [id, soldOut, isAuthenticated]);
  useEffect(() => {
    if (!soldOut) return undefined;
    let alive = true;
    api
      .get(`/resale/market?eventId=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!alive) return;
        const listings = res.data?.data?.listings || [];
        setResale(listings.length ? { count: listings.length, from: Math.min(...listings.map((l) => Number(l.resalePrice))) } : null);
      })
      .catch(() => alive && setResale(null));
    return () => {
      alive = false;
    };
  }, [id, soldOut]);

  const joinWaitlist = async () => {
    if (waitlist.busy || waitlist.on) return; // no duplicate submissions
    setWaitlist((w) => ({ ...w, busy: true, message: '' }));
    try {
      const res = await api.post(`/events/${id}/waitlist`);
      setWaitlist({ on: true, busy: false, count: res.data?.data?.totalWaitlistCount ?? null, message: 'You’re on the waitlist. We’ll notify you when a resale ticket is listed.' });
    } catch (err) {
      setWaitlist((w) => ({ ...w, busy: false, message: err.response?.data?.message || 'Could not join the waitlist. Please try again.' }));
    }
  };

  // Tab title
  useEffect(() => {
    if (!event) return undefined;
    const previous = document.title;
    document.title = `${event.name} · TicketLedger`;
    return () => {
      document.title = previous;
    };
  }, [event]);

  // Footer: the header logo steps aside and the footer lettering rises in (as on Explore)
  useLayoutEffect(() => {
    const root = rootRef.current;
    const header = root.querySelector('[data-home-header]');
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: '.tl-footer',
        start: 'top 80px',
        onToggle: (self) => {
          header.dataset.atFooter = String(self.isActive);
        },
      });
      if (!reducedMotion()) {
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

  // Page entrance (content rises as the loader clears) and the hero image parallax
  useLayoutEffect(() => {
    if (status !== 'ready') return undefined;
    const ctx = gsap.context(() => {
      if (!reducedMotion()) {
        const delay = Math.max(0, mountedAt.current + LOADER_MS - 450 - Date.now()) / 1000;
        gsap.from('.tl-dt-main', { y: 56, duration: 1.2, delay, ease: VERTICAL_EASE, clearProps: 'transform', onComplete: () => ScrollTrigger.refresh() });
      }
      // Desktop only, like the reference: the photo drifts down at half the scroll speed
      gsap.matchMedia().add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        gsap.to('.tl-dt-hero-img', { yPercent: 50, ease: 'none', scrollTrigger: { trigger: '.tl-dt-hero', start: 'top top', end: 'bottom top', scrub: true } });
      });
    }, rootRef);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [status]);

  // Related tiles wipe up from the bottom in sequence when the grid enters view
  useLayoutEffect(() => {
    if (!related.length || reducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.tl-dt-related-item',
        { clipPath: 'inset(100% 0% 0% 0%)' },
        {
          clipPath: 'inset(0% 0% 0% 0%)',
          duration: 1.2,
          ease: VERTICAL_EASE,
          stagger: 0.1,
          scrollTrigger: { trigger: '.tl-dt-related-grid', start: 'top 85%', toggleActions: 'play none none reverse' },
        }
      );
    }, rootRef);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [related]);

  useEffect(() => {
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }, [resale, waitlist.on]);

  const visual = event ? getEventVisual(event, 0) : null;
  const heroImage = visual?.bannerImage?.includes('images.unsplash.com') ? visual.bannerImage.replace(/w=\d+/, 'w=2000') : visual?.bannerImage;
  const priceRange = event ? getPriceRange(event.tiers) : null;
  const photos = useEventPhotos(event, heroImage);
  // Organizer's details-card photo (3:2), else the first gallery photo, else the banner
  const detailsPhoto = resolveMediaUrl(event?.galleryWideUrl) || photos[0] || heroImage;
  // Details card slideshow: the details photo first, then the gallery photos (no repeats)
  const slides = useMemo(() => [...new Set([detailsPhoto, ...photos].filter(Boolean))], [detailsPhoto, photos]);
  const [titleLead, titleAccent] = splitTitle(event?.name);
  const CategoryIcon = categoryIcon(event?.type);
  const closeViewer = useCallback(() => setViewer(null), []);
  const tabs = [
    { key: 'details', label: 'Event Details', Icon: Tag },
    { key: 'venue', label: 'Venue Info', Icon: Building2 },
  ];
  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tab === 'details' ? 'venue' : 'details';
    setTab(next);
    document.getElementById(`tl-dt-tab-${next}`)?.focus();
  };
  const time = event ? formatEventTime(event.time) : '';
  const organizer = event?.company?.companyName;
  const description = event?.description?.trim();
  const venueHasCity = event && event.city && event.venue?.toLowerCase().includes(event.city.toLowerCase());
  const loginState = { from: location.pathname };

  // Share: the device's share sheet where available, otherwise copy the link
  const shareEvent = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: event?.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      dialog.alert({ tone: 'success', title: 'Link copied', message: 'The event link is on your clipboard, ready to share.' });
    } catch (err) {
      if (err?.name !== 'AbortError') dialog.alert({ tone: 'info', title: 'Share this event', message: url });
    }
  };

  const backLink = (
    <div className="tl-dt-topbar">
      <Link to={backHref} onClick={onBack} className="tl-dt-back">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Explore events
      </Link>
      <button type="button" className="tl-dt-share" onClick={shareEvent} aria-label="Share this event">
        <Share2 className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );

  const bookingAction = (where) => {
    if (sale.key === 'onsale') {
      return (
        <Link to={`/events/${event.id}/seats`} className="tl-dt-cta" data-cta={where}>
          Choose seats <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      );
    }
    if (sale.key === 'soldout') {
      return (
        <a href="#waitlist" className="tl-dt-cta tl-dt-cta--ghost" data-cta={where}>
          Join the waitlist <Bell className="w-4 h-4" aria-hidden="true" />
        </a>
      );
    }
    return null;
  };

  return (
    <div ref={rootRef} className="tl-home tl-detail">
      {/* The page-entry loader plays from App (every navigation) */}
      <HomeHeader pageRef={pageRef} onCategories={toCategories} tone="dark" />

      <div ref={pageRef}>
        <main className="tl-dt-main">
          {status === 'loading' && (
            <div className="tl-dt-hero tl-dt-hero--skeleton" aria-busy="true">
              <p className="tl-dt-sr" role="status">Loading event…</p>
            </div>
          )}

          {(status === 'notfound' || status === 'error') && (
            <div className="tl-dt-message">
              {backLink}
              <h1 className="tl-dt-message-title">{status === 'notfound' ? 'Event not found' : 'We couldn’t load this event'}</h1>
              <p>{status === 'notfound' ? 'This event doesn’t exist or is no longer listed.' : 'Check your connection and try again.'}</p>
              {status === 'error' && (
                <button type="button" className="tl-dt-cta" onClick={() => setAttempt((a) => a + 1)}>
                  Try again <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {status === 'ready' && (
            <>
              <section className="tl-dt-hero" aria-labelledby="tl-dt-title">
                <div className="tl-dt-hero-media">
                  <img
                    className="tl-dt-hero-img"
                    src={heroImage}
                    alt=""
                    fetchpriority="high"
                    decoding="async"
                    onError={(e) => e.currentTarget.parentElement.classList.add('is-broken')}
                  />
                  <span className="tl-dt-hero-fallback" aria-hidden="true" style={{ backgroundImage: `url(${markUrl})` }} />
                </div>
                <div className="tl-dt-hero-shade" aria-hidden="true" />
                <div className="tl-dt-hero-top">{backLink}</div>

                <div className="tl-dt-hero-inner">
                  <p className="tl-dt-badge">
                    <CategoryIcon className="w-4 h-4" aria-hidden="true" /> {categoryName(event.type, event.categoryLabel)}
                  </p>
                  <h1 id="tl-dt-title" className="tl-dt-title">
                    {titleLead && <span className="tl-dt-title-lead">{titleLead}</span>}
                    <span className="tl-dt-title-accent">{titleAccent}</span>
                  </h1>
                  <ul className="tl-dt-meta">
                    <li><MapPin className="w-5 h-5" aria-hidden="true" /> {placeOf(event.venue, event.city)}</li>
                    <li>
                      <CalendarDays className="w-5 h-5" aria-hidden="true" />
                      <time dateTime={new Date(event.date).toISOString().slice(0, 10)}>{formatEventDate(event.date)}</time>
                      {time && <> – {time}</>}
                    </li>
                    <li className={`tl-dt-meta-status is-${sale.key}`}><Clock className="w-5 h-5" aria-hidden="true" /> {sale.label}</li>
                  </ul>
                </div>
              </section>

              {/* Photo + tabbed details card */}
              <section className="tl-dt-overview" aria-label="Event overview">
                <div className="tl-dt-ov-media">
                  <PhotoSlideshow photos={slides} />
                </div>

                <div className="tl-dt-ov-panel">
                  <div className="tl-dt-tabs" role="tablist" aria-label="Event information">
                    {tabs.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        id={`tl-dt-tab-${key}`}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        aria-controls={`tl-dt-panel-${key}`}
                        tabIndex={tab === key ? 0 : -1}
                        className={`tl-dt-tab${tab === key ? ' is-active' : ''}`}
                        onClick={() => setTab(key)}
                        onKeyDown={onTabKey}
                      >
                        <Icon className="w-4 h-4" aria-hidden="true" /> {label}
                      </button>
                    ))}
                  </div>

                  {tab === 'details' ? (
                    <div id="tl-dt-panel-details" role="tabpanel" aria-labelledby="tl-dt-tab-details" className="tl-dt-tabpanel">
                      <dl className="tl-dt-info">
                        {priceRange && (
                          <div>
                            <dt><Ticket className="w-5 h-5" aria-hidden="true" /> Ticket Price Range</dt>
                            <dd className="tl-dt-info-price">{priceRange}</dd>
                          </div>
                        )}
                        <div>
                          <dt><LayoutGrid className="w-5 h-5" aria-hidden="true" /> Event Category</dt>
                          <dd>{categoryName(event.type, event.categoryLabel)}</dd>
                        </div>
                        <div>
                          <dt><CalendarDays className="w-5 h-5" aria-hidden="true" /> Date &amp; Time</dt>
                          <dd>
                            {formatEventDate(event.date)}{time && <> • {time}</>}
                            {event.lastScheduleChange && !event.lastScheduleChange.minor && (
                              <s className="tl-dt-was">Was {formatEventDate(event.lastScheduleChange.oldDate)}{event.lastScheduleChange.oldVenue !== event.venue ? ` at ${event.lastScheduleChange.oldVenue}` : ''}</s>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt><MapPin className="w-5 h-5" aria-hidden="true" /> Venue</dt>
                          <dd>{placeOf(event.venue, event.city)}</dd>
                        </div>
                      </dl>
                      {description && (
                        <>
                          <h2 className="tl-dt-subhead">About the Event</h2>
                          <p className="tl-dt-about">{description}</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div id="tl-dt-panel-venue" role="tabpanel" aria-labelledby="tl-dt-tab-venue" className="tl-dt-tabpanel">
                      <dl className="tl-dt-info">
                        <div>
                          <dt><Building2 className="w-5 h-5" aria-hidden="true" /> Venue</dt>
                          <dd>
                            <a className="tl-dt-maplink" href={googleMapsUrl(event)} target="_blank" rel="noreferrer" title="Open in Google Maps">
                              <span>{event.venue}</span>
                              <span className="tl-dt-sr"> (opens in Google Maps)</span>
                            </a>
                          </dd>
                        </div>
                        {event.locationAddress && (
                          <div>
                            <dt><MapPin className="w-5 h-5" aria-hidden="true" /> Address</dt>
                            <dd>{event.locationAddress}</dd>
                          </div>
                        )}
                        {event.city && (
                          <div>
                            <dt><MapPin className="w-5 h-5" aria-hidden="true" /> City</dt>
                            <dd>{event.city}</dd>
                          </div>
                        )}
                        <div>
                          <dt><Clock className="w-5 h-5" aria-hidden="true" /> Time zone</dt>
                          <dd>{EVENT_TIMEZONE_LABEL}</dd>
                        </div>
                        {organizer && (
                          <div>
                            <dt><Users className="w-5 h-5" aria-hidden="true" /> Organizer</dt>
                            <dd>{organizer}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="tl-dt-venue-actions">
                        <a className="tl-dt-cta tl-dt-cta--ghost" href={googleMapsUrl(event)} target="_blank" rel="noreferrer">
                          Open in Google Maps <ArrowRight className="w-4 h-4" aria-hidden="true" />
                        </a>
                        <ContactOrganizer email={event.organizerContactEmail} eventName={event.name} organizer={organizer} />
                      </div>
                    </div>
                  )}

                  {/* Cancelled, postponed or moved: what ticket holders can do */}
                  {(event.status === 'CANCELLED' || event.postponedAt || (event.refundWindowEndsAt && new Date(event.refundWindowEndsAt) > new Date())) && (
                    <div className={`tl-dt-change${event.status === 'CANCELLED' ? ' is-bad' : ''}`} role="status">
                      <strong>
                        {event.status === 'CANCELLED' ? 'This event is cancelled' : event.postponedAt ? 'This event is postponed' : 'This event has a new date'}
                      </strong>
                      <p>
                        {event.status === 'CANCELLED'
                          ? `${event.cancelReason ? `${event.cancelReason} ` : ''}Every ticket is refunded in full automatically.`
                          : event.postponedAt
                            ? `${event.postponeReason ? `${event.postponeReason} ` : ''}Tickets stay valid for the new date. Ticket holders can get a refund until it’s announced.`
                            : `${event.lastScheduleChange?.reason ? `${event.lastScheduleChange.reason} ` : ''}Tickets stay valid. Ticket holders who can’t make it can get a full refund until ${new Date(event.refundWindowEndsAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })}.`}
                      </p>
                      <Link to={`/events/${event.id}/refund`}>Have tickets? See your options</Link>
                    </div>
                  )}

                  <div className="tl-dt-ov-book">
                    <SalesWindowNote extras={extras} />
                    {bookingAction('card') || <p className="tl-dt-book-note">{sale.note}</p>}
                  </div>
                </div>
              </section>

              <div className="tl-dt-body">
                <EventExtrasTop extras={extras} />
                {soldOut && (
                  <Row label="Waitlist" id="waitlist">
                    <p className="tl-dt-desc tl-dt-desc--small">
                      Join the waitlist to be notified as soon as a ticket for this event is listed on the fan resale marketplace.
                      {waitlist.count != null && waitlist.count > 0 && ` ${waitlist.count.toLocaleString('en-PK')} ${waitlist.count === 1 ? 'person is' : 'people are'} waiting.`}
                    </p>
                    {isAuthenticated ? (
                      <button type="button" className={`tl-dt-cta${waitlist.on ? ' tl-dt-cta--done' : ''}`} onClick={joinWaitlist} disabled={waitlist.busy || waitlist.on} aria-disabled={waitlist.busy || waitlist.on}>
                        {waitlist.on ? <>On the waitlist <Check className="w-4 h-4" aria-hidden="true" /></> : waitlist.busy ? 'Joining…' : <>Join the waitlist <Bell className="w-4 h-4" aria-hidden="true" /></>}
                      </button>
                    ) : (
                      <Link to="/login" state={loginState} className="tl-dt-cta">
                        Sign in to join <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                    <p className="tl-dt-muted" role="status" aria-live="polite">{waitlist.message}</p>
                  </Row>
                )}

                {soldOut && resale && (
                  <Row label="Resale">
                    <p className="tl-dt-desc tl-dt-desc--small">
                      {resale.count} {resale.count === 1 ? 'ticket is' : 'tickets are'} listed by fans from {formatPkr(resale.from)}. Resale prices are capped at 110% of face value.
                    </p>
                    <Link to="/resale" className="tl-dt-cta tl-dt-cta--ghost">
                      View resale tickets <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </Row>
                )}

                <EventPolicies extras={extras} />
              </div>

              <EventGallery photos={photos} onOpen={setViewer} />

              {related.length > 0 && (
                <section className="tl-dt-section tl-dt-related" aria-labelledby="tl-dt-related-title">
                  <div className="tl-dt-section-head">
                    <h2 id="tl-dt-related-title" className="tl-dt-section-title">Other Events</h2>
                    <Link to={backHref} onClick={onBack} className="tl-dt-pill">
                      View all events <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                  </div>
                  <div className="tl-dt-related-grid">
                    {related.map((item, i) => (
                      <div key={item.id} className="tl-dt-related-item">
                        <RelatedCard event={item} index={i} linkState={relatedLinkState} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {viewer != null && photos.length > 0 && (
                <GalleryLightbox photos={photos} index={viewer} onIndex={setViewer} onClose={closeViewer} />
              )}
              {/* Step 6: shown only when ML_REC_DISPLAY is on (renders nothing otherwise) */}
              <RecommendedEvents surface="event" excludeEventId={id} title="You might also like" />
            </>
          )}
        </main>

        <SiteFooter onCategories={toCategories} />
      </div>
    </div>
  );
}
