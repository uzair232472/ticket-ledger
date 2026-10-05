import { useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

// Places that scroll on their own (lists, popovers, dialogs, the active map) keep native wheel scrolling
const OWN_SCROLL = '[data-lenis-prevent], .tl-sel-list, .tl-menu-panel, .tl-hacc-pop, .tl-dlg-overlay, .tl-ok-overlay, .tl-lp-results, .tl-ve-sections, .tl-ve-inspector';

/**
 * Lenis smooth scrolling for the whole app, driving GSAP ScrollTrigger so every scroll-scrubbed scene
 * moves with it. Paused while the page is scroll-locked (menu, dialogs); touch keeps native scrolling;
 * off for reduced motion. `window.__lenis` lets other code jump instantly (e.g. on route changes).
 */
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      syncTouch: false,
      allowNestedScroll: true,
      prevent: (node) => Boolean(node?.closest?.(OWN_SCROLL)),
    });
    window.__lenis = lenis;

    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // The site menu and dialogs lock the page with overflow: hidden on <body>; pause Lenis meanwhile
    const sync = () => (document.body.style.overflow === 'hidden' ? lenis.stop() : lenis.start());
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] });

    return () => {
      mo.disconnect();
      gsap.ticker.remove(tick);
      lenis.destroy();
      if (window.__lenis === lenis) delete window.__lenis;
    };
  }, []);
  return null;
}
