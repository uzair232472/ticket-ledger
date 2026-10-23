import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, MapPin, Search, X } from 'lucide-react';
import { CITY_COORDS } from '../home/EventMap';
import { googleMapsUrl } from '../../utils/maps';
import { googleEmbedUrl, googleMapsAvailable, loadGoogleMaps } from '../../utils/googleMaps';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const fix = (n) => Math.round(Number(n) * 1e6) / 1e6;

// Straight-line distance in km, to flag a place picked far from the event's city
function distanceKm([lat1, lng1], [lat2, lng2]) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Google Places (New) suggestions near the city. */
async function googleSuggestions(input, city, session) {
  await loadGoogleMaps();
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await window.google.maps.importLibrary('places');
  if (!session.current) session.current = new AutocompleteSessionToken();
  const center = CITY_COORDS[(city || '').toLowerCase()];
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: session.current,
    includedRegionCodes: ['pk'],
    language: 'en',
    ...(center ? { locationBias: { center: { lat: center[0], lng: center[1] }, radius: 30000 } } : {}),
  });
  return suggestions
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({ id: `google:${p.placeId}`, name: p.mainText?.text || p.text.text, detail: p.secondaryText?.text || '', prediction: p }));
}

/** Coordinates and address of a chosen Google suggestion (ends the billing session). */
async function googleDetails(item, session) {
  const place = item.prediction.toPlace();
  await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
  session.current = null;
  return {
    placeId: item.id,
    placeName: place.displayName || item.name,
    latitude: fix(place.location.lat()),
    longitude: fix(place.location.lng()),
    locationAddress: place.formattedAddress || item.detail || null,
  };
}

/** OpenStreetMap search (used without a Google key; run on Enter / Find, not per keystroke). */
async function osmResults(input, city) {
  const q = [input, city, 'Pakistan'].filter(Boolean).join(', ');
  const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=pk&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  return data
    .filter((r) => ['node', 'way', 'relation'].includes(r.osm_type))
    .map((r) => ({
      id: `osm:${r.osm_type}/${r.osm_id}`,
      name: r.name || r.display_name.split(',')[0],
      detail: r.display_name,
      place: { placeId: `osm:${r.osm_type}/${r.osm_id}`, placeName: r.name || r.display_name.split(',')[0], latitude: fix(r.lat), longitude: fix(r.lon), locationAddress: r.display_name },
    }));
}

/**
 * Venue for one prebooked date, picked from the map rather than typed: Google Maps place search (or
 * OpenStreetMap without a Google key) near the chosen city, then a Google map preview of the spot.
 * `value`: { placeId, placeName, latitude, longitude, locationAddress }; `onChange(place | null)`.
 * `legacyVenue` is a venue typed before venues were picked on the map, offered as the first search.
 */
export default function VenuePicker({ id, city, value, onChange, legacyVenue, error }) {
  const listId = useId();
  const session = useRef(null);
  const seq = useRef(0);
  const [google, setGoogle] = useState(googleMapsAvailable);
  const [query, setQuery] = useState(value?.placeId ? '' : legacyVenue || '');
  const [items, setItems] = useState(null);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const picked = Boolean(value?.placeId);

  const search = async (text, { typed = false } = {}) => {
    const q = text.trim();
    const n = ++seq.current;
    if (q.length < 2) {
      setItems(null);
      return;
    }
    if (!google && typed) return; // OpenStreetMap is searched on Enter / Find only
    setBusy(true);
    setMessage('');
    try {
      const found = google ? await googleSuggestions(q, city, session) : await osmResults(q, city);
      if (n !== seq.current) return;
      setItems(found);
      setActive(-1);
      if (!found.length) setMessage('No places found. Try the venue’s name as it appears on Google Maps, or a shorter name.');
    } catch {
      if (n !== seq.current) return;
      if (google && !googleMapsAvailable()) {
        // The key was refused: carry on with OpenStreetMap
        setGoogle(false);
        setMessage('Google search isn’t available right now, so results come from OpenStreetMap. Press Find to search.');
      } else {
        setMessage('Search is unavailable right now. Check your connection and try again.');
      }
      setItems(null);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  };

  // Google suggestions follow the typing (debounced)
  useEffect(() => {
    if (!google || picked) return undefined;
    const timer = setTimeout(() => search(query, { typed: true }), 300);
    return () => clearTimeout(timer);
  }, [query, google, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (item) => {
    setBusy(true);
    try {
      const place = item.place || (await googleDetails(item, session));
      onChange(place);
      setItems(null);
      setQuery('');
      setMessage('');
    } catch {
      setMessage('Couldn’t load that place. Try again or choose another result.');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && items?.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp' && items?.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items?.[active]) choose(items[active]);
      else search(query);
    } else if (e.key === 'Escape') {
      setItems(null);
    }
  };

  const center = CITY_COORDS[(city || '').toLowerCase()];
  const farKm = picked && center ? Math.round(distanceKm(center, [value.latitude, value.longitude])) : 0;

  if (picked) {
    return (
      <div className="tl-vp">
        <div className="tl-vp-chosen">
          <a href={googleMapsUrl(value)} target="_blank" rel="noreferrer" className="tl-lp-gmaps" title="Open in Google Maps" aria-label={`Open ${value.placeName} in Google Maps`}>
            <MapPin className="w-5 h-5" />
          </a>
          <div>
            <strong>{value.placeName}</strong>
            {value.locationAddress && <p>{value.locationAddress}</p>}
            <a href={googleMapsUrl(value)} target="_blank" rel="noreferrer" className="tl-vp-open">Open in Google Maps <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>
          </div>
          <button type="button" className="tl-lp-clear" onClick={() => onChange(null)}>
            <X className="w-4 h-4" /> Change venue
          </button>
        </div>
        {farKm > 60 && (
          <p className="tl-lp-msg" role="status">
            <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
            This place is about {farKm} km from {city}. Check it’s the right venue, or change the city above.
          </p>
        )}
        <iframe className="tl-vp-map" title={`Map of ${value.placeName}`} src={googleEmbedUrl(value.latitude, value.longitude)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      </div>
    );
  }

  return (
    <div className="tl-vp">
      <div className="tl-lp-search" role="search">
        <label className="tl-lp-field" style={error ? { borderColor: 'var(--st-rose)' } : undefined}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Search className="w-4 h-4" aria-hidden="true" />}
          <span className="sr-only">Search for the venue</span>
          <input
            id={id}
            type="search"
            role="combobox"
            aria-expanded={Boolean(items?.length)}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search a venue in ${city || 'Pakistan'}, e.g. Expo Centre`}
          />
        </label>
        {!google && (
          <button type="button" className="tl-wz-btn" onClick={() => search(query)} disabled={busy}>
            <Search className="w-4 h-4" /> Find
          </button>
        )}
      </div>

      {items?.length > 0 && (
        <ul className="tl-lp-results" id={listId} role="listbox" aria-label="Places">
          {items.map((item, i) => (
            <li key={item.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => choose(item)} className={i === active ? 'is-active' : undefined} tabIndex={-1}>
                <MapPin className="w-4 h-4" aria-hidden="true" />
                <span><strong>{item.name}</strong>{item.detail && <><br /><small>{item.detail}</small></>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && <p className="tl-lp-msg" role="status">{message}</p>}
      {legacyVenue && <p className="tl-wz-hint">You typed “{legacyVenue}” earlier. Pick it from the search results so its calendar can be checked.</p>}
      <p className="tl-wz-hint">{google ? 'Places from Google Maps.' : 'Places from OpenStreetMap.'} Picking the place from the map, not typing it, means every booking there is checked against the same calendar.</p>
    </div>
  );
}
