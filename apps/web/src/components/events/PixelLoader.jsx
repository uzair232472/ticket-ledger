import React, { useEffect, useMemo, useRef, useState } from 'react';
import markUrl from '../../assets/ticketledger-mark.svg';
import './pixelloader.css';

const CELL = 82; // the reference grid uses ~82px squares
const TOTAL_MS = 1600;

/**
 * Page-entry transition: a grid of squares fills with the brand colour in random order while a
 * percentage counter runs, the logo badge appears, then the squares clear in random order.
 * Every square is a CSS animation (compositor-driven opacity), so it stays smooth while the new page
 * mounts underneath; only the counter uses a tiny requestAnimationFrame loop. Skipped for reduced motion.
 * Decorative: aria-hidden, never blocks content from assistive technology.
 */
export default function PixelLoader({ onDone }) {
  const countRef = useRef(null);
  const [done, setDone] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Random start offsets per square (fill in over 0.55s, clear over 0.4s)
  const cells = useMemo(() => {
    const cols = Math.ceil(Math.max(window.innerWidth, window.screen?.width || 0) / CELL);
    const rows = Math.ceil(Math.max(window.innerHeight, window.screen?.height || 0) / CELL);
    return { cols, list: Array.from({ length: cols * rows }, () => [Math.random() * 0.55, Math.random() * 0.4]) };
  }, []);

  useEffect(() => {
    if (done) {
      onDone?.();
      return undefined;
    }
    let raf;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 700);
      // ease in-out, like the original counter
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      if (countRef.current) countRef.current.textContent = `${Math.round(eased * 100)}%`;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const t = setTimeout(() => {
      setDone(true);
      onDone?.();
    }, TOTAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) return null;
  return (
    <div className="tl-px" aria-hidden="true" style={{ '--cols': cells.cols }}>
      <div className="tl-px-base" />
      <div className="tl-px-grid">
        {cells.list.map(([inAt, outAt], i) => (
          <span key={i} className="tl-px-cell" style={{ '--in': `${inAt.toFixed(3)}s`, '--out': `${outAt.toFixed(3)}s` }} />
        ))}
      </div>
      <div className="tl-px-center">
        <span ref={countRef} className="tl-px-count">0%</span>
        <span className="tl-px-badge" style={{ backgroundImage: `url(${markUrl})` }} />
      </div>
    </div>
  );
}
