import { useCallback, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { reducedMotion } from './venueTheme';

const DRAG_THRESHOLD = 6; // px a pointer must travel before a press becomes a pan (not a tap)
const EASE = 'power3.inOut';

/**
 * Pan / zoom camera for an SVG map. The view is the SVG viewBox, kept at the container's aspect ratio
 * so one layout unit has the same size horizontally and vertically. Movement is written straight to
 * the DOM (no React re-render); `onScale` reports pixels-per-unit for level-of-detail decisions.
 *
 * - drag to pan (mouse, pen, one finger), pinch with two fingers, Ctrl/⌘ + wheel or trackpad pinch to zoom
 * - `wasDrag()` lets click handlers ignore the click that ends a pan
 * - `shouldPan(event)` lets the editor claim a press (e.g. to move a section) instead of panning
 */
export function useCamera(svgRef, contentBox, { onScale, shouldPan, maxZoom = 60 } = {}) {
  const view = useRef(null);
  const tween = useRef(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const dragged = useRef(false);
  const content = useRef(contentBox);
  const scaleCb = useRef(onScale);
  const panCheck = useRef(shouldPan);
  content.current = contentBox;
  scaleCb.current = onScale;
  panCheck.current = shouldPan;

  const size = () => {
    const el = svgRef.current;
    return { w: Math.max(1, el?.clientWidth || 1), h: Math.max(1, el?.clientHeight || 1) };
  };
  const pxPerUnit = (v = view.current) => size().w / v.w;
  const fitScale = () => {
    const { w, h } = size();
    const c = content.current;
    return Math.min(w / (c.w * 1.04), h / (c.h * 1.04));
  };

  const apply = useCallback(() => {
    const el = svgRef.current;
    const v = view.current;
    if (!el || !v) return;
    el.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    scaleCb.current?.(pxPerUnit(v));
  }, [svgRef]);

  /** View that shows `box` (with padding) centred, at the container's aspect ratio, within zoom limits. */
  const viewFor = useCallback((box, pad = 0.06) => {
    const { w, h } = size();
    const bw = box.w * (1 + pad * 2) || 1;
    const bh = box.h * (1 + pad * 2) || 1;
    const minS = fitScale() * 0.6;
    const maxS = fitScale() * maxZoom;
    const s = Math.min(maxS, Math.max(minS, Math.min(w / bw, h / bh)));
    const vw = w / s;
    const vh = h / s;
    return { x: box.x + box.w / 2 - vw / 2, y: box.y + box.h / 2 - vh / 2, w: vw, h: vh };
  }, [maxZoom]);

  // Keep the centre of the view over the venue
  const clamp = (v) => {
    const c = content.current;
    const cx = Math.min(c.x + c.w, Math.max(c.x, v.x + v.w / 2));
    const cy = Math.min(c.y + c.h, Math.max(c.y, v.y + v.h / 2));
    return { ...v, x: cx - v.w / 2, y: cy - v.h / 2 };
  };

  const animateTo = useCallback((target, { duration = 0.9, instant = false } = {}) => {
    tween.current?.kill();
    if (!view.current || instant || reducedMotion()) {
      view.current = { ...target };
      apply();
      return Promise.resolve();
    }
    const state = { ...view.current };
    return new Promise((resolve) => {
      tween.current = gsap.to(state, {
        ...target,
        duration,
        ease: EASE,
        onUpdate: () => {
          view.current = { ...state };
          apply();
        },
        onComplete: resolve,
      });
    });
  }, [apply]);

  // The box last framed by the app (whole venue or a section). While the user hasn't panned or zoomed
  // since, a resize re-frames it; after a manual move, resizes keep the user's centre and scale.
  const autoBox = useRef(null);
  const fit = useCallback((box, opts = {}) => {
    autoBox.current = { box: box || null, pad: opts.pad };
    return animateTo(viewFor(box || content.current, opts.pad), opts);
  }, [animateTo, viewFor]);

  const zoomBy = useCallback((factor, around) => {
    const v = view.current;
    if (!v) return;
    autoBox.current = null;
    const s = pxPerUnit(v) * factor;
    const minS = fitScale() * 0.6;
    const maxS = fitScale() * maxZoom;
    const clamped = Math.min(maxS, Math.max(minS, s));
    const f = pxPerUnit(v) / clamped; // new w = old w * f
    const p = around || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const next = { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f };
    tween.current?.kill();
    view.current = clamp(next);
    apply();
  }, [apply, maxZoom]);

  const toSvg = useCallback((clientX, clientY) => {
    const el = svgRef.current;
    const v = view.current;
    if (!el || !v) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  }, [svgRef]);

  // Initial view and resize: keep the same centre and scale
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    if (!view.current) {
      view.current = viewFor(content.current);
      autoBox.current = { box: null };
    }
    apply();
    let last = size();
    const ro = new ResizeObserver(() => {
      const now = size();
      const v = view.current;
      if (!v) return;
      if (autoBox.current) {
        tween.current?.kill();
        view.current = viewFor(autoBox.current.box || content.current, autoBox.current.pad);
        last = now;
        apply();
        return;
      }
      const s = last.w / v.w;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      view.current = { x: cx - now.w / s / 2, y: cy - now.h / s / 2, w: now.w / s, h: now.h / s };
      last = now;
      apply();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef, apply, viewFor]);

  // Pointer & wheel interaction
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;

    const onDown = (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        dragged.current = false;
        if (panCheck.current && !panCheck.current(e)) {
          drag.current = null;
          return;
        }
        drag.current = { x: e.clientX, y: e.clientY, view: { ...view.current }, id: e.pointerId, active: false };
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        drag.current = { pinch: Math.hypot(a.x - b.x, a.y - b.y), mid: toSvg((a.x + b.x) / 2, (a.y + b.y) / 2), active: true };
        dragged.current = true;
        autoBox.current = null;
      }
    };
    const onMove = (e) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = drag.current;
      if (!d) return;
      if (d.pinch && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        zoomBy(dist / d.pinch, d.mid);
        d.pinch = dist;
        return;
      }
      if (d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!d.active) {
        d.active = true;
        dragged.current = true;
        autoBox.current = null;
        tween.current?.kill();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('is-panning');
      }
      const r = el.getBoundingClientRect();
      const k = d.view.w / r.width;
      view.current = clamp({ ...d.view, x: d.view.x - dx * k, y: d.view.y - dy * k });
      apply();
    };
    const onUp = (e) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) {
        drag.current = null;
        el.classList.remove('is-panning');
      }
    };
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0025), toSvg(e.clientX, e.clientY));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      tween.current?.kill();
    };
  }, [svgRef, apply, zoomBy, toSvg]);

  return {
    fit,
    zoomIn: () => zoomBy(1.6),
    zoomOut: () => zoomBy(1 / 1.6),
    zoomBy,
    toSvg,
    wasDrag: () => dragged.current,
    scale: () => (view.current ? pxPerUnit() : 1),
  };
}
