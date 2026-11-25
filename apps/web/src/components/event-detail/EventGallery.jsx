import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { EVENT_VISUALS, resolveMediaUrl } from '../../utils/eventMedia';
import { CATEGORIES } from '../home/homeData';

const photo = (id, w) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=82`;
// Atmosphere photos already used in the project, grouped so a match never shows concert crowds
const SPORT_POOL = ['1540747913346-19e32dc3e97e', '1431324155629-1a6deb1dec8d', '1508098682722-e99c43a406b2', '1531415074968-036ba1b575da'];
const MUSIC_POOL = ['1501386761578-eac5c94b800a', '1470229722913-7c0e2dbbafd3', '1459749411175-04bf5292ceea', '1540039155733-5bb30b53aa14', '1514525253161-7a46d19cd819', '1470225620780-dba8ba36b745'];
const MUSIC_TYPES = ['MUSIC_CONCERT', 'MUSIC_FESTIVAL', 'QAWWALI'];

const photoId = (src = '') => src.match(/photo-([\w-]+?)(\?|$)/)?.[1] || src;
const sized = (src, w) => (src?.includes('images.unsplash.com') ? src.replace(/w=\d+/, `w=${w}`) : src);

/**
 * The organizer's gallery images in their saved order when there are any; otherwise the event's own
 * image first, then photos for its category, then generic ones from the same group (no repeats).
 */
export function buildPhotos(event, mainImage) {
  const own = (event.galleryImages || []).map((img) => resolveMediaUrl(img.url)).filter(Boolean);
  if (own.length) return own;
  const visual = EVENT_VISUALS[event.type] || {};
  const category = CATEGORIES.find((c) => c.type === event.type);
  const group = (MUSIC_TYPES.includes(event.type) ? MUSIC_POOL : SPORT_POOL).map((id) => photo(id, 1400));
  const seen = new Set();
  const out = [];
  [mainImage, visual.defaultImage, visual.altImage, category?.image, ...group].filter(Boolean).forEach((src) => {
    const key = photoId(src);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(src);
    }
  });
  return out;
}

export function useEventPhotos(event, mainImage) {
  return useMemo(() => (event ? buildPhotos(event, mainImage) : []), [event, mainImage]);
}

/** Full-screen photo viewer: arrows / ← → keys to step, Esc or the backdrop to close. */
export function GalleryLightbox({ photos, index, onClose, onIndex }) {
  const closeRef = useRef(null);
  const count = photos.length;
  const step = useCallback((d) => onIndex((index + d + count) % count), [index, count, onIndex]);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose, step]);

  return (
    <div className="tl-dt-lightbox" role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${count}`} onClick={onClose}>
      <button ref={closeRef} type="button" className="tl-dt-lightbox-close" onClick={onClose} aria-label="Close photos">
        <X className="w-6 h-6" aria-hidden="true" />
      </button>
      <img src={sized(photos[index], 2000)} alt="" className="tl-dt-lightbox-img" onClick={(e) => e.stopPropagation()} />
      {count > 1 && (
        <>
          <button type="button" className="tl-dt-arrow tl-dt-lightbox-prev" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous photo">
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <button type="button" className="tl-dt-arrow tl-dt-lightbox-next" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next photo">
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
          <p className="tl-dt-lightbox-count">{index + 1} / {count}</p>
        </>
      )}
    </div>
  );
}

/** "Event Gallery": a row of thumbnails that scrolls a page at a time, with arrows and page dots. */
export default function EventGallery({ photos, onOpen }) {
  const railRef = useRef(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const total = Math.max(1, Math.ceil((rail.scrollWidth - 2) / rail.clientWidth));
    setPages(total);
    setPage(Math.min(total - 1, Math.round(rail.scrollLeft / rail.clientWidth)));
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rail);
    rail.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      rail.removeEventListener('scroll', measure);
    };
  }, [measure, photos]);

  if (!photos.length) return null;
  const go = (p) => {
    const rail = railRef.current;
    const target = Math.max(0, Math.min(pages - 1, p));
    rail.scrollTo({ left: target * rail.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const hideBroken = (e) => e.currentTarget.parentElement.classList.add('is-broken');

  return (
    <section className="tl-dt-section tl-dt-gallery" aria-labelledby="tl-dt-gallery-title">
      <div className="tl-dt-section-head">
        <h2 id="tl-dt-gallery-title" className="tl-dt-section-title">Event Gallery</h2>
      </div>
      <div className="tl-dt-gallery-wrap">
        {pages > 1 && (
          <button type="button" className="tl-dt-arrow tl-dt-gallery-prev" onClick={() => go(page - 1)} disabled={page === 0} aria-label="Previous photos">
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
        <ul ref={railRef} className="tl-dt-gallery-rail">
          {photos.map((src, i) => (
            <li key={src + i} className="tl-dt-gallery-item">
              <button type="button" className={`tl-dt-gallery-thumb${i === 0 ? ' is-first' : ''}`} onClick={() => onOpen(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
                <img src={sized(src, 800)} alt="" loading="lazy" decoding="async" onError={hideBroken} />
              </button>
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <button type="button" className="tl-dt-arrow tl-dt-gallery-next" onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="More photos">
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {pages > 1 && (
        <div className="tl-dt-dots" role="group" aria-label="Gallery pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className={`tl-dt-dot${i === page ? ' is-active' : ''}`} onClick={() => go(i)} aria-label={`Page ${i + 1}`} aria-current={i === page ? 'true' : undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
