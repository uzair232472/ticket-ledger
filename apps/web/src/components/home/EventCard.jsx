import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Heart, ArrowUpRight } from 'lucide-react';
import { getEventVisual } from '../../utils/eventMedia';
import { categoryName } from './homeData';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';

// Only shown when the API reports this few seats left
const LOW_AVAILABILITY = 50;

// Many venues already include the city ("Gaddafi Stadium, Ferozepur Road, Lahore")
const formatPlace = (venue = '', city = '') =>
  city && !venue.toLowerCase().includes(city.toLowerCase()) ? `${venue}, ${city}` : venue || city;

const formatDate = (date) => formatEventDate(date);

export default function EventCard({ event, index, isFavorite, onToggleFavorite }) {
  const visual = getEventVisual(event, index);
  const minPrice = event.pricing?.minPrice;
  const available = event.pricing?.totalAvailable;
  const hasTiers = Array.isArray(event.tiers) && event.tiers.length > 0;
  const soldOut = hasTiers && available === 0;
  const limited = hasTiers && available > 0 && available <= LOW_AVAILABILITY;

  return (
    <article className="tl-card">
      <div className="tl-card-media">
        <img src={visual.image} alt="" loading="lazy" decoding="async" onError={(e) => e.currentTarget.classList.add('is-broken')} />
        {soldOut && <span className="tl-card-badge tl-card-badge--soldout">Sold out</span>}
        {limited && <span className="tl-card-badge">Only {available} left</span>}
        <span className="tl-card-type">{categoryName(event.type)}</span>
        <button
          type="button"
          className="tl-card-fav"
          aria-pressed={Boolean(isFavorite)}
          aria-label={isFavorite ? `Remove ${event.name} from saved events` : `Save ${event.name}`}
          onClick={() => onToggleFavorite(event.id)}
        >
          <Heart className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="tl-card-body">
        <h3 className="tl-card-title">{event.name}</h3>
        <p className="tl-card-meta">
          <CalendarDays className="w-4 h-4" aria-hidden="true" />
          <span>
            {formatDate(event.date)}
            {event.time ? ` · ${formatEventTime(event.time)} PKT` : ''}
          </span>
        </p>
        <p className="tl-card-meta">
          <MapPin className="w-4 h-4" aria-hidden="true" />
          <span>{formatPlace(event.venue, event.city)}</span>
        </p>

        <div className="tl-card-foot">
          <div className="tl-card-price">
            {minPrice != null ? (
              <>
                <small>From</small>
                <strong>PKR {Number(minPrice).toLocaleString('en-PK')}</strong>
              </>
            ) : (
              <small>Prices coming soon</small>
            )}
          </div>
          <Link to={`/events/${event.id}`} className="tl-btn tl-btn--green" aria-label={`${soldOut ? 'View' : 'Get tickets for'} ${event.name}`}>
            {soldOut ? 'View event' : 'Get tickets'}
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
