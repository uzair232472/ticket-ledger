import { gaOf, generateSection, tablesOf } from './generate.js';

export * from './geometry.js';
export * from './generate.js';
export * from './templates.js';
export * from './validate.js';

/**
 * Every bookable position as the API stores it (one Seat row each). General-admission capacity
 * becomes unnumbered slots (row "GA") so the existing one-ticket-per-seat guarantees cover it too.
 */
export function layoutInventory(layout) {
  const out = [];
  for (const section of layout.sections || []) {
    const base = { sectionId: section.id, sectionName: section.name.trim(), tierId: section.tierId };
    if (section.booking === 'ga') {
      const capacity = Math.floor(gaOf(section).capacity);
      for (let n = 1; n <= capacity; n++) {
        out.push({ ...base, key: `${section.id}/GA/${n}`, row: 'GA', number: String(n), kind: 'GA_SLOT', tableKey: null, wholeTable: false, blocked: false });
      }
      continue;
    }
    const g = generateSection(section);
    const whole = section.booking === 'tables' && tablesOf(section).mode === 'whole';
    for (const s of g.seats) {
      out.push({
        ...base,
        key: s.key,
        row: s.row,
        number: s.number,
        kind: section.booking === 'tables' ? 'TABLE_SEAT' : 'SEAT',
        tableKey: s.tableKey || null,
        wholeTable: whole,
        blocked: s.blocked,
      });
    }
  }
  return out;
}
