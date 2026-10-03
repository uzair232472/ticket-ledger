// Media and static content for the homepage scenes.
// Photos are from Unsplash (free to use under the Unsplash License) and were already used in this project.

const unsplash = (id, w, h) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ''}&q=70`;

export const HERO_IMAGE = {
  src: unsplash('1540747913346-19e32dc3e97e', 1920),
  srcSet: [960, 1440, 1920].map((w) => `${unsplash('1540747913346-19e32dc3e97e', w)} ${w}w`).join(', '),
  alt: 'Floodlit cricket stadium at night',
};

// Eight tiles around the hero panel (3×3 grid, centre cell reserved for the panel)
export const COLLAGE_IMAGES = [
  '1501386761578-eac5c94b800a',
  '1514525253161-7a46d19cd819',
  '1470229722913-7c0e2dbbafd3',
  '1531415074968-036ba1b575da',
  '1549719386-74dfcbf7dbed',
  '1459749411175-04bf5292ceea',
  '1470225620780-dba8ba36b745',
  '1540039155733-5bb30b53aa14',
].map((id) => unsplash(id, 640, 480));

// Shared background of the featured-events and closing scenes (kept identical so the handoff is seamless)
export const STAGE_IMAGE = unsplash('1470229722913-7c0e2dbbafd3', 1920);

// Event types that exist in the database (EventType enum), with TicketLedger greens from light to dark
// `image` shows tinted with the panel colour, and in its original colours when the panel is hovered or focused.
// There is no kabaddi-specific photo, so Kabaddi uses a generic floodlit sports field.
export const CATEGORIES = [
  { type: 'CRICKET_MATCH', name: 'Cricket', panel: '#86efac', strip: '#bbf7d0', ink: '#052e16', image: unsplash('1531415074968-036ba1b575da', 640, 640) },
  { type: 'MUSIC_CONCERT', name: 'Live Music', panel: '#4ade80', strip: '#86efac', ink: '#052e16', image: unsplash('1540039155733-5bb30b53aa14', 640, 640) },
  { type: 'MUSIC_FESTIVAL', name: 'Festivals', panel: '#22c55e', strip: '#4ade80', ink: '#052e16', image: unsplash('1514525253161-7a46d19cd819', 640, 640) },
  { type: 'FOOTBALL_MATCH', name: 'Football', panel: '#16a34a', strip: '#15803d', ink: '#ffffff', image: unsplash('1522778119026-d647f0596c20', 640, 640) },
  { type: 'KABADDI', name: 'Kabaddi', panel: '#15803d', strip: '#166534', ink: '#ffffff', image: unsplash('1431324155629-1a6deb1dec8d', 640, 640) },
  { type: 'BOXING', name: 'Boxing', panel: '#14532d', strip: '#0f3d22', ink: '#ffffff', image: unsplash('1549719386-74dfcbf7dbed', 640, 640) },
];

// Caterpillar cursor trail on the closing section: circle diameters (px), lead circle first
export const TRAIL_SIZES = [112, 88, 68, 52, 38, 26];

// Categories without a homepage panel (the home scenes keep their six panels); listed on Explore
// They reuse photos already in this project and continue the green scale on the All Categories page.
export const MORE_CATEGORIES = [
  { type: 'HOCKEY_MATCH', name: 'Hockey', panel: '#bbf7d0', strip: '#dcfce7', ink: '#052e16', image: unsplash('1540747913346-19e32dc3e97e', 640, 640) },
  { type: 'QAWWALI', name: 'Qawwali', panel: '#4ade80', strip: '#86efac', ink: '#052e16', image: unsplash('1501386761578-eac5c94b800a', 640, 640) },
  { type: 'THEATRE', name: 'Theatre', panel: '#16a34a', strip: '#15803d', ink: '#ffffff', image: unsplash('1459749411175-04bf5292ceea', 640, 640) },
  { type: 'CONFERENCE', name: 'Conferences', panel: '#166534', strip: '#14532d', ink: '#ffffff', image: unsplash('1470225620780-dba8ba36b745', 640, 640) },
  { type: 'GENERAL_ADMISSION', name: 'General admission', panel: '#14532d', strip: '#0f3d22', ink: '#ffffff', image: unsplash('1470229722913-7c0e2dbbafd3', 640, 640) },
];
export const ALL_CATEGORIES = [...CATEGORIES, ...MORE_CATEGORIES];

export const categoryName = (type) => ALL_CATEGORIES.find((c) => c.type === type)?.name || 'Event';

// Number of strips in the shutter reveal (the reference uses 19 on desktop)
export const STRIP_COUNT = 19;
