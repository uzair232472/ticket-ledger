import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, ExternalLink, Link2, Loader2, MapPin, Search, X } from 'lucide-react';
import { CITY_COORDS } from '../home/EventMap';
import { googleMapsUrl } from '../../utils/maps';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const fix = (n) => Math.round(Number(n) * 1e6) / 1e6; // ~10 cm precision

export { googleMapsUrl };

/** Coordinates from a pasted Google Maps link (…/@31.52,74.35,17z, ?q=31.52,74.35, !3d31.52!4d74.35, ll=…). */
export function parseMapsLink(text) {
  const t = decodeURIComponent(String(text || '').trim());
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { latitude: fix(lat), longitude: fix(lng) };
    }
  }
  return null;
}

const pinIcon = L.divIcon({
  className: 'tl-lp-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [30, 42],
  iconAnchor: [15, 40],
});

/**
 * Exact venue location for an event, picked without leaving the form: search by name, click or drag the
 * pin on the map, or paste a Google Maps link. A "Google Maps view" tab shows the chosen point in an
 * embedded Google map, and the pin icon opens it in Google Maps.
 * `value`: { latitude, longitude, locationAddress } (nulls when not set).
 */
export default function LocationPicker({ value, onChange, venue, city }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const [view, setView] = useState('pick'); // pick | google
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');

  const has = value?.latitude != null && value?.longitude != null;

  // Pick a point: store it, then fill the address from a reverse lookup (keeps a typed address if it fails)
  const pick = async (lat, lng, address) => {
    const next = { latitude: fix(lat), longitude: fix(lng), locationAddress: address ?? valueRef.current?.locationAddress ?? null };
    changeRef.current(next);
    setMessage('');
    if (address) return;
    try {
      const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (data?.display_name) changeRef.current({ ...next, locationAddress: data.display_name });
    } catch {
      // The pin is what matters; the address is a convenience
    }
  };

  // Leaflet map (created once while the "pick" view is shown)
  useEffect(() => {
    if (view !== 'pick' || !mapEl.current || mapRef.current) return undefined;
    const start = has ? [value.latitude, value.longitude] : CITY_COORDS[(city || '').toLowerCase()] || [30.3753, 69.3451];
    const map = L.map(mapEl.current, { center: start, zoom: has ? 17 : CITY_COORDS[(city || '').toLowerCase()] ? 12 : 5, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    map.on('click', (e) => pick(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(mapEl.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Keep the pin in sync with the value
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!has) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const at = [value.latitude, value.longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(at, { icon: pinIcon, draggable: true, keyboard: false }).addTo(map);
      markerRef.current.on('dragend', (e) => {
        const p = e.target.getLatLng();
        pick(p.lat, p.lng);
      });
    } else {
      markerRef.current.setLatLng(at);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has, value?.latitude, value?.longitude, view]);

  // Move to the city when it changes and nothing is pinned yet
  useEffect(() => {
    const c = CITY_COORDS[(city || '').toLowerCase()];
    if (!has && c && mapRef.current) mapRef.current.setView(c, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  const search = async (e) => {
    e?.preventDefault();
    const q = (query.trim() || [venue, city].filter(Boolean).join(', ')).trim();
    if (!q) {
      setMessage('Type the venue name or address to search.');
      return;
    }
    setSearching(true);
    setMessage('');
    try {
      const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&countrycodes=pk&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      setResults(data);
      if (!data.length) setMessage('No places found. Try a shorter name, or click the exact spot on the map.');
    } catch {
      setMessage('Search is unavailable right now. Click the exact spot on the map instead.');
    } finally {
      setSearching(false);
    }
  };

  const choose = (r) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    pick(lat, lng, r.display_name);
    setResults(null);
    setView('pick');
    mapRef.current?.setView([lat, lng], 18);
  };

  const useLink = () => {
    const p = parseMapsLink(link);
    if (!p) {
      setMessage('That link has no coordinates. In Google Maps, press and hold (or right-click) the spot and copy the numbers, or use Share → Copy link from the place’s page.');
      return;
    }
    pick(p.latitude, p.longitude);
    setLink('');
    mapRef.current?.setView([p.latitude, p.longitude], 18);
  };

  return (
    <div className="tl-lp">
      <div className="tl-lp-head">
        <div>
          <strong>Exact location on the map</strong>
          <p>Pin the venue so attendees can find it and it shows at the right spot on the TicketLedger map.</p>
        </div>
        <div className="tl-lp-tabs" role="tablist" aria-label="Location view">
          <button type="button" role="tab" aria-selected={view === 'pick'} onClick={() => setView('pick')}><Crosshair className="w-4 h-4" /> Pick on map</button>
          <button type="button" role="tab" aria-selected={view === 'google'} onClick={() => setView('google')} disabled={!has} title={has ? undefined : 'Pin a location first'}>
            <MapPin className="w-4 h-4" /> Google Maps view
          </button>
        </div>
      </div>

      <div className="tl-lp-search" role="search">
        <label className="tl-lp-field">
          <Search className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">Search for the venue</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(e)}
            placeholder={[venue, city].filter(Boolean).join(', ') || 'Search venue or address'}
          />
        </label>
        <button type="button" className="tl-wz-btn" onClick={search} disabled={searching}>
          {searching ? <Loader2 className="w-4 h-4 tl-dash-spin" /> : <Search className="w-4 h-4" />} Find
        </button>
      </div>

      {results?.length > 0 && (
        <ul className="tl-lp-results" aria-label="Search results">
          {results.map((r) => (
            <li key={r.place_id}>
              <button type="button" onClick={() => choose(r)}>
                <MapPin className="w-4 h-4" aria-hidden="true" />
                <span>{r.display_name}</span>
              </button>
            </li>
          ))}
          <li><button type="button" className="tl-lp-results-close" onClick={() => setResults(null)}><X className="w-4 h-4" /> Close results</button></li>
        </ul>
      )}

      {view === 'pick' ? (
        <div className="tl-lp-map" ref={mapEl} role="application" aria-label="Map: click to place the venue pin, drag the pin to adjust" />
      ) : (
        <iframe
          className="tl-lp-map"
          title="Google Maps view of the pinned location"
          src={`https://maps.google.com/maps?q=${value.latitude},${value.longitude}&z=17&output=embed`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      )}

      <div className="tl-lp-link">
        <label className="tl-lp-field">
          <Link2 className="w-4 h-4" aria-hidden="true" />
          <span className="sr-only">Paste a Google Maps link</span>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                useLink();
              }
            }}
            placeholder="Or paste a Google Maps link / coordinates (e.g. 31.5135, 74.3332)" />
        </label>
        <button type="button" className="tl-wz-btn" onClick={useLink} disabled={!link.trim()}>Use link</button>
      </div>

      {message && <p className="tl-lp-msg" role="status">{message}</p>}

      <div className={`tl-lp-result${has ? ' is-set' : ''}`}>
        {has ? (
          <>
            <a href={googleMapsUrl(value)} target="_blank" rel="noreferrer" className="tl-lp-gmaps" title="Open this exact spot in Google Maps" aria-label="Open this exact spot in Google Maps">
              <MapPin className="w-5 h-5" />
            </a>
            <div>
              <strong>{venue || 'Pinned location'}</strong>
              <p>{value.locationAddress || `${value.latitude}, ${value.longitude}`}</p>
              <p className="tl-lp-coords">{value.latitude.toFixed(6)}, {value.longitude.toFixed(6)} <ExternalLink className="w-3 h-3" aria-hidden="true" /></p>
            </div>
            <button type="button" className="tl-lp-clear" onClick={() => changeRef.current({ latitude: null, longitude: null, locationAddress: null })}>
              <X className="w-4 h-4" /> Remove pin
            </button>
          </>
        ) : (
          <p>No pin yet: the event shows at the centre of {city || 'its city'} until you place one.</p>
        )}
      </div>
    </div>
  );
}
