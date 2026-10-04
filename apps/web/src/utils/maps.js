/** Google Maps link for an event's location: its exact pin when set, otherwise a search for venue + city. */
export const googleMapsUrl = ({ latitude, longitude, venue, city }) =>
  Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue, city, 'Pakistan'].filter(Boolean).join(', '))}`;
