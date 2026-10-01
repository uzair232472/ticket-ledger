import { fitRows } from './generate.js';

/**
 * Starting templates. They are editable suggestions, not certified plans of any real venue: the
 * organizer's saved configuration is what gets sold. Coordinates are in each layout's own design space.
 */

export const LAYOUT_VERSION = 1;

let counter = 0;
export const newSectionId = () => `sec_${Date.now().toString(36).slice(-5)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const seats = (name, shape, rows, extra = {}) => ({ id: newSectionId(), name, booking: 'seats', shape, rows, ...extra });
const ga = (name, shape, capacity, extra = {}) => ({ id: newSectionId(), name, booking: 'ga', shape, ga: { capacity }, ...extra });
const tables = (name, shape, t, extra = {}) => ({ id: newSectionId(), name, booking: 'tables', shape, tables: t, ...extra });
const arc = (cx, cy, r0, r1, a0, a1) => ({ type: 'arc', cx, cy, r0, r1, a0, a1 });
const rect = (x, y, w, h, rotation = 0) => ({ type: 'rect', x, y, w, h, rotation });

function cricket() {
  const c = 550;
  const names = ['Pavilion', 'VIP Enclosure', 'Gold Enclosure', 'Enclosure 1', 'Enclosure 2', 'Enclosure 3', 'Scoreboard End', 'Enclosure 4', 'Enclosure 5', 'Enclosure 6', 'Silver Enclosure', 'Premium Enclosure'];
  const hints = ['premium', 'premium', 'standard', 'value', 'value', 'value', 'value', 'value', 'value', 'value', 'standard', 'premium'];
  const lower = names.map((name, k) => {
    const a0 = -105 + k * 30 + 1;
    return seats(name, arc(c, c, 275, 405, a0, a0 + 28), { count: 13, rowSpacing: 9, seatSpacing: 8, aisles: [] }, { tierHint: hints[k], level: 1 });
  });
  const upper = [['Upper North', -90], ['Upper East', 0], ['Upper South', 90], ['Upper West', 180]].map(([name, mid]) =>
    seats(name, arc(c, c, 425, 520, mid - 38, mid + 38), { count: 10, rowSpacing: 9, seatSpacing: 8, aisles: [] }, { tierHint: 'value', level: 2 })
  );
  return {
    coordinate: { width: 1100, height: 1100 },
    feature: { kind: 'cricket', x: c, y: c, w: 500, h: 470, rotation: 0, label: 'Ground' },
    sections: [...lower, ...upper],
  };
}

function football() {
  const S = (name, x, y, w, rot, hint) => seats(name, rect(x, y, w, 130, rot), { count: 12, rowSpacing: 9.5, seatSpacing: 8, aisles: [] }, { tierHint: hint });
  const corner = (name, cx, cy, a0) => seats(name, arc(cx, cy, 70, 165, a0, a0 + 74), { count: 9, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'value' });
  return {
    coordinate: { width: 1100, height: 820 },
    feature: { kind: 'football', x: 550, y: 410, w: 540, h: 340, rotation: 0, label: 'Pitch' },
    sections: [
      S('Main Stand', 550, 660, 540, 0, 'premium'),
      S('Opposite Stand', 550, 160, 540, 180, 'standard'),
      S('West End', 160, 410, 340, 90, 'value'),
      S('East End', 940, 410, 340, 270, 'value'),
      corner('Corner North-West', 280, 240, 188),
      corner('Corner North-East', 820, 240, 278),
      corner('Corner South-East', 820, 580, 8),
      corner('Corner South-West', 280, 580, 98),
    ],
  };
}

function hockey() {
  return {
    coordinate: { width: 1100, height: 780 },
    feature: { kind: 'hockey', x: 550, y: 390, w: 520, h: 320, rotation: 0, label: 'Pitch' },
    sections: [
      seats('Main Stand', rect(550, 615, 520, 110, 0), { count: 10, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'premium' }),
      seats('Opposite Stand', rect(550, 165, 520, 110, 180), { count: 10, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'standard' }),
      seats('West Stand', rect(165, 390, 240, 100, 90), { count: 9, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'value' }),
      seats('East Stand', rect(935, 390, 240, 100, 270), { count: 9, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'value' }),
    ],
  };
}

function arena(kind) {
  const S = (name, x, y, rot, hint) => seats(name, rect(x, y, 360, 150, rot), { count: 14, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: hint });
  return {
    coordinate: { width: 1000, height: 1000 },
    feature: { kind, x: 500, y: 500, w: 220, h: 220, rotation: 0, label: kind === 'ring' ? 'Ring' : 'Court' },
    sections: [
      seats('Ringside North', rect(500, 355, 220, 50, 180), { count: 4, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'premium' }),
      seats('Ringside South', rect(500, 645, 220, 50, 0), { count: 4, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'premium' }),
      S('North Stand', 500, 230, 180, 'standard'),
      S('South Stand', 500, 770, 0, 'standard'),
      S('West Stand', 230, 500, 90, 'value'),
      S('East Stand', 770, 500, 270, 'value'),
    ],
  };
}

function concert() {
  return {
    coordinate: { width: 1000, height: 820 },
    feature: { kind: 'stage', x: 500, y: 85, w: 380, h: 90, rotation: 0, label: 'Stage' },
    sections: [
      ga('Fan Pit', rect(500, 215, 440, 120), 600, { tierHint: 'premium' }),
      seats('Left Block', rect(225, 420, 220, 200, 14), { count: 18, rowSpacing: 10, seatSpacing: 8, aisles: [] }, { tierHint: 'standard' }),
      seats('Centre Block', rect(500, 415, 260, 200, 0), { count: 18, rowSpacing: 10, seatSpacing: 8, aisles: [14] }, { tierHint: 'premium' }),
      seats('Right Block', rect(775, 420, 220, 200, -14), { count: 18, rowSpacing: 10, seatSpacing: 8, aisles: [] }, { tierHint: 'standard' }),
      ga('General Standing', rect(500, 690, 800, 150), 1500, { tierHint: 'value' }),
    ],
  };
}

function qawwali() {
  const c = [500, 40];
  return {
    coordinate: { width: 1000, height: 820 },
    feature: { kind: 'stage', x: 500, y: 80, w: 320, h: 80, rotation: 0, label: 'Stage' },
    sections: [
      seats('Front Rows', arc(...c, 105, 215, 52, 128), { count: 11, rowSpacing: 9.5, seatSpacing: 8 }, { tierHint: 'premium' }),
      seats('General Seating', arc(...c, 235, 400, 58, 122), { count: 16, rowSpacing: 10, seatSpacing: 8, aisles: [] }, { tierHint: 'value' }),
      tables('Majlis Tables West', rect(165, 360, 200, 280, 20), { count: 8, seatsPerTable: 6, columns: 2, mode: 'whole', seatSpacing: 9, spacing: 62 }, { tierHint: 'standard' }),
      tables('Majlis Tables East', rect(835, 360, 200, 280, -20), { count: 8, seatsPerTable: 6, columns: 2, mode: 'whole', seatSpacing: 9, spacing: 62 }, { tierHint: 'standard' }),
      ga('Back Standing', rect(500, 700, 700, 120), 600, { tierHint: 'value' }),
    ],
  };
}

function theatre() {
  const c = [500, 30];
  return {
    coordinate: { width: 1000, height: 640 },
    feature: { kind: 'stage', x: 500, y: 70, w: 440, h: 70, rotation: 0, label: 'Stage' },
    sections: [
      seats('Stalls Right', arc(...c, 110, 370, 55, 77), { count: 24, rowSpacing: 10, seatSpacing: 8, numbering: 'ltr' }, { tierHint: 'standard', level: 1 }),
      seats('Stalls Centre', arc(...c, 110, 370, 79, 101), { count: 24, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'premium', level: 1 }),
      seats('Stalls Left', arc(...c, 110, 370, 103, 125), { count: 24, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'standard', level: 1 }),
      seats('Side Right', arc(...c, 150, 330, 32, 50), { count: 16, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'value', level: 1 }),
      seats('Side Left', arc(...c, 150, 330, 130, 148), { count: 16, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'value', level: 1 }),
      seats('Balcony Right', arc(...c, 400, 540, 58, 88), { count: 12, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'value', level: 2 }),
      seats('Balcony Left', arc(...c, 400, 540, 92, 122), { count: 12, rowSpacing: 10, seatSpacing: 8 }, { tierHint: 'value', level: 2 }),
    ],
  };
}

function conference() {
  const B = (name, x, w, aisles, hint) => seats(name, rect(x, 410, w, 440, 0), { count: 26, rowSpacing: 14, seatSpacing: 9, aisles }, { tierHint: hint });
  return {
    coordinate: { width: 1000, height: 760 },
    feature: { kind: 'screen', x: 500, y: 70, w: 520, h: 60, rotation: 0, label: 'Stage & Screen' },
    sections: [B('Left Block', 225, 230, [], 'standard'), B('Centre Block', 500, 270, [14], 'premium'), B('Right Block', 775, 230, [], 'standard')],
  };
}

function general() {
  return {
    coordinate: { width: 1000, height: 760 },
    feature: { kind: 'stage', x: 500, y: 80, w: 400, h: 90, rotation: 0, label: 'Stage' },
    sections: [
      ga('Front Standing', { type: 'polygon', points: [[290, 150], [710, 150], [790, 330], [210, 330]] }, 800, { tierHint: 'premium' }),
      ga('General Floor', rect(500, 470, 680, 200), 2500, { tierHint: 'standard' }),
      ga('VIP Deck Left', rect(95, 260, 120, 220), 150, { tierHint: 'premium' }),
      ga('VIP Deck Right', rect(905, 260, 120, 220), 150, { tierHint: 'premium' }),
    ],
  };
}

function custom() {
  return { coordinate: { width: 1000, height: 700 }, feature: { kind: 'none' }, sections: [] };
}

export const TEMPLATES = {
  cricket: { label: 'Cricket ground', description: 'Oval ground ringed by named enclosures, with an upper tier.', build: cricket },
  football: { label: 'Football stadium', description: 'Pitch with side stands, end stands and corner sections.', build: football },
  hockey: { label: 'Hockey stadium', description: 'Hockey pitch with stands on all four sides.', build: hockey },
  arena: { label: 'Arena (court)', description: 'Central court with ringside seats and four stands.', build: () => arena('court') },
  ring: { label: 'Arena (ring)', description: 'Central ring with ringside seats and four stands.', build: () => arena('ring') },
  concert: { label: 'Concert', description: 'Stage, standing pit, seated blocks and a standing zone.', build: concert },
  qawwali: { label: 'Qawwali / mehfil', description: 'Stage-facing rows, table sections and general seating.', build: qawwali },
  theatre: { label: 'Theatre', description: 'Curved stalls, side sections and a balcony level.', build: theatre },
  conference: { label: 'Conference', description: 'Stage and screen with seating blocks and aisles.', build: conference },
  general: { label: 'General admission', description: 'Named standing zones sold by quantity.', build: general },
  custom: { label: 'Blank / uploaded plan', description: 'Start empty, optionally over your own venue plan image.', build: custom },
};

export const TEMPLATE_FOR_EVENT_TYPE = {
  CRICKET_MATCH: 'cricket',
  FOOTBALL_MATCH: 'football',
  HOCKEY_MATCH: 'hockey',
  KABADDI: 'arena',
  BOXING: 'ring',
  MUSIC_CONCERT: 'concert',
  MUSIC_FESTIVAL: 'general',
  QAWWALI: 'qawwali',
  THEATRE: 'theatre',
  CONFERENCE: 'conference',
  GENERAL_ADMISSION: 'general',
};

export const suggestTemplate = (eventType) => TEMPLATE_FOR_EVENT_TYPE[eventType] || 'concert';

/** Assigns tiers by each section's hint: premium → priciest tier, value → cheapest, standard → middle. */
export function assignTiers(layout, tiers = []) {
  if (!tiers.length) return layout;
  const sorted = [...tiers].sort((a, b) => Number(b.price) - Number(a.price));
  const pick = { premium: sorted[0], standard: sorted[Math.floor((sorted.length - 1) / 2)], value: sorted[sorted.length - 1] };
  return {
    ...layout,
    sections: layout.sections.map((s) => ({ ...s, tierId: s.tierId && tiers.some((t) => t.id === s.tierId) ? s.tierId : (pick[s.tierHint] || sorted[sorted.length - 1]).id })),
  };
}

export function buildTemplate(key, { tiers = [] } = {}) {
  const tpl = TEMPLATES[key] || TEMPLATES.custom;
  const base = tpl.build();
  const layout = {
    version: LAYOUT_VERSION,
    template: TEMPLATES[key] ? key : 'custom',
    coordinate: base.coordinate,
    background: null,
    feature: base.feature,
    sections: base.sections.map((s) => (s.booking === 'seats' ? fitRows(s) : s)),
  };
  return assignTiers(layout, tiers);
}
