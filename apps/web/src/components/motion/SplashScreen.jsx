import React, { useLayoutEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import './splash.css';

const STACKER_ITEMS = [
  { num: '01', title: 'SMART CONTRACT TICKETING', meta: 'POLYGON ERC-721' },
  { num: '02', title: '15S DYNAMIC QR PASS', meta: 'DUAL TURNSTILE VALIDATED' },
  { num: '03', title: 'FUTURISTIC ANTI-SCALP', meta: '110% RESALE CAP PROTOCOL' },
];

/**
 * High-End Minimalist Splash Screen for TicketLedger:
 * - White background with black text
 * - Heading: "Ticket Ledger" (masked text reveal with power4.out easing)
 * - Subheading: "Futuristic ticket booking system" (staggered reveal)
 * - Stacker animations using dynamic easings (back.out, expo.inOut)
 * - Smooth curtain slide exit revealing the live application.
 */
export default function SplashScreen({ onComplete }) {
  const rootRef = useRef(null);
  const timelineRef = useRef(null);
  const [visible, setVisible] = useState(() => {
    // Check if splash was already shown in this browser session (unless forced via ?splash=1)
    if (typeof window === 'undefined') return false;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('splash') === '1' || urlParams.get('splash') === 'true') {
      return true;
    }
    return !sessionStorage.getItem('tl_splash_seen');
  });

  const finish = useCallback(() => {
    sessionStorage.setItem('tl_splash_seen', 'true');
    document.body.style.overflow = '';
    setVisible(false);
    onComplete?.();
  }, [onComplete]);

  // Support replaying splash via window event
  useLayoutEffect(() => {
    const handleReplay = () => {
      setVisible(true);
    };
    window.addEventListener('tl:replay-splash', handleReplay);
    return () => window.removeEventListener('tl:replay-splash', handleReplay);
  }, []);

  useLayoutEffect(() => {
    if (!visible) return undefined;

    // Lock background scroll during splash
    document.body.style.overflow = 'hidden';

    // Check for reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return undefined;
    }

    const ctx = gsap.context(() => {
      const root = rootRef.current;
      if (!root) return;

      const words = root.querySelectorAll('.tl-splash-word');
      const sub = root.querySelector('.tl-splash-sub');
      const emblem = root.querySelector('.tl-splash-emblem');
      const corners = root.querySelectorAll('.tl-splash-corner');
      const cards = root.querySelectorAll('.tl-splash-card');
      const progressBar = root.querySelector('.tl-splash-progress-bar');
      const progressNum = root.querySelector('.tl-splash-progress-num');
      const curtainLeft = root.querySelector('.tl-splash-curtain--left');
      const curtainRight = root.querySelector('.tl-splash-curtain--right');
      const centerStage = root.querySelector('.tl-splash-stage');

      const counter = { val: 0 };
      const tl = gsap.timeline({
        onComplete: () => {
          finish();
        },
      });

      timelineRef.current = tl;

      // 1. Initial State Setup
      gsap.set(words, { yPercent: 120, opacity: 0, rotateX: -25 });
      gsap.set(sub, { yPercent: 110, opacity: 0 });
      gsap.set(emblem, { scale: 0.6, opacity: 0, rotate: -10 });
      gsap.set(corners, { opacity: 0 });
      gsap.set(cards, { y: 45, opacity: 0, scale: 0.85 });

      // 2. Corner telemetry subtle fade-in
      tl.to(corners, {
        opacity: 1,
        duration: 0.45,
        ease: 'power2.out',
        stagger: 0.05,
      }, 0.05);

      // 3. Brand Emblem entrance with elastic pop
      tl.to(emblem, {
        scale: 1,
        opacity: 1,
        rotate: 0,
        duration: 0.65,
        ease: 'back.out(1.8)',
      }, 0.1);

      // 4. Main Heading Text Reveal: "Ticket Ledger" (Masked power4.out easing)
      tl.to(words, {
        yPercent: 0,
        opacity: 1,
        rotateX: 0,
        duration: 0.8,
        ease: 'power4.out',
        stagger: 0.12,
      }, 0.22);

      // 5. Subheading Reveal: "Futuristic ticket booking system" (power3.out easing)
      tl.to(sub, {
        yPercent: 0,
        opacity: 1,
        duration: 0.6,
        ease: 'power3.out',
      }, 0.48);

      // 6. Stacker Animation using back.out and expo.inOut
      // First: Cards appear in sequential stagger
      tl.to(cards, {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.55,
        ease: 'back.out(1.5)',
        stagger: 0.09,
      }, 0.6);

      // Progress counter runs from 0% to 100%
      tl.to(progressBar, {
        width: '100%',
        duration: 1.1,
        ease: 'expo.inOut',
      }, 0.65);

      tl.to(counter, {
        val: 100,
        duration: 1.1,
        ease: 'expo.inOut',
        onUpdate: () => {
          if (progressNum) {
            progressNum.textContent = `${String(Math.round(counter.val)).padStart(2, '0')}%`;
          }
        },
      }, 0.65);

      // Then: Cards compress and stack into unified dimensional deck
      tl.to(cards[0], {
        y: -14,
        scale: 0.9,
        opacity: 0.35,
        duration: 0.5,
        ease: 'power3.out',
      }, 1.15);

      tl.to(cards[1], {
        y: -7,
        scale: 0.95,
        opacity: 0.65,
        duration: 0.5,
        ease: 'power3.out',
      }, 1.2);

      tl.to(cards[2], {
        y: 0,
        scale: 1,
        opacity: 1,
        boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
        duration: 0.5,
        ease: 'power3.out',
      }, 1.25);

      // 7. Brief dramatic hold (~0.35s) followed by smooth cinematic curtain exit
      // Exit stage content
      tl.to(centerStage, {
        y: -30,
        opacity: 0,
        duration: 0.45,
        ease: 'power3.in',
      }, 2.05);

      tl.to(corners, {
        opacity: 0,
        duration: 0.3,
        ease: 'power2.in',
      }, 2.05);

      // Split curtain panels slide up/down with luxury expo.inOut easing
      tl.to(curtainLeft, {
        yPercent: -100,
        duration: 0.7,
        ease: 'expo.inOut',
      }, 2.2);

      tl.to(curtainRight, {
        yPercent: -100,
        duration: 0.7,
        ease: 'expo.inOut',
      }, 2.26);

      tl.to(root, {
        opacity: 0,
        duration: 0.1,
      }, 2.85);

    }, rootRef);

    // Keyboard support: Escape or Space to skip immediately
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        finish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      ctx.revert();
    };
  }, [visible, finish]);

  if (!visible) return null;

  return (
    <div ref={rootRef} className="tl-splash" role="dialog" aria-modal="true" aria-label="TicketLedger intro">
      {/* Background curtain panels for split reveal wipe */}
      <div className="tl-splash-curtain tl-splash-curtain--left" style={{ width: '50%', left: 0 }} />
      <div className="tl-splash-curtain tl-splash-curtain--right" style={{ width: '50%', right: 0 }} />

      {/* Telemetry Corner Accents */}
      <div className="tl-splash-corner tl-splash-corner--tl">
        + [ TICKET LEDGER / 2026 ]
      </div>
      <div className="tl-splash-corner tl-splash-corner--tr">
        [ SYSTEM: ONLINE ]
      </div>
      <div className="tl-splash-corner tl-splash-corner--bl">
        [ PROTOCOL: ERC-721 ]
      </div>
      <div className="tl-splash-corner tl-splash-corner--br">
        <button type="button" className="tl-splash-skip" onClick={finish} aria-label="Skip intro">
          Skip [ESC] &rarr;
        </button>
      </div>

      {/* Central Content Stage */}
      <div className="tl-splash-stage">
        {/* Brand Emblem Icon */}
        <div className="tl-splash-emblem" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="8" width="28" height="24" rx="3" stroke="currentColor" />
            <path d="M6 16c3 0 5-2 5-4" />
            <path d="M6 24c3 0 5 2 5 4" />
            <path d="M34 16c-3 0-5-2-5-4" />
            <path d="M34 24c-3 0-5 2-5 4" />
            <line x1="16" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="20" x2="24" y2="20" stroke="currentColor" strokeWidth="2" />
            <line x1="16" y1="26" x2="24" y2="26" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>

        {/* Main Title: "Ticket Ledger" with Masked Text Reveal */}
        <div className="tl-splash-title-mask">
          <h1 className="tl-splash-title">
            <span className="tl-splash-word">Ticket</span>
            <span className="tl-splash-word">Ledger</span>
          </h1>
        </div>

        {/* Subheading: "Futuristic ticket booking system" */}
        <div className="tl-splash-sub-mask">
          <p className="tl-splash-sub">Futuristic ticket booking system</p>
        </div>

        {/* Stacker Animation Cards */}
        <div className="tl-splash-stack-wrapper" aria-hidden="true">
          {STACKER_ITEMS.map((item, idx) => (
            <div key={item.num} className="tl-splash-card" style={{ zIndex: idx + 1 }}>
              <div className="tl-splash-card-tag">
                <span className="tl-splash-card-tag-num">{item.num}</span>
                <span>{item.title}</span>
              </div>
              <div className="tl-splash-card-meta">{item.meta}</div>
            </div>
          ))}
        </div>

        {/* Progress Tracker */}
        <div className="tl-splash-progress" aria-hidden="true">
          <div className="tl-splash-progress-track">
            <div className="tl-splash-progress-bar" />
          </div>
          <div className="tl-splash-progress-num">00%</div>
        </div>
      </div>
    </div>
  );
}
