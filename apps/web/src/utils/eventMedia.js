/**
 * Curated High-Resolution Event Artwork & Category Metadata
 * Inspired by DICE.fm, FeverUp, and Ticketmaster Europe editorial cards
 */

export const EVENT_VISUALS = {
  CRICKET_MATCH: {
    label: 'Championship Cricket',
    shortLabel: 'Cricket • PSL',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    accentColor: '#f59e0b',
    defaultImage: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=85',
    altImage: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?auto=format&fit=crop&w=1200&q=85',
  },
  MUSIC_CONCERT: {
    label: 'Live Arena Concert',
    shortLabel: 'Live Music',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    accentColor: '#f43f5e',
    defaultImage: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=85',
    altImage: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85',
  },
  MUSIC_FESTIVAL: {
    label: 'Headline Music Festival',
    shortLabel: 'Festival',
    badgeClass: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    accentColor: '#d946ef',
    defaultImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=85',
    altImage: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=85',
  },
  FOOTBALL_MATCH: {
    label: 'Premier Football',
    shortLabel: 'Football',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    accentColor: '#6366f1',
    defaultImage: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=85',
  },
  KABADDI: {
    label: 'International Kabaddi',
    shortLabel: 'Kabaddi',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    accentColor: '#f59e0b',
    defaultImage: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=85',
  },
  BOXING: {
    label: 'Championship Boxing',
    shortLabel: 'Fight Night',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    accentColor: '#f43f5e',
    defaultImage: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?auto=format&fit=crop&w=1200&q=85',
  },
};

export function getEventVisual(event, index = 0) {
  if (!event) return EVENT_VISUALS.MUSIC_CONCERT;
  const config = EVENT_VISUALS[event.eventType] || EVENT_VISUALS.MUSIC_CONCERT;
  const title = (event.title || '').toLowerCase();

  let imageUrl = event.bannerUrl || config.defaultImage;

  if (!event.bannerUrl) {
    if (title.includes('atif') || title.includes('lahore') && event.eventType === 'MUSIC_CONCERT') {
      imageUrl = 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=85';
    } else if (title.includes('karachi') || title.includes('festival')) {
      imageUrl = 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=85';
    } else if (title.includes('psl') || title.includes('qalandars') || title.includes('cricket')) {
      imageUrl = 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=85';
    } else if (index % 2 === 1 && config.altImage) {
      imageUrl = config.altImage;
    }
  }

  return {
    ...config,
    imageUrl,
  };
}
