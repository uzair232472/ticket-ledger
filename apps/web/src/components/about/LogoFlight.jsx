import React, { useEffect, useRef } from 'react';
import BrandLogo from '../brand/BrandLogo';

const SPIN_DEG_PER_S = 36; // idle 3D turn
const TILT_DEG = 8;
const MIN_WIDTH = 900; // below this the hero has no empty side, so the logo isn't shown

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // easeInOutCubic
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * About page: a large TicketLedger mark turning slowly in 3D in the hero's empty side. Scrolling down
 * flies it to the header, shrinking and turning to face front, until it sits exactly on the header's own
 * mark and hands over to it (the header mark is hidden until then, so it reads as one logo going home).
 * Scrolling back up sends it out again. Reduced motion: no idle turn (the scroll-driven move stays).
 *
 * `anchorRef` is an empty box in the hero that sets where and how big the logo starts.
 */
export default function LogoFlight({ anchorRef }) {
  const flyRef = useRef(null);

  useEffect(() => {
    const fly = flyRef.current;
    const anchor = anchorRef.current;
    const root = document.documentElement;
    if (!fly || !anchor) return undefined;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start = null; // anchor box in page coordinates
    let angle = 0;
    let last = performance.now();
    let raf = 0;

    const measure = () => {
      const r = anchor.getBoundingClientRect();
      start = { x: r.left + window.scrollX, y: r.top + window.scrollY, size: r.width };
      fly.style.width = `${r.width}px`;
      fly.style.height = `${r.width}px`;
    };
    // The header's mark: where the logo lands and how big it ends up
    const target = () => document.querySelector('[data-header-logo] .tl-brand-mark')?.getBoundingClientRect();

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const enabled = window.innerWidth >= MIN_WIDTH;
      root.classList.toggle('tl-logo-flight', enabled);
      if (!enabled || !start) {
        fly.style.visibility = 'hidden';
        return;
      }

      const t = target();
      // Finish the flight by the time the hero has scrolled about halfway past the logo
      const distance = Math.max(260, start.y + start.size * 0.35 - 80);
      const p = ease(clamp01(window.scrollY / distance));

      // Idle turn only while it rests in the hero; frozen during the flight so it lands without a jump
      if (p === 0 && !reduce) angle = (angle + SPIN_DEG_PER_S * dt) % 360;
      const home = angle > 180 ? 360 : 0;
      const ry = lerp(angle, home, p);
      const rx = lerp(reduce ? 0 : TILT_DEG, 0, p);

      const sx = start.x - window.scrollX + start.size / 2;
      const sy = start.y - window.scrollY + start.size / 2;
      const tx = t ? t.left + t.width / 2 : sx;
      const ty = t ? t.top + t.height / 2 : sy;
      const scale = t ? lerp(1, t.width / start.size, p) : 1 - p;
      const cx = lerp(sx, tx, p);
      const cy = lerp(sy, ty, p);

      const docked = p >= 0.999;
      root.classList.toggle('tl-logo-docked', docked);
      fly.style.visibility = docked ? 'hidden' : 'visible';
      fly.style.transform = `translate3d(${cx - start.size / 2}px, ${cy - start.size / 2}px, 0) scale(${scale}) perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      // The glow fades as it shrinks into the header
      fly.style.setProperty('--glow', String(1 - p));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(anchor);
    window.addEventListener('resize', measure);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      root.classList.remove('tl-logo-flight', 'tl-logo-docked');
    };
  }, [anchorRef]);

  return (
    <div ref={flyRef} className="tl-flylogo" aria-hidden="true">
      <BrandLogo variant="mark" label="" />
    </div>
  );
}
