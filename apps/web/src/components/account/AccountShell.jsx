import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate, useNavigationType } from 'react-router-dom';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import { initAccountMotion, refreshAccountMotion } from './accountMotion';
import '../home/home.css';
import './account.css';

// Dialogs render here: above the header and every stacked section, but still inside the themed root
const PortalContext = createContext(null);

/** Renders page dialogs into the shell's top layer (see PortalContext). */
export function AccountPortal({ children }) {
  const el = useContext(PortalContext);
  return el ? createPortal(<div className="tl-acct-skin">{children}</div>, el) : null;
}

const hideBroken = (e) => e.currentTarget.classList.add('is-broken');

// Account areas a customer can open (same routes and roles as App.jsx)
const ACCOUNT_LINKS = [
  { to: '/wallet', label: 'Ticket wallet' },
  { to: '/my-nfts', label: 'NFT tickets' },
  { to: '/my-bookings', label: 'Orders' },
  { to: '/resale', label: 'Fan resale' },
];

/**
 * Shared layout for the customer account pages, in the homepage theme: fixed header and menu, a pinned
 * intro whose photo settles into a frame while scrolling, then content sections that each slide up over
 * the one before (see stackSections), and the site footer.
 *
 * `children` should be <AccountSection> elements. `contentKey` changes whenever the page's content changes
 * height (data loaded, filter switched) so the scroll scenes are re-measured and new cards revealed.
 * `nav` replaces the customer account tabs (pass [] for none).
 */
export default function AccountShell({ eyebrow, title, intro, image, stats = [], actions, contentKey, nav = ACCOUNT_LINKS, children }) {
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const [portalEl, setPortalEl] = useState(null);

  useLayoutEffect(() => {
    const mm = initAccountMotion(rootRef.current);
    return () => mm.revert();
  }, []);

  // A fresh visit starts at the top of the intro; back/forward keep the browser's restored position
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshAccountMotion(rootRef.current));
    return () => cancelAnimationFrame(frame);
  }, [contentKey]);

  return (
    <PortalContext.Provider value={portalEl}>
    <div ref={rootRef} className="tl-home tl-acct">
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} />

      <div ref={pageRef}>
        <section className="tl-acct-hero-track" aria-labelledby="tl-acct-title">
          <div className="tl-acct-hero-stage">
            <div className="tl-acct-hero-media" aria-hidden="true">
              <img src={image} alt="" fetchpriority="high" onError={hideBroken} />
              <div className="tl-acct-hero-shade" />
              <div className="tl-acct-hero-dim" />
            </div>

            <div className="tl-acct-hero-content">
              <div className="tl-acct-hero-copy">
                <p className="tl-eyebrow">{eyebrow}</p>
                <h1 id="tl-acct-title" className="tl-acct-title">
                  {title.map((line, i) => (
                    <span key={i} className="tl-acct-title-line">
                      {line}
                      {i === title.length - 1 && <span className="tl-acct-accent">.</span>}
                    </span>
                  ))}
                </h1>
                {intro && <p className="tl-acct-intro">{intro}</p>}
                {actions && <div className="tl-acct-actions">{actions}</div>}
              </div>

              {stats.length > 0 && (
                <dl className="tl-acct-stats">
                  {stats.map((s) => (
                    <div key={s.label} className="tl-acct-stat">
                      <dd>{s.value}</dd>
                      <dt>{s.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {nav.length > 0 && (
            <nav className="tl-acct-nav" aria-label="Your account">
              {nav.map((l) => (
                <NavLink key={l.to} to={l.to} className={({ isActive }) => `tl-acct-nav-link${isActive ? ' is-active' : ''}`}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
            )}
            <div className="tl-acct-hero-progress" aria-hidden="true" />
            <div className="tl-cover-shade" aria-hidden="true" />
          </div>
        </section>

        {children}

        <SiteFooter />
      </div>
      <div ref={setPortalEl} className="tl-acct-layer" />
    </div>
    </PortalContext.Provider>
  );
}

/**
 * One stacked content section. `tone="light"` switches the header logo to its dark version while the
 * section is under it. Interactive content inside is never transformed (dialogs stay anchored).
 */
export function AccountSection({ id, kicker, title, aside, tone = 'dark', className = '', children }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      className={`tl-acct-section tl-acct-section--${tone} ${className}`}
      aria-labelledby={headingId}
      data-acct-section
      {...(tone === 'light' ? { 'data-header-light': '' } : {})}
    >
      {(kicker || title || aside) && (
        <div className="tl-acct-section-head" data-acct-head>
          <div>
            {kicker && <p className="tl-eyebrow">{kicker}</p>}
            {title && <h2 id={headingId} className="tl-acct-section-title">{title}</h2>}
          </div>
          {aside && <div className="tl-acct-section-aside">{aside}</div>}
        </div>
      )}
      <div className="tl-acct-skin">{children}</div>
      <div className="tl-cover-shade" aria-hidden="true" />
    </section>
  );
}
