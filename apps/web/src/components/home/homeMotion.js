import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Closing ticket geometry (SVG user units; see ClosingScene). The viewBox is 1000×600 centred on 0,0.
export const TICKET_HOLE_RADIUS = 64;
const VIEWBOX_W = 1000;
const VIEWBOX_H = 600;

/**
 * Scale at which the ticket's punch-hole covers the whole viewport.
 * The SVG uses preserveAspectRatio="xMidYMid meet", so 1 user unit = min(w/1000, h/600) px.
 */
const holeCoverScale = () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const unit = Math.min(w / VIEWBOX_W, h / VIEWBOX_H);
  const halfDiagonal = Math.hypot(w / 2, h / 2) / unit;
  return (halfDiagonal / TICKET_HOLE_RADIUS) * 1.04;
};

/**
 * Staggered from→to inside scrubbed animations. A staggered fromTo only pre-renders its first target, so the
 * starting state is set explicitly on every target (reverted with the matchMedia context).
 */
const staggerTo = (tl, targets, fromVars, toVars, position) => {
  gsap.set(targets, fromVars);
  return tl.to(targets, toVars, position);
};

/**
 * While `next` slides up over a pinned scene, the scene eases back and darkens (scrubbed by scroll).
 */
const coverScene = (scene, shade, next) => {
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true },
  });
  tl.fromTo(scene, { scale: 1 }, { scale: 0.93 }, 0);
  if (shade) tl.fromTo(shade, { opacity: 0 }, { opacity: 0.6 }, 0);
  return tl;
};

/**
 * Caterpillar trail: circles follow the pointer, each chasing the one ahead of it.
 * Runs on GSAP's ticker only while the pointer is over the readable closing section.
 */
const initTrail = (stage, dots, isReadable) => {
  const n = dots.length;
  const pts = dots.map(() => ({ x: 0, y: 0 }));
  const setX = dots.map((d) => gsap.quickSetter(d, 'x', 'px'));
  const setY = dots.map((d) => gsap.quickSetter(d, 'y', 'px'));
  const target = { x: 0, y: 0 };
  let running = false;
  let visible = false;

  const show = (on) => {
    if (on === visible) return;
    visible = on;
    gsap.to(dots, { opacity: on ? 1 : 0, duration: 0.3, stagger: on ? 0.03 : 0, overwrite: 'auto' });
  };
  const tick = () => {
    for (let i = 0; i < n; i++) {
      const lead = i === 0 ? target : pts[i - 1];
      pts[i].x += (lead.x - pts[i].x) * (i === 0 ? 0.32 : 0.2);
      pts[i].y += (lead.y - pts[i].y) * (i === 0 ? 0.32 : 0.2);
      setX[i](pts[i].x);
      setY[i](pts[i].y);
    }
    const tail = pts[n - 1];
    if (Math.abs(tail.x - target.x) < 0.3 && Math.abs(tail.y - target.y) < 0.3) {
      gsap.ticker.remove(tick);
      running = false;
    }
  };
  const onMove = (e) => {
    const r = stage.getBoundingClientRect();
    target.x = e.clientX - r.left;
    target.y = e.clientY - r.top;
    if (!visible) pts.forEach((p) => { p.x = target.x; p.y = target.y; });
    show(isReadable());
    if (!running) {
      running = true;
      gsap.ticker.add(tick);
    }
  };
  const onLeave = () => show(false);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerleave', onLeave);
  return () => {
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerleave', onLeave);
    gsap.ticker.remove(tick);
  };
};

/** Jump (without animation) to a point inside a scrubbed scene, e.g. when keyboard focus lands in it. */
const jumpToProgress = (trigger, progress) => {
  window.scrollTo({ top: trigger.start + (trigger.end - trigger.start) * progress, behavior: 'instant' });
};

/**
 * Sets up every scroll-driven scene of the homepage inside `root`.
 * Returns the gsap.matchMedia instance; call .revert() on unmount.
 *
 * All transformations are scrubbed by scroll distance (ScrollTrigger scrub): scrolling down advances,
 * stopping holds, scrolling up reverses. Stages are pinned with CSS `position: sticky` inside tall tracks,
 * so the page keeps native document scrolling.
 */
export function initHomeMotion(root) {
  const mm = gsap.matchMedia(root);
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => gsap.utils.toArray(root.querySelectorAll(sel));
  const header = q('[data-home-header]');

  // Header tone: dark logo over light scenes, white logo elsewhere
  const tones = new Set();
  const setTone = (key, active) => {
    if (active) tones.add(key);
    else tones.delete(key);
    if (header) header.dataset.tone = tones.size ? 'light' : 'dark';
  };

  mm.add(
    {
      motion: '(min-width: 0px)',
    },
    (context) => {
      const motion = true;
      root.classList.add('tl-home--motion');
      const cleanups = [];
      const onFocusIn = (el, handler) => {
        if (!el) return;
        el.addEventListener('focusin', handler);
        cleanups.push(() => el.removeEventListener('focusin', handler));
      };

      ScrollTrigger.create(
        motion
          ? { trigger: q('.tl-cat-track'), start: 'top 40px', endTrigger: q('.tl-feature'), end: 'top top', onToggle: (self) => setTone('categories', self.isActive) }
          : { trigger: q('.tl-categories'), start: 'top 40px', end: 'bottom 40px', onToggle: (self) => setTone('categories', self.isActive) }
      );

      // The header logo steps aside once the footer (with its own large wordmark) reaches the header,
      // and returns when scrolling back up
      ScrollTrigger.create({
        trigger: q('.tl-footer'),
        start: 'top 80px',
        // Default end ("bottom top") lies beyond the last scroll position, so it stays active at the very bottom
        onToggle: (self) => {
          if (header) header.dataset.atFooter = String(self.isActive);
        },
      });
      cleanups.push(() => header && delete header.dataset.atFooter);



      /* ---------- Scene 1: pinned hero ---------- */
      const heroTrack = q('.tl-hero-track');
      const stage = q('.tl-hero-stage');
      const panel = q('.tl-hero-panel');
      const centerCell = q('.tl-collage-center');
      const wordmark = q('.tl-wordmark');
      const headerLogo = header?.querySelector('[data-header-logo]');
      const lead = q('.tl-hero-lead');
      const intro = q('.tl-hero-intro');
      const introWords = qa('.tl-intro-word');
      const introCta = q('.tl-hero-intro-cta');

      // Centre-cell rectangle as a clip-path inset (layout values, unaffected by transforms)
      const panelInset = () => {
        const w = stage.offsetWidth;
        const h = stage.offsetHeight;
        const t = (centerCell.offsetTop / h) * 100;
        const l = (centerCell.offsetLeft / w) * 100;
        const b = ((h - centerCell.offsetTop - centerCell.offsetHeight) / h) * 100;
        const r = ((w - centerCell.offsetLeft - centerCell.offsetWidth) / w) * 100;
        return `inset(${t}% ${r}% ${b}% ${l}%)`;
      };

      // Where the giant wordmark lands: over the text part of the header logo
      const logoTarget = () => {
        const logo = headerLogo?.querySelector('img');
        if (!logo) return { x: 0, y: -200, scale: 0.2 };
        const lr = logo.getBoundingClientRect();
        const textLeft = lr.left + lr.width * 0.235;
        const textWidth = lr.width * 0.765;
        const scale = textWidth / wordmark.offsetWidth;
        return {
          x: textLeft - wordmark.offsetLeft,
          y: lr.top + lr.height * 0.06 - wordmark.offsetTop,
          scale,
        };
      };

      const hero = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: heroTrack,
          start: 'top top',
          end: () => `+=${heroTrack.offsetHeight - 2 * window.innerHeight}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
      hero
        .to(lead, { opacity: 0, y: -48, duration: 0.16, ease: 'power1.in' }, 0)
        .fromTo(panel, { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: panelInset, duration: 0.5, ease: 'power2.inOut' }, 0.04)
        .fromTo('.tl-hero-panel img', { scale: 1.12 }, { scale: 1, duration: 0.5, ease: 'power1.out' }, 0.04)
        .fromTo('.tl-hero-panel-dim', { opacity: 0 }, { opacity: 0.62, duration: 0.4 }, 0.16)
        .fromTo('.tl-collage-tile img', { scale: 1.3 }, { scale: 1, duration: 0.58, ease: 'power1.out' }, 0.04)
        .fromTo('.tl-collage-shade', { opacity: 0.85 }, { opacity: 0.3, duration: 0.5 }, 0.08)
        .to(
          wordmark,
          { x: () => logoTarget().x, y: () => logoTarget().y, scale: () => logoTarget().scale, duration: 0.34, ease: 'power2.inOut' },
          0.06
        )
        // The intro composition appears inside the shrunken panel, then brightens word by word
        .fromTo(intro, { opacity: 0 }, { opacity: 1, duration: 0.08 }, 0.36);
      staggerTo(hero, introWords, { opacity: 0.14 }, { opacity: 1, duration: 0.06, stagger: 0.011 }, 0.42);
      hero
        // autoAlpha: the button is also unclickable and unfocusable until it is visible
        .fromTo(introCta, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.06 }, 0.42 + 0.011 * introWords.length)
        .to(wordmark, { opacity: 0, duration: 0.04 }, 0.38)
        .fromTo(headerLogo, { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.38)
        // Hold the finished composition before the next scene scrolls in
        .to({}, { duration: 0.18 });

      // Focus inside a faded group moves the scene to where that group is readable
      onFocusIn(lead, () => jumpToProgress(hero.scrollTrigger, 0));
      onFocusIn(q('.tl-hero-intro'), () => jumpToProgress(hero.scrollTrigger, 0.95));

      // Categories slide over the pinned hero
      coverScene(stage, q('.tl-hero-stage .tl-cover-shade'), q('.tl-cat-track'));

      /* ---------- Scene 2: category panels rise in ---------- */
      gsap.set('.tl-category', { yPercent: 18, opacity: 0 });
      gsap.to(
        '.tl-category',
        {
          yPercent: 0,
          opacity: 1,
          ease: 'power2.out',
          stagger: 0.06,
          scrollTrigger: { trigger: '.tl-category-grid', start: 'top 92%', end: 'top 55%', scrub: 0.5 },
        }
      );

      const wide = gsap.matchMedia();
      wide.add('(min-width: 640px)', () => {
        coverScene(q('.tl-categories'), q('.tl-categories .tl-cover-shade'), q('.tl-feature'));
      });
      cleanups.push(() => wide.revert());

      /* ---------- Scene 3: horizontal-strip reveal ---------- */
      // Strips cover the background as the section rises (a solid green block), then collapse
      // toward their bottom edges one after another, top strip first.
      const feature = q('.tl-feature');
      const strips = qa('.tl-feature .tl-strip');
      gsap.set(strips, { scaleY: 1.06 });
      gsap.to(
        strips,
        {
          scaleY: 0,
          ease: 'none',
          duration: 1,
          stagger: { each: 0.055 },
          scrollTrigger: {
            trigger: feature,
            start: 'top top',
            end: () => `+=${window.innerHeight * 0.85}`,
            scrub: 0.4,
            invalidateOnRefresh: true,
          },
        }
      );

      /* ---------- Scene 4: featured events over a darkening background ---------- */
      gsap.fromTo(
        '.tl-feature-dim',
        { opacity: 0.2 },
        { opacity: 0.8, ease: 'none', scrollTrigger: { trigger: '.tl-feature-head', start: 'top 80%', end: 'top 20%', scrub: true } }
      );
      gsap.set('.tl-feature-head > *', { y: 60, opacity: 0 });
      gsap.to(
        '.tl-feature-head > *',
        {
          y: 0,
          opacity: 1,
          ease: 'power2.out',
          stagger: 0.08,
          scrollTrigger: { trigger: '.tl-feature-head', start: 'top 95%', end: 'top 60%', scrub: 0.5 },
        }
      );

      // The featured block stays pinned (by its bottom edge, so tall content still fits) while the
      // full-screen map scene slides up over it
      const cardsBlock = q('.tl-cards-block');
      const mapScene = q('.tl-mapscene');
      ScrollTrigger.create({
        trigger: cardsBlock,
        start: 'bottom bottom',
        endTrigger: mapScene,
        end: 'top top',
        pin: true,
        pinSpacing: false,
        invalidateOnRefresh: true,
      });
      coverScene(q('.tl-cards-block-inner'), q('.tl-cards-block > .tl-cover-shade'), mapScene);

      /* ---------- Scene 5: zoom through the ticket punch-hole into the closing section ---------- */
      const closingTrack = q('.tl-closing-track');
      const ticket = q('.tl-ticket-g');
      const closingWords = qa('.tl-closing-word');
      const closingRest = qa('[data-closing-reveal]');
      const closingContent = q('.tl-closing-content');

      const closing = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: closingTrack,
          start: 'top top',
          end: () => `+=${closingTrack.offsetHeight - 2 * window.innerHeight}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
      closing
        .fromTo(ticket, { scale: 0.55, opacity: 0, rotation: -6, svgOrigin: '0 0' }, { scale: 1, opacity: 1, rotation: 0, svgOrigin: '0 0', duration: 0.12, ease: 'power2.out' }, 0)
        .to(ticket, { scale: holeCoverScale, svgOrigin: '0 0', duration: 0.36, ease: 'power3.in' }, 0.16)
        .fromTo('.tl-closing-green', { opacity: 0 }, { opacity: 1, duration: 0.08 }, 0.5)
        // The organizer content stays hidden until the green fill has arrived
        .fromTo(closingContent, { opacity: 0 }, { opacity: 1, duration: 0.02 }, 0.56)
        .set(ticket, { opacity: 0 }, 0.58);
      staggerTo(closing, closingWords, { opacity: 0.14 }, { opacity: 1, duration: 0.05, stagger: 0.012 }, 0.58);
      staggerTo(closing, closingRest, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.05, stagger: 0.02 }, 0.58 + 0.012 * closingWords.length);
      // Hold the readable organizer section before the footer slides over it
      closing.to({}, { duration: 0.14 });

      // The map scene (pinned at the end of the featured section) is covered by the closing scene,
      // and the closing scene by the footer
      coverScene(mapScene, q('.tl-mapscene > .tl-cover-shade'), closingTrack);
      coverScene(q('.tl-closing-stage'), q('.tl-closing-stage .tl-cover-shade'), q('.tl-footer'));

      // Caterpillar cursor trail over the readable organizer section
      const trailDots = qa('.tl-trail-dot');
      if (trailDots.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        cleanups.push(
          initTrail(q('.tl-closing-stage'), trailDots, () => Number(gsap.getProperty(closingContent, 'opacity')) > 0.6)
        );
      }

      onFocusIn(closingContent, () => jumpToProgress(closing.scrollTrigger, 0.82));

      ScrollTrigger.create({
        trigger: closingTrack,
        start: () => `top+=${(closingTrack.offsetHeight - 2 * window.innerHeight) * 0.52} top`,
        endTrigger: q('.tl-footer'),
        end: 'top 40px',
        invalidateOnRefresh: true,
        onToggle: (self) => setTone('closing', self.isActive),
      });

      // Measurements depend on fonts (wordmark width) and on the layout switch above
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      return () => {
        cleanups.forEach((fn) => fn());
        tones.clear();
        if (header) header.dataset.tone = 'dark';
        root.classList.remove('tl-home--motion');
      };
    }
  );

  return mm;
}

/** Re-measure after content that changes page height (e.g. events loaded). */
export const refreshScrollScenes = () => ScrollTrigger.refresh();
