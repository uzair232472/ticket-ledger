import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { getEventVisual } from '../../utils/eventMedia';
import markUrl from '../../assets/ticketledger-mark.svg';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';

// Shown only when the API reports this few seats left
const LOW_AVAILABILITY = 50;

const formatDate = (date) => formatEventDate(date);

// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore")
const formatPlace = (venue = '', city = '') =>
  city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city;

const priceLabel = (event) => {
  const min = event.pricing?.minPrice;
  if (min == null) return null;
  return Number(min) === 0 ? 'Free' : `From PKR ${Number(min).toLocaleString('en-PK')}`;
};

const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Event tile modelled on the reference project tiles: a black-and-white photo whose colour is revealed
 * through a radial mask that follows the cursor, with a slight 3D tilt toward the pointer and a slow
 * image scale. All movement is written to CSS variables (no React state per frame).
 */
export default function EventTile({ event, index, isFavorite, onToggleFavorite, onOpen, linkState }) {
  const tileRef = useRef(null);
  const frame = useRef(0);
  const visual = getEventVisual(event, index);
  const price = priceLabel(event);
  const available = event.pricing?.totalAvailable;
  const hasTiers = Array.isArray(event.tiers) && event.tiers.length > 0;
  const soldOut = hasTiers && available === 0;
  const limited = hasTiers && available > 0 && available <= LOW_AVAILABILITY;

  const setVars = (vars) => {
    const el = tileRef.current;
    if (!el) return;
    Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
  };

  const onPointerMove = (e) => {
    if (!finePointer()) return;
    const media = e.currentTarget.querySelector('.tl-tile-media');
    const r = media.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const tilt = reducedMotion() ? 0 : 1;
      setVars({
        '--mx': `${x}px`,
        '--my': `${y}px`,
        // Tilt toward the pointer, up to about 2.5°
        '--rx': `${((0.5 - y / r.height) * 5 * tilt).toFixed(2)}deg`,
        '--ry': `${((x / r.width - 0.5) * 5 * tilt).toFixed(2)}deg`,
      });
    });
  };
  const onPointerEnter = (e) => {
    if (!finePointer()) return;
    const r = e.currentTarget.querySelector('.tl-tile-media').getBoundingClientRect();
    // Colour radius grows to cover the whole image from wherever the pointer is
    setVars({ '--mr': `${Math.round(Math.hypot(r.width, r.height) * 1.1)}px` });
    tileRef.current?.classList.add('is-hover');
    onPointerMove(e);
  };
  const onPointerLeave = () => {
    cancelAnimationFrame(frame.current);
    setVars({ '--mr': '0px', '--rx': '0deg', '--ry': '0deg' });
    tileRef.current?.classList.remove('is-hover');
  };

  const fallback = (e) => e.currentTarget.closest('.tl-tile-media')?.classList.add('is-broken');

  return (
    <article ref={tileRef} className="tl-tile">
      <Link
        to={`/events/${event.id}`}
        state={linkState}
        className="tl-tile-link"
        onClick={onOpen}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <div className="tl-tile-media">
          <img className="tl-tile-img" src={visual.image} alt="" loading={index < 3 ? 'eager' : 'lazy'} decoding="async" onError={fallback} />
          <img className="tl-tile-img tl-tile-gray" src={visual.image} alt="" aria-hidden="true" loading={index < 3 ? 'eager' : 'lazy'} decoding="async" />
          <span className="tl-tile-fallback" aria-hidden="true" style={{ backgroundImage: `url(${markUrl})` }} />
          {(soldOut || limited) && (
            <span className={`tl-tile-flag${soldOut ? ' is-soldout' : ''}`}>{soldOut ? 'Sold out' : `Only ${available} left`}</span>
          )}
        </div>
        <div className="tl-tile-caption">
          <h2 className="tl-tile-title">{event.name}</h2>
          <p className="tl-tile-meta">
            {formatDate(event.date)}
            {event.time ? ` · ${formatEventTime(event.time)} PKT` : ''}
          </p>
          <p className="tl-tile-meta">{formatPlace(event.venue, event.city)}</p>
          {price && <p className="tl-tile-price">{price}</p>}
        </div>
      </Link>
      <button
        type="button"
        className="tl-tile-fav"
        aria-pressed={Boolean(isFavorite)}
        aria-label={isFavorite ? `Remove ${event.name} from saved events` : `Save ${event.name}`}
        onClick={() => onToggleFavorite(event.id)}
      >
        <Heart className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    </article>
  );
}
