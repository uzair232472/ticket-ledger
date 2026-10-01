import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import logoImg from '../../assets/ticketledger-logo.png';

const CELL = 82; // the reference grid uses ~82px squares

/**
 * Page-entry transition modelled on the reference loader: a grid of squares fills with the brand colour
 * in random order while a percentage counter runs, the logo badge appears, then the squares clear in
 * random order to reveal the page. Shortened to ~1.4s; skipped for reduced motion.
 * It is decorative: aria-hidden, and it never blocks content from assistive technology.
 */
export default function PixelLoader({ onDone }) {
  const rootRef = useRef(null);
  const [done, setDone] = useState(false);
  const grid = useMemo(() => {
    const cols = Math.ceil(window.innerWidth / CELL);
    const rows = Math.ceil(window.innerHeight / CELL);
    return { cols, rows, count: cols * rows };
  }, []);

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDone(true);
      onDone?.();
      return undefined;
    }
    const ctx = gsap.context(() => {
      const cells = gsap.utils.toArray('.tl-px-cell', rootRef.current);
      const counter = rootRef.current.querySelector('.tl-px-count');
      const badge = rootRef.current.querySelector('.tl-px-badge');
      const progress = { v: 0 };
      gsap
        .timeline({
          onComplete: () => {
            setDone(true);
            onDone?.();
          },
        })
        .to(cells, { opacity: 1, duration: 0.18, ease: 'none', stagger: { amount: 0.55, from: 'random' } }, 0)
        .to(progress, { v: 100, duration: 0.7, ease: 'power1.inOut', onUpdate: () => { counter.textContent = `${Math.round(progress.v)}%`; } }, 0)
        .to(counter, { opacity: 0, duration: 0.1 }, 0.72)
        .fromTo(badge, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.18, ease: 'power2.out' }, 0.72)
        .to(rootRef.current.querySelector('.tl-px-base'), { opacity: 0, duration: 0.01 }, 0.95)
        .to(badge, { opacity: 0, duration: 0.15 }, 1)
        .to(cells, { opacity: 0, duration: 0.16, ease: 'none', stagger: { amount: 0.4, from: 'random' } }, 0.95);
    }, rootRef);
    return () => ctx.revert();
  }, []);

  if (done) return null;
  return (
    <div ref={rootRef} className="tl-px" aria-hidden="true" style={{ '--cols': grid.cols }}>
      <div className="tl-px-base" />
      <div className="tl-px-grid">
        {Array.from({ length: grid.count }, (_, i) => (
          <span key={i} className="tl-px-cell" />
        ))}
      </div>
      <div className="tl-px-center">
        <span className="tl-px-count">0%</span>
        <span className="tl-px-badge" style={{ backgroundImage: `url(${logoImg})` }} />
      </div>
    </div>
  );
}
