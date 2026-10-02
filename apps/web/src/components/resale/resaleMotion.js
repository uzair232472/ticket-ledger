import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { coverScene, jumpToProgress } from '../home/homeMotion';
import { stackSections } from '../motion/stackSections';

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll scenes of the resale page, using the homepage's approach: CSS `position: sticky` stages inside
 * tall tracks (native document scrolling, no scroll hijacking) driven by scrubbed ScrollTrigger timelines.
 * Only editorial sections move; the listings, filters, FAQ buttons and purchase dialog are never pinned
 * or transformed.
 *
 * Returns the gsap.matchMedia instance; call .revert() on unmount (removes every trigger, listener and
 * inline style it created).
 */
export function initResaleMotion(root) {
  const mm = gsap.matchMedia(root);
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => gsap.utils.toArray(root.querySelectorAll(sel));
  const header = q('[data-home-header]');

  // Header tone: dark logo over light sections, white logo elsewhere (as on the homepage)
  const tones = new Set();
  const setTone = (key, active) => {
    if (active) tones.add(key);
    else tones.delete(key);
    if (header) header.dataset.tone = tones.size ? 'light' : 'dark';
  };

  mm.add(
    {
      motion: '(prefers-reduced-motion: no-preference)',
      // The pinned steps need room for all five rows; smaller screens get the plain list
      pinSteps: '(prefers-reduced-motion: no-preference) and (min-width: 900px) and (min-height: 700px)',
    },
    (context) => {
      const { motion, pinSteps } = context.conditions;
      root.classList.toggle('tl-resale--motion', motion);
      root.classList.toggle('tl-resale--pin-steps', pinSteps);
      const cleanups = [];
      const onFocusIn = (el, handler) => {
        if (!el) return;
        el.addEventListener('focusin', handler);
        cleanups.push(() => el.removeEventListener('focusin', handler));
      };

      // A light section ends where the next one reaches the header (sections overlap while pinned)
      qa('[data-header-light]').forEach((el, i) => {
        const next = el.nextElementSibling;
        ScrollTrigger.create({
          trigger: el,
          start: 'top 40px',
          ...(next ? { endTrigger: next, end: 'top 40px' } : { end: 'bottom 40px' }),
          onToggle: (self) => setTone(`light-${i}`, self.isActive),
        });
      });

      // The header logo steps aside once the footer (with its own large wordmark) reaches the header
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
        root.classList.remove('tl-resale--motion', 'tl-resale--pin-steps');
      };
      if (!motion) return cleanup;

      /* ---------- Hero: photo settles into a framed panel while the title lifts ---------- */
      const heroTrack = q('.tl-rs-hero-track');
      const heroStage = q('.tl-rs-hero-stage');
      const hero = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: heroTrack,
          start: 'top top',
          // The last screen of the track is the hold while the listings slide over
          end: () => `+=${heroTrack.offsetHeight - 2 * window.innerHeight}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
      hero
        .fromTo('.tl-rs-hero-media img', { scale: 1.14 }, { scale: 1, duration: 1, ease: 'power1.out' }, 0)
        .fromTo('.tl-rs-hero-media', { clipPath: 'inset(0% 0% 0% 0% round 0px)' }, { clipPath: 'inset(4% 2.4% 4% 2.4% round 10px)', duration: 1, ease: 'power2.inOut' }, 0)
        .fromTo('.tl-rs-hero-dim', { opacity: 0 }, { opacity: 0.45, duration: 1 }, 0)
        .fromTo('.tl-rs-hero-title', { yPercent: 0 }, { yPercent: -10, duration: 1 }, 0)
        .fromTo('.tl-rs-cta-ghost', { xPercent: 0 }, { xPercent: -18, duration: 1 }, 0)
        .fromTo('.tl-rs-hero-progress', { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0);

      // Opening reveal: the headline lines rise in once (time-based, not scroll-based)
      gsap.from('.tl-rs-cta-line', { yPercent: 70, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.1 });
      gsap.from('.tl-rs-hero-stat, .tl-rs-hero-actions, .tl-rs-hero-sub', { y: 24, opacity: 0, duration: 0.7, ease: 'power2.out', stagger: 0.08, delay: 0.45 });

      // Listings slide over the pinned hero
      coverScene(heroStage, q('.tl-rs-hero-stage > .tl-cover-shade'), q('.tl-rs-market'));

      // Listings heading rises in (the cards and filters themselves are never animated)
      gsap.set('.tl-rs-market-head > *', { y: 50, opacity: 0 });
      gsap.to('.tl-rs-market-head > *', {
        y: 0,
        opacity: 1,
        ease: 'power2.out',
        stagger: 0.08,
        scrollTrigger: { trigger: '.tl-rs-market-head', start: 'top 95%', end: 'top 60%', scrub: 0.5 },
      });

      /* ---------- How resale works: pinned, steps light up one after another ---------- */
      const stepRows = qa('.tl-rs-step');
      if (pinSteps) {
        const track = q('.tl-rs-steps-track');
        const n = stepRows.length;
        const steps = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: track,
            start: 'top top',
            // The last screen of the track is the hold while the FAQ slides over
            end: () => `+=${track.offsetHeight - 2 * window.innerHeight}`,
            scrub: 0.5,
            invalidateOnRefresh: true,
          },
        });
        steps.fromTo('.tl-rs-steps-fill', { scaleY: 0 }, { scaleY: 1, duration: n }, 0);
        stepRows.forEach((row, i) => {
          const parts = row.querySelectorAll('.tl-rs-step-num, .tl-rs-step-title, .tl-rs-step-copy');
          gsap.set(parts, { opacity: 0.22 });
          steps.to(parts, { opacity: 1, duration: 0.35, stagger: 0.04 }, i);
          steps.fromTo(row, { '--active': 0 }, { '--active': 1, duration: 0.35 }, i);
        });
        // Hold the finished list for a moment
        steps.to({}, { duration: 0.4 });

        // Keyboard focus on a step link jumps to the point where every step is readable
        onFocusIn(q('.tl-rs-steps-list'), () => jumpToProgress(steps.scrollTrigger, 0.97));
        coverScene(q('.tl-rs-steps'), q('.tl-rs-steps > .tl-cover-shade'), q('.tl-rs-faq'));
      } else {
        // Unpinned: rows rise in as they enter
        gsap.set(stepRows, { y: 40, opacity: 0 });
        ScrollTrigger.batch(stepRows, {
          start: 'top 92%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', stagger: 0.1 }),
        });
      }

      /* ---------- Stacked sections: each one slides up over the one before it ---------- */
      // Listings → how it works → FAQ → waitlist band → footer. When the steps are pinned they manage their
      // own stage, and the FAQ overlaps the end of their track instead.
      cleanups.push(
        stackSections(
          root,
          pinSteps
            ? [q('.tl-rs-market'), q('.tl-rs-faq'), q('.tl-rs-band')]
            : [q('.tl-rs-market'), q('.tl-rs-steps-track'), q('.tl-rs-faq'), q('.tl-rs-band')],
          { scale: window.matchMedia('(min-width: 640px)').matches }
        )
      );

      /* ---------- FAQ title and waitlist band ---------- */
      gsap.set('.tl-rs-faq-head > *', { y: 40, opacity: 0 });
      gsap.to('.tl-rs-faq-head > *', {
        y: 0,
        opacity: 1,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.tl-rs-faq', start: 'top 85%', end: 'top 45%', scrub: 0.5 },
      });
      gsap.fromTo(
        '.tl-rs-band-title',
        { yPercent: 30, opacity: 0 },
        { yPercent: 0, opacity: 1, ease: 'power2.out', scrollTrigger: { trigger: '.tl-rs-band', start: 'top 90%', end: 'top 50%', scrub: 0.5 } }
      );

      document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return cleanup;
    }
  );

  return mm;
}
