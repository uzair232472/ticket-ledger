import React, { useEffect, useRef } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';
import HomeHeader from '../home/HomeHeader';
import SiteFooter from '../home/SiteFooter';
import '../home/home.css';
import './basic.css';

/**
 * Plain (non-animated) page layout for everyday account screens such as Notifications and Profile:
 * the homepage header, menu and footer around the Explore Events paper background and editorial heading.
 */
export default function BasicShell({ eyebrow, title, intro, actions, children }) {
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const pageRef = useRef(null);

  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // The header logo steps aside once the dark footer (with its own wordmark) reaches it, as on the homepage
  useEffect(() => {
    const header = document.querySelector('[data-home-header]');
    const footer = document.querySelector('.tl-basic .tl-footer');
    if (!header || !footer) return undefined;
    const update = () => {
      header.dataset.atFooter = String(footer.getBoundingClientRect().top <= 80);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      delete header.dataset.atFooter;
    };
  }, []);

  return (
    <div className="tl-home tl-basic">
      <HomeHeader pageRef={pageRef} onCategories={() => navigate('/events')} tone="light" />
      <div ref={pageRef}>
        <main className="tl-basic-main">
          <header className="tl-basic-head">
            <div>
              {eyebrow && <p className="tl-basic-eyebrow">{eyebrow}</p>}
              <h1 className="tl-basic-title">{title}</h1>
              {intro && <p className="tl-basic-intro">{intro}</p>}
            </div>
            {actions && <div className="tl-basic-actions">{actions}</div>}
          </header>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
