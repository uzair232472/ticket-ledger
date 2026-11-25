import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Heart, MapPin } from 'lucide-react';
import { getEventVisual } from '../../utils/eventMedia';
import markUrl from '../../assets/ticketledger-mark.svg';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';

// Shown only when the API reports this few seats left
const LOW_AVAILABILITY = 50;

// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore")
const formatPlace = (venue = '', city = '') =>
  city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city;

const minPrice = (event) => {
  const min = event.pricing?.minPrice;
  if (min == null) return null;
  return Number(min) === 0 ? 'Free' : `PKR ${Number(min).toLocaleString('en-PK')}`;
};

/**
 * Event card: 3:2 photo (the organizer's card image) with the date chip, featured / availability
 * flags and a save heart, then the name, place, starting price and an arrow.
 */
export default function EventTile({ event, index, isFavorite, onToggleFavorite, onOpen, linkState }) {
  const visual = getEventVisual(event, index);
  const price = minPrice(event);
  const available = event.pricing?.totalAvailable;
  const hasTiers = Array.isArray(event.tiers) && event.tiers.length > 0;
  const soldOut = hasTiers && available === 0;
  const limited = hasTiers && available > 0 && available <= LOW_AVAILABILITY;
  const time = event.time ? formatEventTime(event.time) : '';

  const fallback = (e) => e.currentTarget.closest('.tl-tile-media')?.classList.add('is-broken');

  return (
    <article className="tl-tile">
      <Link to={`/events/${event.id}`} state={linkState} className="tl-tile-link" onClick={onOpen}>
        <div className="tl-tile-media">
          <img className="tl-tile-img" src={visual.image} alt="" loading={index < 3 ? 'eager' : 'lazy'} decoding="async" onError={fallback} />
          <span className="tl-tile-fallback" aria-hidden="true" style={{ backgroundImage: `url(${markUrl})` }} />
          <span className="tl-tile-flags">
            {event.featured && <span className="tl-tile-flag is-featured">Featured</span>}
            {(soldOut || limited) && <span className={`tl-tile-flag${soldOut ? ' is-soldout' : ''}`}>{soldOut ? 'Sold out' : `Only ${available} left`}</span>}
          </span>
          <span className="tl-tile-date">
            {formatEventDate(event.date)}
            {time ? ` • ${time} PKT` : ''}
          </span>
        </div>
        <div className="tl-tile-caption">
          <h2 className="tl-tile-title">{event.name}</h2>
          <p className="tl-tile-meta">
            <MapPin className="w-4 h-4" aria-hidden="true" /> {formatPlace(event.venue, event.city)}
          </p>
          {price && (
            <p className="tl-tile-price">
              {price === 'Free' ? <b>Free</b> : <>From <b>{price}</b></>}
            </p>
          )}
          <span className="tl-tile-go" aria-hidden="true"><ArrowRight className="w-5 h-5" /></span>
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
