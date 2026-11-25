/**
 * Requirements for organizer-uploaded event images, derived from the containers that display them.
 * Keep in sync with apps/web/src/utils/eventImageSpecs.js (the form shows the same values).
 *
 * - card:        Explore / Wishlist event cards (3:2), Other Events, home cards and the map hover card
 * - banner:      Event page hero; full width × max(600px, 72svh) on desktop (~2.2:1), full-height on phones
 * - galleryWide: Event page details card photo, beside the Event Details / Venue Info tabs (3:2)
 * - gallery:     Event Gallery carousel thumbnails (3:2); the photo viewer shows them whole
 */

const MB = 1024 * 1024;

export const RATIO_TOLERANCE = 0.1; // ±10% of the target ratio
export const MAX_DIMENSION = 8000; // px per side
export const MAX_PIXELS = 40_000_000;

export const EVENT_IMAGE_SPECS = {
  card: { label: 'Event Card Image', ratio: 3 / 2, ratioLabel: '3:2', recommended: [1500, 1000], min: [900, 600], maxBytes: 5 * MB, maxCount: 1 },
  banner: { label: 'Event Banner', ratio: 20 / 9, ratioLabel: '20:9', recommended: [2400, 1080], min: [1600, 720], maxBytes: 8 * MB, maxCount: 1 },
  galleryWide: { label: 'Event Details Photo', ratio: 3 / 2, ratioLabel: '3:2', recommended: [1800, 1200], min: [1200, 800], maxBytes: 8 * MB, maxCount: 1 },
  gallery: { label: 'Event Gallery Images', ratio: 3 / 2, ratioLabel: '3:2', recommended: [1500, 1000], min: [900, 600], maxBytes: 5 * MB, maxCount: 12 },
  // Background for a custom venue plan: any ratio (kept as uploaded), sections are drawn over it
  venuePlan: { label: 'Venue Plan', ratio: null, ratioLabel: 'any', recommended: [3000, 2000], min: [1000, 600], maxBytes: 10 * MB, maxCount: 1 },
};

export const LARGEST_IMAGE_BYTES = Math.max(...Object.values(EVENT_IMAGE_SPECS).map((s) => s.maxBytes));

/**
 * Promo videos for the home page hero (organizer promotion requests). The hero fills the whole screen with
 * object-fit: cover, like TicketLedger's own hero films (1920 × 1080 landscape, 608 × 1080 portrait on
 * phones), so the edges can be cropped: keep text and logos in the middle. They play muted and on a loop.
 * Keep in sync with apps/web/src/utils/heroVideoSpecs.js (the request form shows the same values).
 */
export const HERO_VIDEO_SPECS = {
  desktop: { label: 'Hero video (desktop)', ratio: 16 / 9, ratioLabel: '16:9', recommended: [1920, 1080], min: [1280, 720], maxBytes: 30 * MB, maxSeconds: 60 },
  mobile: { label: 'Hero video (phones)', ratio: 9 / 16, ratioLabel: '9:16', recommended: [1080, 1920], min: [540, 960], maxBytes: 15 * MB, maxSeconds: 60 },
};
