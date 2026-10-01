/**
 * Requirements for organizer-uploaded event images, derived from the containers that display them.
 * Keep in sync with apps/web/src/utils/eventImageSpecs.js (the form shows the same values).
 *
 * - card:        Explore / related tiles (503:377), home cards (4:3) and the map hover card
 * - banner:      Event page hero; full width × max(600px, 72svh) on desktop (~2.2:1), full-height on phones
 * - galleryWide: Wide photo above the scrolling strip (1471:740 desktop, 373:349 phones)
 * - gallery:     Scrolling strip cards (539:550 desktop, 373:349 phones)
 */

const MB = 1024 * 1024;

export const RATIO_TOLERANCE = 0.1; // ±10% of the target ratio
export const MAX_DIMENSION = 8000; // px per side
export const MAX_PIXELS = 40_000_000;

export const EVENT_IMAGE_SPECS = {
  card: { label: 'Event Card Image', ratio: 4 / 3, ratioLabel: '4:3', recommended: [1600, 1200], min: [800, 600], maxBytes: 5 * MB, maxCount: 1 },
  banner: { label: 'Event Banner', ratio: 20 / 9, ratioLabel: '20:9', recommended: [2400, 1080], min: [1600, 720], maxBytes: 8 * MB, maxCount: 1 },
  galleryWide: { label: 'Gallery Wide Image', ratio: 2, ratioLabel: '2:1', recommended: [2400, 1200], min: [1400, 700], maxBytes: 8 * MB, maxCount: 1 },
  gallery: { label: 'Scrolling Gallery Images', ratio: 1, ratioLabel: '1:1', recommended: [1200, 1200], min: [700, 700], maxBytes: 5 * MB, maxCount: 12 },
  // Background for a custom venue plan: any ratio (kept as uploaded), sections are drawn over it
  venuePlan: { label: 'Venue Plan', ratio: null, ratioLabel: 'any', recommended: [3000, 2000], min: [1000, 600], maxBytes: 10 * MB, maxCount: 1 },
};

export const LARGEST_IMAGE_BYTES = Math.max(...Object.values(EVENT_IMAGE_SPECS).map((s) => s.maxBytes));
