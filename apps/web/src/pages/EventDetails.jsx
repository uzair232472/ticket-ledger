import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Check, MapPin, RefreshCw, Share2, Users } from 'lucide-react';
import { useDialog } from '../components/ui/DialogProvider';
import { googleMapsUrl } from '../utils/maps';
import api, { trackClientBehavior } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { getEventVisual } from '../utils/eventMedia';
import { EVENT_TIMEZONE_LABEL, eventDayEnd, formatEventDate, formatEventTime } from '../utils/eventTime';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import EventTile from '../components/events/EventTile';
import EventGallery from '../components/event-detail/EventGallery';
import ContactOrganizer from '../components/event-detail/ContactOrganizer';
import { categoryName } from '../components/home/homeData';
import markUrl from '../assets/ticketledger-mark.svg';
import '../components/home/home.css';
import '../components/events/events.css';
import '../components/event-detail/detail.css';

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

// Cheapest ticket still available (falls back to the cheapest overall when everything is sold)
function getStartingPrice(tiers = []) {
  const prices = (list) => list.map((t) => Number(t.price)).filter((p) => Number.isFinite(p));
  const open = prices(tiers.filter((t) => t.availableQuantity > 0));
  const all = open.length ? open : prices(tiers);
  if (!all.length) return null;
  const min = Math.min(...all);
  return min === 0 ? 'Free' : formatPkr(min);
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
  const { isSaved, toggle: toggleFavorite } = useWishlist();
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
  const startingPrice = event ? getStartingPrice(event.tiers) : null;
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
                  <div className="tl-dt-hero-main">
                    <p className="tl-dt-kicker">
                      <span>{categoryName(event.type)}</span>
                      <span className={`tl-dt-status is-${sale.key}`}>{sale.label}</span>
                    </p>
                    <h1 id="tl-dt-title" className="tl-dt-title">{event.name}</h1>
                  </div>

                  <div className="tl-dt-hero-side">
                    <dl className="tl-dt-facts">
                      <div>
                        <span className="tl-dt-fact-icon" aria-hidden="true"><MapPin className="w-6 h-6" /></span>
                        <dt>Location</dt>
                        <dd>
                          <a className="tl-dt-maplink" href={googleMapsUrl({ ...event, venue: event.venue, city: event.city })} target="_blank" rel="noreferrer" title="Open in Google Maps">
                            <MapPin className="w-4 h-4" aria-hidden="true" />
                            <span>
                              {event.venue}
                              {event.city && !venueHasCity && <><br />{event.city}</>}
                            </span>
                            <span className="tl-dt-sr"> (opens in Google Maps)</span>
                          </a>
                        </dd>
                      </div>
                      <div>
                        <span className="tl-dt-fact-icon" aria-hidden="true"><CalendarDays className="w-6 h-6" /></span>
                        <dt>Date &amp; time</dt>
                        <dd>
                          <time dateTime={new Date(event.date).toISOString().slice(0, 10)}>{formatEventDate(event.date)}</time>
                          {time && <><br />{time} PKT</>}
                        </dd>
                      </div>
                      {organizer && (
                        <div>
                          <span className="tl-dt-fact-icon" aria-hidden="true"><Users className="w-6 h-6" /></span>
                          <dt>Organizer</dt>
                          <dd>{organizer}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="tl-dt-book">
                      {startingPrice && (
                        <p className="tl-dt-price">
                          <span>{startingPrice === 'Free' ? 'Price' : 'Tickets from'}</span> {startingPrice}
                        </p>
                      )}
                      {/* The booking button lives in the Tickets section below; here only the sale note is shown */}
                      {!bookingAction('hero') && <p className="tl-dt-book-note">{sale.note}</p>}
                    </div>
                    <ContactOrganizer email={event.organizerContactEmail} eventName={event.name} organizer={organizer} />
                  </div>
                </div>
              </section>

              <div className="tl-dt-body">
                {description && (
                  <Row label="About the event">
                    <p className="tl-dt-desc">{description}</p>
                  </Row>
                )}

                <Row label="Tickets" id="tickets">
                  {event.tiers?.length > 0 ? (
                    <ul className="tl-dt-tiers">
                      {event.tiers.map((tier) => {
                        const left = Math.max(0, Number(tier.availableQuantity) || 0);
                        const price = Number(tier.price);
                        return (
                          <li key={tier.id} className={`tl-dt-tier${left === 0 ? ' is-out' : ''}`}>
                            <span className="tl-dt-tier-name">{tier.name}</span>
                            <span className="tl-dt-tier-left">
                              {left === 0 ? 'Sold out' : left <= LOW_AVAILABILITY ? `Only ${left} left` : `${left.toLocaleString('en-PK')} available`}
                            </span>
                            <span className="tl-dt-tier-price">{price === 0 ? 'Free' : formatPkr(price)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="tl-dt-muted">Ticket categories haven’t been announced yet.</p>
                  )}
                  <div className="tl-dt-tickets-foot">
                    {sale.key === 'onsale' ? (
                      <>
                        {bookingAction('tickets')}
                        <p className="tl-dt-muted">
                          Pick your seats on the venue map. {isAuthenticated ? 'Selected seats are held for you for 10 minutes while you check out.' : 'You’ll sign in before a seat is held for you.'}
                        </p>
                      </>
                    ) : (
                      <p className={`tl-dt-state is-${sale.key}`} role="status">{sale.note}</p>
                    )}
                  </div>
                </Row>

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

                <Row label="Details">
                  <dl className="tl-dt-details">
                    <div><dt>Category</dt><dd>{categoryName(event.type)}</dd></div>
                    <div><dt>Date</dt><dd>{formatEventDate(event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
                    {time && <div><dt>Time</dt><dd>{time} <span className="tl-dt-tz">{EVENT_TIMEZONE_LABEL}</span></dd></div>}
                    <div>
                      <dt>Venue</dt>
                      <dd>
                        <a className="tl-dt-maplink" href={googleMapsUrl(event)} target="_blank" rel="noreferrer" title="Open in Google Maps">
                          <MapPin className="w-4 h-4" aria-hidden="true" /> <span>{event.venue}</span>
                          <span className="tl-dt-sr"> (opens in Google Maps)</span>
                        </a>
                        {event.locationAddress && <small className="tl-dt-addr">{event.locationAddress}</small>}
                      </dd>
                    </div>
                    {event.city && <div><dt>City</dt><dd>{event.city}</dd></div>}
                    {organizer && <div><dt>Organizer</dt><dd>{organizer}</dd></div>}
                  </dl>
                </Row>

                {['onsale', 'soldout'].includes(sale.key) && (
                  <Row label="Good to know">
                    <ul className="tl-dt-notes">
                      <li>Seats you select are held for 10 minutes while you complete checkout.</li>
                      <li>Resale on TicketLedger is capped at 110% of the ticket’s face value.</li>
                      <li>Your entry QR code lives in your wallet and refreshes every 30 seconds.</li>
                    </ul>
                  </Row>
                )}
              </div>

              <EventGallery event={event} mainImage={heroImage} />

              {related.length > 0 && (
                <section className="tl-dt-related" aria-labelledby="tl-dt-related-title">
                  <h2 id="tl-dt-related-title" className="tl-dt-related-title">Other events</h2>
                  <div className="tl-dt-related-grid">
                    {related.map((item, i) => (
                      <div key={item.id} className="tl-dt-related-item">
                        <EventTile
                          event={item}
                          index={i}
                          isFavorite={isSaved(item.id)}
                          onToggleFavorite={toggleFavorite}
                          linkState={relatedLinkState}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>

        <SiteFooter onCategories={toCategories} />
      </div>
    </div>
  );
}
