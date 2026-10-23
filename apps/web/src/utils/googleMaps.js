// Google Maps JavaScript API (Places) for picking venues. Needs VITE_GOOGLE_MAPS_API_KEY with the
// "Maps JavaScript API" and "Places API (New)" enabled; without a key, or if the key is refused, venue search
// falls back to OpenStreetMap.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let loading = null;
let refused = false;

/** Whether Google place search can be used (a key is set and Google hasn't refused it). */
export const googleMapsAvailable = () => Boolean(KEY) && !refused;

/** Loads the Maps JavaScript API once and resolves with `google.maps`. */
export function loadGoogleMaps() {
  if (!googleMapsAvailable()) return Promise.reject(new Error('Google Maps is not configured.'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const callback = '__tlGoogleMapsReady';
      window[callback] = () => resolve(window.google.maps);
      // Called by Google when the key is invalid, restricted or has no billing
      window.gm_authFailure = () => {
        refused = true;
        reject(new Error('Google Maps refused the API key.'));
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&libraries=places&region=PK&language=en&callback=${callback}`;
      script.async = true;
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Google Maps could not be loaded.'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Keyless embedded Google map of a point, for previews. */
export const googleEmbedUrl = (lat, lng, zoom = 16) => `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`;
