import { useEffect } from 'react';

const AWAY_TITLE = 'You’re the missing audience';
const DELAY_MS = 5000;

/**
 * When the visitor switches to another tab, the title changes after 5 seconds to a gentle nudge; the
 * moment they come back, the page's own title returns. The TicketLedger favicon stays in the tab.
 */
export default function AwayTitle() {
  useEffect(() => {
    let timer = null;
    let original = null;

    const onChange = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          original = document.title;
          document.title = AWAY_TITLE;
        }, DELAY_MS);
      } else {
        clearTimeout(timer);
        timer = null;
        if (original !== null && document.title === AWAY_TITLE) document.title = original;
        original = null;
      }
    };

    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      clearTimeout(timer);
      if (original !== null && document.title === AWAY_TITLE) document.title = original;
    };
  }, []);
  return null;
}
