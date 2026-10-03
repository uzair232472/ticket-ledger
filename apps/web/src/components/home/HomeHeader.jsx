import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import BrandLogo from '../brand/BrandLogo';
import HeaderAccount from './HeaderAccount';
import menuIcon from '../../assets/menu-ticket.png';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Menu groups for the current visitor. Mirrors the routes and role rules used elsewhere in the app
 * (ProtectedRoute + App routes), so nothing appears that the user cannot open.
 */
function useMenuGroups(onCategories) {
  const { user, isAuthenticated } = useAuth();
  const role = user?.role;
  const groups = [];

  const discover = [
    { label: 'Explore Events', to: '/events' },
    { label: 'Categories', onClick: onCategories },
    { label: 'All Categories', to: '/categories' },
  ];
  if (!isAuthenticated || role === 'CUSTOMER' || role === 'SUPER_ADMIN') discover.push({ label: 'Fan Resale', to: '/resale' });
  groups.push({ title: 'Discover', items: discover });

  if (role === 'CUSTOMER' || role === 'SUPER_ADMIN') {
    groups.push({
      title: 'My Tickets',
      items: [
        { label: 'Ticket Wallet', to: '/wallet' },
        { label: 'NFT Tickets', to: '/my-nfts' },
        { label: 'Orders', to: '/my-bookings' },
      ],
    });
  }

  if (role === 'ORGANIZER') {
    const approved = user.companyStatus === 'APPROVED';
    groups.push({
      title: 'Organize',
      items: approved
        ? [
            { label: 'Create Event', to: '/organizer/create-event' },
            { label: 'Organizer Dashboard', to: '/organizer/dashboard' },
            { label: 'Gate Scanner', to: '/scanner' },
          ]
        : [{ label: 'Company Registration', to: '/company' }],
    });
  } else if (role === 'GATE_STAFF') {
    groups.push({ title: 'Gate', items: [{ label: 'My Gate Events', to: '/staff/events' }, { label: 'Scanner', to: '/scanner' }] });
  } else if (role === 'SUPER_ADMIN') {
    groups.push({
      title: 'Admin',
      items: [
        { label: 'Admin Dashboard', to: '/admin/dashboard' },
        { label: 'Organizer Approvals', to: '/admin/companies' },
        { label: 'Fraud Watchlist', to: '/admin/fraud-watchlist' },
        { label: 'Demand Forecast', to: '/admin/demand-forecast' },
      ],
    });
  } else {
    // Visitors and customers: hosting starts with an organizer account
    groups.push({ title: 'Create Event', items: [{ label: 'Host an Event', to: '/company' }] });
  }

  groups.push({
    title: 'Account',
    items: isAuthenticated
      ? [
          { label: 'Notifications', to: '/notifications', badge: 'notifications' },
          { label: 'Profile & Settings', to: '/profile' },
          { label: 'Log Out', action: 'logout' },
        ]
      : [
          { label: 'Log In', to: '/login' },
          { label: 'Sign Up', to: '/signup' },
        ],
  });
  return groups;
}

/**
 * Shared fixed header (homepage, Explore Events): logo + "Menu" button that opens an animated panel.
 * `tone` is the starting logo colour: 'dark' scenes get a white logo, 'light' pages a dark one.
 * `pageRef` is the page content, made inert while the menu is open.
 */
export default function HomeHeader({ pageRef, onCategories, tone = 'dark' }) {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const headerRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const timelineRef = useRef(null);
  const savedScrollRef = useRef(0);
  const restoreScrollRef = useRef(true);
  const [scrollHidden, setScrollHidden] = useState(false);
  const lastScrollYRef = useRef(0);

  // Smooth auto-hide header when scrolling down; only reveal when getting back to the top
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        if (open || currentY <= 80) {
          setScrollHidden(false);
        } else if (currentY > 120) {
          setScrollHidden(true);
        }
        lastScrollYRef.current = currentY;
        ticking = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [open]);

  const goToCategories = useCallback(() => {
    restoreScrollRef.current = true;
    setOpen(false);
    // Scroll after the lock is released and the exact position restored
    requestAnimationFrame(() => requestAnimationFrame(() => onCategories?.()));
  }, [onCategories]);

  const groups = useMenuGroups(goToCategories);

  // Build the open/close choreography once (reduced motion: plain fade)
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const reduce = prefersReducedMotion();
      const lines = panelRef.current.querySelectorAll('[data-menu-line]');
      const tl = gsap.timeline({ paused: true });
      tl.set([backdropRef.current, panelRef.current], { visibility: 'visible' });
      if (reduce) {
        tl.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0)
          .fromTo(panelRef.current, { opacity: 0, clipPath: 'inset(0% 0% 0% 0%)' }, { opacity: 1, duration: 0.15 }, 0);
      } else {
        tl.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, 0)
          // Panel unfolds downward from under the header while easing in from a slightly smaller box
          .fromTo(
            panelRef.current,
            { clipPath: 'inset(0% 2% 100% 2%)', scale: 0.985, transformOrigin: '50% 0%' },
            { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.55, ease: 'power3.inOut' },
            0
          )
          .fromTo(lines, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.035 }, 0.22);
      }
      timelineRef.current = tl;
    }, headerRef);
    return () => ctx.revert();
  }, [groups.length, isAuthenticated]);

  // Lock background scroll without moving it, and restore the exact position on close.
  // The lock goes on <body>: its overflow propagates to the viewport, so pinned (sticky) scenes stay put.
  // Locking <html> instead would turn <body> (overflow-x: hidden in index.css) into its own scroll
  // container and detach every sticky stage.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const tl = timelineRef.current;
    if (open) {
      savedScrollRef.current = window.scrollY;
      const scrollbar = window.innerWidth - html.clientWidth;
      body.style.overflow = 'hidden';
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
      if (pageRef?.current) pageRef.current.inert = true;
      if (panelRef.current) panelRef.current.inert = false;
      tl?.timeScale(1).play();
      // Move focus into the menu
      requestAnimationFrame(() => panelRef.current?.querySelector(FOCUSABLE)?.focus({ preventScroll: true }));
      if (isAuthenticated) {
        api.get('/notifications?limit=1')
          .then((res) => setUnread(res.data?.data?.unreadCount || 0))
          .catch(() => {});
      }
      return undefined;
    }

    // Closing (or initial render)
    if (pageRef?.current) pageRef.current.inert = false;
    if (panelRef.current) panelRef.current.inert = true;
    const wasLocked = body.style.overflow === 'hidden';
    body.style.overflow = '';
    body.style.paddingRight = '';
    if (wasLocked && restoreScrollRef.current) {
      window.scrollTo({ top: savedScrollRef.current, behavior: 'instant' });
    }
    restoreScrollRef.current = true;
    if (tl && tl.progress() > 0) tl.timeScale(1.6).reverse();
    return undefined;
  }, [open, pageRef, isAuthenticated]);

  // Never leave the page locked when the header unmounts (route change)
  useEffect(
    () => () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      if (pageRef?.current) pageRef.current.inert = false;
    },
    [pageRef]
  );

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }, []);

  // Escape closes; Tab cycles between the menu button and the menu items
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [buttonRef.current, ...panelRef.current.querySelectorAll(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const idx = items.indexOf(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || idx === -1)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || idx === -1)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const onNavigate = () => {
    // Leaving the homepage: release the lock without jumping back to the old position
    restoreScrollRef.current = false;
    setOpen(false);
  };

  const onLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <>
      <header ref={headerRef} className="tl-header" data-tone={tone} data-home-header data-scroll-hidden={scrollHidden ? 'true' : 'false'}>
        <Link to="/" className="tl-header-logo" aria-label="TicketLedger home" data-header-logo>
          <BrandLogo />
        </Link>

        <div className="tl-header-actions">
          <button
            ref={buttonRef}
            type="button"
            className="tl-menu-btn"
            aria-expanded={open}
            aria-controls="tl-site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => (open ? close(true) : setOpen(true))}
          >
            <img className="tl-menu-btn-img" src={menuIcon} alt="" width="91" height="46" draggable="false" />
          </button>
          <HeaderAccount menuOpen={open} onOpen={() => open && close(false)} onLogout={onLogout} />
        </div>

        <div ref={backdropRef} className="tl-menu-backdrop" aria-hidden="true" onClick={() => close(true)} />

        <nav ref={panelRef} id="tl-site-menu" className="tl-menu-panel" aria-label="Site menu">
          <div className="tl-menu-grid">
            {groups.map((group) => (
              <section key={group.title} className="tl-menu-group" aria-labelledby={`tl-menu-${group.title}`}>
                <div className="tl-menu-line" data-menu-line>
                  <h2 id={`tl-menu-${group.title}`}>{group.title}</h2>
                </div>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.label} className="tl-menu-line" data-menu-line>
                      {item.to ? (
                        <Link to={item.to} className="tl-menu-link" onClick={onNavigate}>
                          {item.label}
                          {item.badge === 'notifications' && unread > 0 && (
                            <span className="tl-menu-badge" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>
                          )}
                        </Link>
                      ) : (
                        <button type="button" className="tl-menu-link" onClick={item.action === 'logout' ? onLogout : item.onClick}>
                          {item.label}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {isAuthenticated && (
            <p className="tl-menu-line" data-menu-line style={{ marginTop: 24, fontSize: 13, opacity: 0.75 }}>
              Signed in as {user?.name}
            </p>
          )}
        </nav>
      </header>
    </>
  );
}
