import { rotate } from './geometry.js';
import { generateSection, rowsOf } from './generate.js';

/**
 * 3D stadium settings stored with the venue plan (VenueLayout.data). Everything is optional: a plan without
 * them shows in 3D with the defaults. They only change how the 3D view looks. The one exception is sight-screen
 * seats, which become ordinary blocked seats (rows.blocked), so the server enforces them like any blocked seat.
 *
 *   layout.view3d  = { teamName, teamColors: [primary, secondary], seatColors: 'tiers' | 'team' }
 *   section.view3d = { roof: boolean, hospitality: boolean, sightScreen: ['row:position', ...] }
 *                    (hospitality: drawn as glass-fronted boxes and offered as an upgrade; sightScreen: the seats this tool
 *                    blocked, so removing them never touches seats the organizer blocked by hand)
 */

export const VIEW3D_DEFAULTS = { teamName: '', teamColors: ['#16a34a', '#0f172a'], seatColors: 'tiers' };
export const TEAM_NAME_MAX = 40;
const HEX = /^#[0-9a-f]{6}$/i;

/** Stadium-wide 3D settings with defaults filled in and bad values dropped. */
export function view3dOf(layout) {
  const v = layout?.view3d || {};
  const colors = Array.isArray(v.teamColors) ? v.teamColors : [];
  return {
    teamName: typeof v.teamName === 'string' ? v.teamName.trim().slice(0, TEAM_NAME_MAX) : '',
    teamColors: [HEX.test(colors[0]) ? colors[0] : VIEW3D_DEFAULTS.teamColors[0], HEX.test(colors[1]) ? colors[1] : VIEW3D_DEFAULTS.teamColors[1]],
    seatColors: v.seatColors === 'team' ? 'team' : 'tiers',
  };
}

export const sectionView3d = (section) => ({ roof: Boolean(section?.view3d?.roof), hospitality: Boolean(section?.view3d?.hospitality) && (section?.booking || 'seats') === 'seats', sightScreen: Array.isArray(section?.view3d?.sightScreen) ? section.view3d.sightScreen : [] });

/** Problems with the 3D settings (same shape as validateLayout's issues). */
export function validateView3d(layout) {
  const issues = [];
  const v = layout?.view3d;
  if (!v) return issues;
  if (v.teamName != null && (typeof v.teamName !== 'string' || v.teamName.trim().length > TEAM_NAME_MAX)) issues.push({ level: 'error', message: `The team name for the 3D view can be at most ${TEAM_NAME_MAX} characters.` });
  if (v.teamColors != null && (!Array.isArray(v.teamColors) || v.teamColors.some((c) => !HEX.test(c)))) issues.push({ level: 'warning', message: 'A team colour for the 3D view is not a valid colour; the default is used.' });
  return issues;
}

/**
 * Seats a cricket ground's sight screens hide: lower-level seated sections, the front half of their rows, inside
 * the screens' width as seen from the middle of the ground. Returns { sectionId: ['row:position', ...] }.
 * The screens sit at both ends of the pitch (the playing area's depth axis), as the 3D view draws them.
 */
export function sightScreenSeats(layout) {
  const f = layout?.feature;
  const out = {};
  if (!f || f.kind !== 'cricket' || !Number.isFinite(f.x) || !(f.w > 0) || !(f.h > 0)) return out;
  const halfLen = f.h / 2, halfScreen = f.w * 0.075;
  for (const section of layout.sections || []) {
    if ((section.booking || 'seats') !== 'seats' || (section.level || 1) !== 1) continue;
    const frontRows = Math.ceil(rowsOf(section).count / 2);
    const hits = [];
    for (const s of generateSection(section).seats) {
      if (s.rowIndex >= frontRows) continue;
      const [lx, ly] = rotate([s.x - f.x, s.y - f.y], -(Number(f.rotation) || 0));
      if (Math.abs(ly) < halfLen * 0.9) continue;
      // The screen's width, widening with distance (a cone from the middle of the ground)
      if (Math.abs(lx) <= halfScreen * (Math.abs(ly) / (halfLen * 0.975))) hits.push(`${s.rowIndex}:${s.position}`);
    }
    if (hits.length) out[section.id] = hits;
  }
  return out;
}

/** Blocks (on = true) or unblocks the sight-screen seats. Seats blocked by hand are never unblocked. */
export function applySightScreens(layout, on) {
  const hits = on ? sightScreenSeats(layout) : {};
  return {
    ...layout,
    sections: (layout.sections || []).map((section) => {
      const v = sectionView3d(section);
      const before = new Set((section.rows?.blocked || []).map(String));
      for (const k of v.sightScreen) before.delete(k);
      const mine = (hits[section.id] || []).filter((k) => !before.has(k)); // already blocked by hand: leave as the organizer's
      if (!v.sightScreen.length && !mine.length) return section;
      const view3d = { ...(section.view3d || {}), sightScreen: mine };
      if (!mine.length) delete view3d.sightScreen;
      return { ...section, rows: { ...(section.rows || {}), blocked: [...before, ...mine] }, view3d };
    }),
  };
}

/** Number of seats currently blocked by the sight-screen tool. */
export const sightScreenCount = (layout) => (layout?.sections || []).reduce((n, s) => n + sectionView3d(s).sightScreen.length, 0);

/** Seats per hospitality box (boxes are drawn every this many seats along a row). */
export const BOX_SEATS = 4;
