import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getEventVisual } from '../../utils/eventMedia';
import { categoryName } from './homeData';
import { formatEventDate, formatEventTime } from '../../utils/eventTime';

// City centres, for events without an exact map pin (pinned events use their own coordinates).
export const hasPin = (e) => Number.isFinite(e?.latitude) && Number.isFinite(e?.longitude);
export const CITY_COORDS = {
  lahore: [31.5204, 74.3587],
  karachi: [24.8607, 67.0011],
  islamabad: [33.6844, 73.0479],
  rawalpindi: [33.5651, 73.0169],
  multan: [30.1575, 71.5249],
  peshawar: [34.0151, 71.5249],
  faisalabad: [31.4504, 73.135],
  quetta: [30.1798, 66.975],
  hyderabad: [25.396, 68.3578],
  sialkot: [32.4945, 74.5229],
  gujranwala: [32.1877, 74.1945],
};

// Pakistan's extent (south-west / north-east corners)
const PAKISTAN_BOUNDS = [
  [23.7, 60.9],
  [37.0, 77.6],
];

const CATEGORY_ICON = {
  CRICKET_MATCH: '',
  MUSIC_CONCERT: '',
  MUSIC_FESTIVAL: '',
  FOOTBALL_MATCH: '',
  KABADDI: '',
  BOXING: '',
  HOCKEY_MATCH: '',
  QAWWALI: '',
  THEATRE: '',
  CONFERENCE: '',
  GENERAL_ADMISSION: '',
};

const formatDate = (date) => formatEventDate(date, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Several events in one city fan out around the city point by a fixed pixel distance (via the icon
 * anchor), so they stay separate and clickable at every zoom level without moving the location.
 */
const anchorFor = (index, total) => {
  if (total <= 1) return [22, 22];
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  const r = 26;
  return [22 - Math.cos(angle) * r, 22 - Math.sin(angle) * r];
};

/** Hover card, built with DOM nodes (textContent) so event data can never inject markup. */
const buildCard = (event, index) => {
  const card = document.createElement('div');
  card.className = 'tl-map-card';
  const img = document.createElement('img');
  img.src = getEventVisual(event, index).image;
  img.alt = '';
  img.onerror = () => img.classList.add('is-broken');
  const body = document.createElement('div');
  const type = document.createElement('span');
  type.className = 'tl-map-card-type';
  type.textContent = categoryName(event.type);
  const title = document.createElement('strong');
  title.textContent = event.name;
  const meta = document.createElement('span');
  meta.textContent = `${formatDate(event.date)}${event.time ? ` · ${formatEventTime(event.time)} PKT` : ''}`;
  const price = document.createElement('span');
  price.className = 'tl-map-card-price';
  price.textContent = event.pricing?.minPrice != null ? `From PKR ${Number(event.pricing.minPrice).toLocaleString('en-PK')}` : 'Prices coming soon';
  body.append(type, title, meta, price);
  card.append(img, body);
  return card;
};

/**
 * Dark map of Pakistan with one marker per event. Hover (or keyboard focus) shows a small card;
 * clicking a marker (or pressing Enter on it) opens the event page.
 * Wheel zoom is off so the page keeps scrolling over the map; on touch devices dragging is off too.
 */
export default function EventMap({ events }) {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const map = L.map(containerRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
      tap: false,
      attributionControl: true,
      minZoom: 4,
      zoomSnap: 0.25,
      // Deep zoom, so pinned venues can be seen at their exact building
      maxZoom: 18,
      maxBounds: L.latLngBounds(PAKISTAN_BOUNDS).pad(0.35),
    });
    // Leave room for the title and filter bar floating over the top of the map
    map.fitBounds(PAKISTAN_BOUNDS, { paddingTopLeft: [16, 190], paddingBottomRight: [16, 24] });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // OpenStreetMap tiles (no API key; attribution required). They are darkened with a CSS filter on the
    // tile pane only, so markers and hover cards keep their real colours.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Nearly opaque for a clearly readable map; the concert background still glows through slightly
      opacity: 0.92,
      className: 'tl-map-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The map can be measured before its pinned container has its final size
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Pinned events sit at their exact venue; the rest are grouped at their city centre and fanned out
    const byCity = new Map();
    events.forEach((e) => {
      const key = hasPin(e) ? `pin:${e.id}` : (e.city || '').trim().toLowerCase();
      if (!hasPin(e) && !CITY_COORDS[key]) return;
      if (!byCity.has(key)) byCity.set(key, []);
      byCity.get(key).push(e);
    });

    byCity.forEach((list, key) => {
      list.forEach((event, i) => {
        const at = hasPin(event) ? [event.latitude, event.longitude] : CITY_COORDS[key];
        const icon = L.divIcon({
          className: 'tl-map-marker',
          html: `<span aria-hidden="true">${CATEGORY_ICON[event.type] || '🎟️'}</span>`,
          iconSize: [44, 44],
          iconAnchor: anchorFor(i, list.length),
        });
        const marker = L.marker(at, {
          icon,
          keyboard: true,
          title: `${event.name}, ${event.city}`,
          alt: `${event.name}, ${event.city}`,
          riseOnHover: true,
        });
        marker.bindTooltip(buildCard(event, i), {
          direction: 'top',
          offset: [0, -24],
          className: 'tl-map-tooltip',
          opacity: 1,
        });
        marker.on('click', () => navigateRef.current(`/events/${event.id}`));
        marker.on('keypress', (ev) => {
          if (ev.originalEvent?.key === 'Enter') navigateRef.current(`/events/${event.id}`);
        });
        marker.addTo(layer);
        // Leaflet sets role="button" on keyboard markers; give it a useful accessible name
        marker.getElement()?.setAttribute('aria-label', `${event.name}, ${event.city}. Open event`);
      });
    });
  }, [events]);

  return <div ref={containerRef} className="tl-map" role="region" aria-label="Map of upcoming events in Pakistan" />;
}
