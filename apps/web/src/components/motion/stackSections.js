import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import './stack.css';

gsap.registerPlugin(ScrollTrigger);

/**
 * Stacked sections: each section sticks once its bottom edge reaches the bottom of the viewport (so tall
 * content scrolls fully into view first), and the following element slides up over it while it eases back
 * and darkens — the homepage's slide-over, applied to sections of any height.
 *
 * Uses CSS `position: sticky` (native scrolling, no scroll hijacking), so scrolling back up simply reverses
 * it. Call inside a gsap.matchMedia/context callback: the scrubbed timelines are reverted with it; the
 * returned function removes the observers and inline values this helper sets.
 *
 * - sections: elements that are siblings in one long parent (the sticky range is the parent's height)
 * - scale: also scale the covered section back; keep false when it contains `position: fixed` dialogs
 *   (a transformed ancestor would re-anchor them)
 */
export function stackSections(root, sections, { scale = true, baseZ = 10 } = {}) {
  const els = sections.filter(Boolean);
  if (!els.length) return () => {};

  const setStickTop = () =>
    els.forEach((el) => el.style.setProperty('--stick-top', `${Math.min(0, window.innerHeight - el.offsetHeight)}px`));

  // Measure the natural (unstuck) layout during ScrollTrigger refreshes: a stuck element's rect is offset
  // by the sticky position, which would put every trigger that uses it in the wrong place
  const onRefreshInit = () => root.classList.add('tl-stack-measuring');
  const onRefresh = () => root.classList.remove('tl-stack-measuring');
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit);
  ScrollTrigger.addEventListener('refresh', onRefresh);

  els.forEach((el, i) => {
    el.dataset.stacked = '';
    el.style.zIndex = String(baseZ + i);
    const next = el.nextElementSibling;
    if (next && !els.includes(next)) next.style.zIndex = String(baseZ + i + 1);
  });

  // Content height changes (data loading, accordions opening) move the sticky point
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      setStickTop();
      ScrollTrigger.refresh();
    });
  });
  els.forEach((el) => ro.observe(el));
  window.addEventListener('resize', setStickTop);
  setStickTop();

  els.forEach((el) => {
    const next = el.nextElementSibling;
    if (!next) return;
    const shade = el.querySelector(':scope > .tl-cover-shade');
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true },
    });
    if (scale) tl.fromTo(el, { scale: 1, transformOrigin: '50% 100%' }, { scale: 0.94 }, 0);
    if (shade) tl.fromTo(shade, { opacity: 0 }, { opacity: 0.6 }, 0);
  });

  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    window.removeEventListener('resize', setStickTop);
    ScrollTrigger.removeEventListener('refreshInit', onRefreshInit);
    ScrollTrigger.removeEventListener('refresh', onRefresh);
    root.classList.remove('tl-stack-measuring');
    els.forEach((el) => {
      delete el.dataset.stacked;
      el.style.removeProperty('--stick-top');
      el.style.zIndex = '';
      const next = el.nextElementSibling;
      if (next && !els.includes(next)) next.style.zIndex = '';
    });
  };
}
