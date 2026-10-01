import React, { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Pause, Play } from 'lucide-react';
import { EVENT_VISUALS, resolveMediaUrl } from '../../utils/eventMedia';
import { CATEGORIES } from '../home/homeData';

gsap.registerPlugin(ScrollTrigger);

const SPEED = 36; // px/s, measured on the reference marquee
const MIN_CARDS = 6;

const photo = (id, w) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;
// Atmosphere photos already used in the project, grouped so a match never shows concert crowds
const SPORT_POOL = ['1540747913346-19e32dc3e97e', '1431324155629-1a6deb1dec8d', '1508098682722-e99c43a406b2', '1531415074968-036ba1b575da'];
const MUSIC_POOL = ['1501386761578-eac5c94b800a', '1470229722913-7c0e2dbbafd3', '1459749411175-04bf5292ceea', '1540039155733-5bb30b53aa14', '1514525253161-7a46d19cd819', '1470225620780-dba8ba36b745'];
const MUSIC_TYPES = ['MUSIC_CONCERT', 'MUSIC_FESTIVAL'];

const photoId = (src = '') => src.match(/photo-([\w-]+?)(\?|$)/)?.[1] || src;

const sized = (src) => (src.includes('images.unsplash.com') ? src.replace(/w=\d+/, 'w=900') : src);

/** Repeats a list until there are enough cards for the strip to be wider than the screen. */
const fill = (pool) => {
  const out = [];
  for (let i = 0; out.length < Math.max(MIN_CARDS, pool.length); i++) out.push(pool[i % pool.length]);
  return out;
};

/**
 * The organizer's gallery images in their saved order when there are any; otherwise the event's own
 * image first, then photos for its category, then generic ones from the same group.
 */
function buildCards(event, mainImage) {
  const own = (event.galleryImages || []).map((img) => resolveMediaUrl(img.url)).filter(Boolean);
  if (own.length) return fill(own);
  const visual = EVENT_VISUALS[event.type] || {};
  const category = CATEGORIES.find((c) => c.type === event.type);
  const group = (MUSIC_TYPES.includes(event.type) ? MUSIC_POOL : SPORT_POOL).map((id) => photo(id, 900));
  const seen = new Set([photoId(mainImage)]);
  const cards = [];
  [visual.defaultImage, visual.altImage, category?.image, ...group].filter(Boolean).forEach((src) => {
    const key = photoId(src);
    if (!seen.has(key)) {
      seen.add(key);
      cards.push(sized(src));
    }
  });
  // Too few distinct photos: include the event image and repeat so the strip is wider than the screen
  return fill(cards.length ? [sized(mainImage), ...cards] : [sized(mainImage)]);
}

/**
 * Reference gallery: one wide image, then a strip of tall cards that drifts left continuously,
 * speeds up while the page scrolls, can be dragged (with a little inertia) and pauses off screen.
 * Reduced motion: no drift, drag only. A pause button covers WCAG 2.2.2 for the moving strip.
 */
export default function EventGallery({ event, mainImage }) {
  const cards = useMemo(() => buildCards(event, mainImage), [event, mainImage]);
  const wideImage = resolveMediaUrl(event.galleryWideUrl) || mainImage;
  const stripRef = useRef(null);
  const trackRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [reduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const strip = stripRef.current;
    const track = trackRef.current;
    const list = track.firstElementChild;
    let listWidth = list.offsetWidth;
    let x = 0;
    let boost = 0; // extra speed from page scrolling
    let fling = 0; // drag inertia (px/s)
    let visible = false;
    let drag = null;
    const wrap = (v) => gsap.utils.wrap(-listWidth, 0, v);
    const render = () => gsap.set(track, { x });

    const tick = (_, delta) => {
      if (!visible || drag) return;
      const dt = Math.min(delta, 64) / 1000;
      if (pausedRef.current) fling = 0; // paused means still (dragging still works)
      const auto = reduce || pausedRef.current ? 0 : SPEED * (1 + boost);
      x = wrap(x - auto * dt + fling * dt);
      fling *= Math.pow(0.04, dt); // inertia fades out in about a second
      if (Math.abs(fling) < 1) fling = 0;
      boost *= Math.pow(0.08, dt);
      render();
    };
    gsap.ticker.add(tick);

    const st = ScrollTrigger.create({
      trigger: strip,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        visible = self.isActive;
      },
      onUpdate: (self) => {
        if (!reduce) boost = Math.min(Math.abs(self.getVelocity()) / 400, 4);
      },
    });

    // Drag (pointer events; vertical page scrolling still works on touch thanks to touch-action: pan-y)
    const onDown = (e) => {
      if (e.button !== 0) return;
      drag = { startX: e.clientX, startPos: x, lastX: e.clientX, lastT: performance.now(), v: 0, id: e.pointerId };
      strip.classList.add('is-dragging');
    };
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!strip.hasPointerCapture(e.pointerId) && Math.abs(e.clientX - drag.startX) > 4) strip.setPointerCapture(e.pointerId);
      const now = performance.now();
      drag.v = ((e.clientX - drag.lastX) / Math.max(now - drag.lastT, 1)) * 1000;
      drag.lastX = e.clientX;
      drag.lastT = now;
      x = wrap(drag.startPos + (e.clientX - drag.startX));
      render();
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      fling = reduce ? 0 : gsap.utils.clamp(-2500, 2500, drag.v);
      drag = null;
      strip.classList.remove('is-dragging');
    };
    strip.addEventListener('pointerdown', onDown);
    strip.addEventListener('pointermove', onMove);
    strip.addEventListener('pointerup', onUp);
    strip.addEventListener('pointercancel', onUp);

    const ro = new ResizeObserver(() => {
      listWidth = list.offsetWidth || 1;
      x = wrap(x);
      render();
    });
    ro.observe(list);

    return () => {
      gsap.ticker.remove(tick);
      st.kill();
      ro.disconnect();
      strip.removeEventListener('pointerdown', onDown);
      strip.removeEventListener('pointermove', onMove);
      strip.removeEventListener('pointerup', onUp);
      strip.removeEventListener('pointercancel', onUp);
      gsap.set(track, { clearProps: 'transform' });
    };
  }, [cards, reduce]);

  const hideBroken = (e) => e.currentTarget.parentElement.classList.add('is-broken');
  const renderList = (copy) => (
    <div className="tl-dt-marquee-list" aria-hidden={copy ? 'true' : undefined}>
      {cards.map((src, i) => (
        <div key={i} className="tl-dt-marquee-item">
          <img src={src} alt="" draggable="false" loading="lazy" decoding="async" onError={hideBroken} />
        </div>
      ))}
    </div>
  );

  return (
    <section className="tl-dt-gallery" aria-label="Photos">
      <div className="tl-dt-wide">
        <img src={wideImage} alt={`${event.name}`} loading="lazy" decoding="async" onError={hideBroken} />
      </div>
      <div ref={stripRef} className="tl-dt-marquee" data-event-marquee>
        <div ref={trackRef} className="tl-dt-marquee-track">
          {renderList(false)}
          {renderList(true)}
        </div>
      </div>
      {!reduce && (
        <button type="button" className="tl-dt-marquee-toggle" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="w-3.5 h-3.5" aria-hidden="true" /> : <Pause className="w-3.5 h-3.5" aria-hidden="true" />}
          {paused ? 'Play photos' : 'Pause photos'}
        </button>
      )}
    </section>
  );
}
