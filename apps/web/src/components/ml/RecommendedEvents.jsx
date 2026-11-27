import React, { useEffect, useRef, useState } from 'react';
import api, { getClientSessionId } from '../../utils/api';
import { API_URL, getAccessToken } from '../../lib/session';
import EventCard from '../home/EventCard';
import { useWishlist } from '../../context/WishlistContext';
import { createRenderTracker, fetchMlFlags } from '../../lib/mlInsights';
import './ml.css';

/*
 * Step 6 (feature E): a row of recommended events. Shown only when ML_REC_DISPLAY is on (off by default).
 * The list comes from the rule-based recommender (control or personalised group, decided on the server); both
 * groups get exactly this markup and heading, so the experiment is fair. The list counts as seen only when at
 * least half of it is on screen for a second (once per list), and a click is reported for that list. If
 * anything fails the row renders nothing; it never affects prices, availability or checkout.
 */

const beacon = (path, body) => {
  try {
    const token = getAccessToken();
    fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-session-id': getClientSessionId(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    }).catch(() => {});
  } catch { /* never blocks the page */ }
};

export default function RecommendedEvents({ surface = 'home', excludeEventId = null, title = 'You might also like' }) {
  const [list, setList] = useState(null);
  const ref = useRef(null);
  const { isSaved, toggle } = useWishlist();

  useEffect(() => {
    let live = true;
    fetchMlFlags(api).then(async (f) => {
      if (!f.recommendations) return;
      try {
        const r = await api.get('/events/recommendations', { params: { surface, cards: 1 }, timeout: 4000 });
        const d = r.data?.data;
        if (live && d?.listId && d.events?.length) setList(d);
      } catch { /* hidden */ }
    });
    return () => { live = false; };
  }, [surface]);

  useEffect(() => {
    if (!list || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const tracker = createRenderTracker({ onSeen: () => beacon(`/events/recommendations/${list.listId}/rendered`) });
    const io = new IntersectionObserver(([entry]) => tracker.update(entry.intersectionRatio), { threshold: [0, 0.25, 0.5, 0.75, 1] });
    io.observe(ref.current);
    return () => { io.disconnect(); tracker.stop(); };
  }, [list]);

  if (!list) return null;
  const events = list.events.filter((e) => e.eventId !== excludeEventId);
  if (!events.length) return null;
  return (
    <section className="tl-rec" ref={ref} aria-label={title}>
      <h2>{title}</h2>
      <div className="tl-rec-row">
        {events.map((e, i) => (
          <div key={e.eventId} onClickCapture={() => beacon(`/events/recommendations/${list.listId}/click`, { eventId: e.eventId })}>
            <EventCard event={e.card} index={i} isFavorite={isSaved(e.eventId)} onToggleFavorite={toggle} />
          </div>
        ))}
      </div>
    </section>
  );
}
