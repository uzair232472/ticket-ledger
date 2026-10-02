import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { coverScene } from '../home/homeMotion';
import { stackSections } from '../motion/stackSections';

gsap.registerPlugin(ScrollTrigger);

const MOTION = '(prefers-reduced-motion: no-preference)';
// Reveal contexts created after mount (cards that load later), reverted with the page
const revealContexts = new WeakMap();

/**
 * Scroll scenes of the account pages (wallet, NFT tickets, orders): the same sticky-stage approach as the
 * homepage. Only the intro and section shells move; cards, forms and buttons are never pinned, and the
 * page dialogs live outside the stacked sections. Returns the gsap.matchMedia instance; .revert() on unmount.
 */
export function initAccountMotion(root) {
  const mm = gsap.matchMedia(root);
  const q = (sel) => root.querySelector(sel);
  const header = q('[data-home-header]');
  revealContexts.set(root, []);

  const tones = new Set();
  const setTone = (key, active) => {
    if (active) tones.add(key);
    else tones.delete(key);
    if (header) header.dataset.tone = tones.size ? 'light' : 'dark';
  };

  mm.add({ motion: MOTION }, (context) => {
    const { motion } = context.conditions;
    root.classList.toggle('tl-acct--motion', motion);
    const cleanups = [];

    // Light sections switch the header logo to its dark version until the next section reaches the header
    root.querySelectorAll('[data-header-light]').forEach((el, i) => {
      const next = el.nextElementSibling;
      ScrollTrigger.create({
        trigger: el,
        start: 'top 40px',
        ...(next ? { endTrigger: next, end: 'top 40px' } : { end: 'bottom 40px' }),
        onToggle: (self) => setTone(`light-${i}`, self.isActive),
      });
    });
    ScrollTrigger.create({
      trigger: q('.tl-footer'),
      start: 'top 80px',
      onToggle: (self) => {
        if (header) header.dataset.atFooter = String(self.isActive);
      },
    });
    cleanups.push(() => header && delete header.dataset.atFooter);

    const cleanup = () => {
      cleanups.forEach((fn) => fn());
      tones.clear();
      if (header) header.dataset.tone = 'dark';
      root.classList.remove('tl-acct--motion');
    };
    if (!motion) return cleanup;

    /* ---------- Intro: headline rises in, photo settles into a frame while scrolling ---------- */
    gsap.from('.tl-acct-title-line', { yPercent: 70, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.1, delay: 0.1 });
    gsap.from('.tl-acct-intro, .tl-acct-actions, .tl-acct-stat, .tl-acct-nav', { y: 24, opacity: 0, duration: 0.7, ease: 'power2.out', stagger: 0.07, delay: 0.4 });

    const track = q('.tl-acct-hero-track');
    gsap
      .timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: track,
          start: 'top top',
          // The last screen of the track is the hold while the first section slides over
          end: () => `+=${track.offsetHeight - 2 * window.innerHeight}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      })
      .fromTo('.tl-acct-hero-media img', { scale: 1.14 }, { scale: 1, duration: 1, ease: 'power1.out' }, 0)
      .fromTo('.tl-acct-hero-media', { clipPath: 'inset(0% 0% 0% 0% round 0px)' }, { clipPath: 'inset(4% 2.4% 4% 2.4% round 10px)', duration: 1, ease: 'power2.inOut' }, 0)
      .fromTo('.tl-acct-hero-dim', { opacity: 0 }, { opacity: 0.45, duration: 1 }, 0)
      .fromTo('.tl-acct-hero-copy', { yPercent: 0 }, { yPercent: -8, duration: 1 }, 0)
      .fromTo('.tl-acct-hero-progress', { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);

    const sections = [...root.querySelectorAll('[data-acct-section]')];
    if (sections[0]) coverScene(q('.tl-acct-hero-stage'), q('.tl-acct-hero-stage > .tl-cover-shade'), sections[0]);

    // Section headings rise in as they arrive
    root.querySelectorAll('[data-acct-head]').forEach((head) => {
      gsap.fromTo(
        head.children,
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, ease: 'power2.out', stagger: 0.08, scrollTrigger: { trigger: head, start: 'top 95%', end: 'top 60%', scrub: 0.5 } }
      );
    });

    // Each section slides over the previous one; no scaling, so dialogs and sticky children stay put
    cleanups.push(stackSections(root, sections, { scale: false }));

    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return cleanup;
  });

  const revert = mm.revert.bind(mm);
  mm.revert = () => {
    (revealContexts.get(root) || []).forEach((ctx) => ctx.revert());
    revealContexts.delete(root);
    revert();
  };
  return mm;
}

/**
 * Re-measure after content changes and reveal cards that are new since the last call
 * (elements marked with data-reveal; React replaces them when lists change).
 */
export function refreshAccountMotion(root) {
  if (!root) return;
  const fresh = [...root.querySelectorAll('[data-reveal]:not([data-revealed])')];
  if (fresh.length && window.matchMedia(MOTION).matches) {
    const ctx = gsap.context(() => {
      fresh.forEach((el) => {
        el.setAttribute('data-revealed', '');
        gsap.fromTo(
          el,
          { y: 48, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 94%', once: true } }
        );
      });
    }, root);
    revealContexts.get(root)?.push(ctx);
  }
  ScrollTrigger.refresh();
}
