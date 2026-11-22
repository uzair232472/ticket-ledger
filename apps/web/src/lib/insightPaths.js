/**
 * Addresses of the three insight pages shared by super admins and organizers. The pages are the same (the API
 * scopes them to the organizer's own events and hides the experimental AI figures from organizers); only the
 * address differs, so an organizer never sees "/admin/" in the address bar.
 */
export const INSIGHT_PAGES = {
  intent: 'purchase-intent',
  demand: 'demand-forecast',
  abandoned: 'abandoned-intents',
};

/** "/admin/<page>" for super admins, "/organizer/<page>" for everyone else. */
export const insightPath = (role, page) => `/${role === 'SUPER_ADMIN' ? 'admin' : 'organizer'}/${INSIGHT_PAGES[page]}`;
