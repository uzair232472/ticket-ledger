import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../utils/api';
import HomeHeader from '../components/home/HomeHeader';
import SiteFooter from '../components/home/SiteFooter';
import CategoryCard from '../components/home/CategoryCard';
import { ALL_CATEGORIES } from '../components/home/homeData';
import '../components/home/home.css';

/** All Categories: the homepage category panels, extended with every event type */
export default function Categories() {
  const navigationType = useNavigationType();
  const pageRef = useRef(null);
  const [events, setEvents] = useState(null);

  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    api.get('/events')
      .then((res) => setEvents(res.data?.data?.events || []))
      .catch(() => setEvents(null));
  }, []);

  // Upcoming events per type (null until loaded, so the cards skip the count line)
  const countsByType = useMemo(() => {
    if (!events) return null;
    const now = Date.now();
    return events
      .filter((e) => new Date(e.date).getTime() >= now)
      .reduce((acc, e) => ({ ...acc, [e.type]: (acc[e.type] || 0) + 1 }), {});
  }, [events]);

  const focusGrid = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('all-categories')?.focus({ preventScroll: true });
  };

  return (
    <div className="tl-home tl-allcats-page">
      <HomeHeader pageRef={pageRef} onCategories={focusGrid} tone="light" />
      <div ref={pageRef}>
        <main id="all-categories" className="tl-categories tl-allcats" tabIndex={-1} aria-labelledby="tl-allcats-title">
          <Link to="/" className="tl-allcats-back">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Home
          </Link>
          <div className="tl-categories-head">
            <h1 id="tl-allcats-title" className="tl-section-title">All categories</h1>
            <p>From floodlit stadiums to festival grounds, pick a category to see what’s coming up.</p>
          </div>
          <div className="tl-category-grid">
            {ALL_CATEGORIES.map((cat, i) => (
              <CategoryCard key={cat.type} cat={cat} index={i} count={countsByType ? countsByType[cat.type] || 0 : undefined} />
            ))}
          </div>
        </main>
        <SiteFooter onCategories={focusGrid} />
      </div>
    </div>
  );
}
