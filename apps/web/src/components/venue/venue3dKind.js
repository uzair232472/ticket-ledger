/**
 * Which 3D scene a venue plan gets, or null for the 2D plan only.
 *   'stadium': cricket grounds (oval, stands, roofs, floodlights)
 *   'hall':    theatres, auditoriums and conference rooms: a stage or a screen with seated sections
 * `plan` is the layout data (sections + feature).
 */
export function venue3dKind(plan) {
  const kind = plan?.feature?.kind;
  if (kind === 'cricket') return 'stadium';
  if ((kind === 'stage' || kind === 'screen') && (plan.sections || []).some((s) => (s.booking || 'seats') === 'seats')) return 'hall';
  return null;
}

/** Words the 3D view uses for the venue and its parts. */
export const VENUE_WORDS = {
  stadium: { venue: 'ground', whole: 'Whole ground', part: 'stand', parts: 'Pavilions', choose: 'Choose a pavilion', view: '3D stadium', loading: 'Loading the 3D stadium' },
  hall: { venue: 'hall', whole: 'Whole hall', part: 'section', parts: 'Sections', choose: 'Choose a section', view: '3D hall', loading: 'Loading the 3D hall' },
};
