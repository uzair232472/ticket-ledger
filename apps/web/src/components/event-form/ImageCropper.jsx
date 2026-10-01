import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crop, X, ZoomIn } from 'lucide-react';

const MAX_ZOOM = 4;
const QUALITIES = [0.92, 0.85, 0.75, 0.65];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crops an image to the placement's ratio: drag (or arrow keys) to position, slider to zoom.
 * The result is re-encoded in the browser, capped at 1.5× the recommended width and kept under the
 * placement's file-size limit. Calls onApply(File) or onCancel().
 */
export default function ImageCropper({ file, spec, onApply, onCancel }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const imgRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [natural, setNatural] = useState(null); // { w, h }
  const [frameWidth, setFrameWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState(null); // crop centre in natural px
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Created in the effect so its cleanup (also run by StrictMode's mount check) never revokes a URL in use
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFrameWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Largest crop with the target ratio that fits the image, then shrink by zoom
  const baseW = natural ? Math.min(natural.w, natural.h * spec.ratio) : 0;
  const maxZoom = natural ? clamp(baseW / spec.min[0], 1, MAX_ZOOM) : 1;
  const cropW = baseW / zoom;
  const cropH = cropW / spec.ratio;
  const tooSmall = natural && baseW < spec.min[0] - 0.5;

  const clampCenter = (c, w = cropW, h = cropH) =>
    natural && { x: clamp(c.x, w / 2, natural.w - w / 2), y: clamp(c.y, h / 2, natural.h - h / 2) };

  const onLoad = (e) => {
    const n = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
    setNatural(n);
    setCenter({ x: n.w / 2, y: n.h / 2 });
  };

  const scale = frameWidth && cropW ? frameWidth / cropW : 0;

  const onPointerDown = (e) => {
    if (!center) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, start: center };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || !scale) return;
    setCenter(clampCenter({ x: d.start.x - (e.clientX - d.x) / scale, y: d.start.y - (e.clientY - d.y) / scale }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onKeyDown = (e) => {
    const step = (cropW / 20) * (e.shiftKey ? 4 : 1);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[e.key] || !center) return;
    e.preventDefault();
    setCenter(clampCenter({ x: center.x + moves[e.key][0], y: center.y + moves[e.key][1] }));
  };
  const onZoom = (value) => {
    const z = clamp(value, 1, maxZoom);
    const w = baseW / z;
    setZoom(z);
    setCenter((c) => clampCenter(c, w, w / spec.ratio));
  };

  const apply = async () => {
    if (!natural || !center || tooSmall) return;
    setBusy(true);
    setError('');
    try {
      const img = imgRef.current; // already loaded and decoded for the preview
      const outW = Math.round(Math.min(cropW, spec.recommended[0] * 1.5));
      const outH = Math.round(outW / spec.ratio);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, center.x - cropW / 2, center.y - cropH / 2, cropW, cropH, 0, 0, outW, outH);

      // Keep WebP/JPEG as they are; PNG stays PNG only if it fits, otherwise becomes JPEG
      const types = file.type === 'image/png' ? ['image/png', 'image/jpeg'] : [file.type];
      let blob = null;
      for (const type of types) {
        for (const q of type === 'image/png' ? [undefined] : QUALITIES) {
          blob = await toBlob(canvas, type, q);
          if (blob && blob.size <= spec.maxBytes) break;
        }
        if (blob && blob.size <= spec.maxBytes) break;
      }
      if (!blob || blob.size > spec.maxBytes) {
        setError('The cropped image is still too large. Try a smaller source image.');
        return;
      }
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[blob.type] || '.jpg';
      const base = (file.name || 'image').replace(/\.[^.]+$/, '');
      onApply(new File([blob], `${base}-cropped${ext}`, { type: blob.type }));
    } catch {
      setError('This image could not be cropped in the browser. Crop it to the required ratio and upload again.');
    } finally {
      setBusy(false);
    }
  };

  const imgStyle = natural && center && scale
    ? {
        width: natural.w * scale,
        height: natural.h * scale,
        transform: `translate(${-(center.x - cropW / 2) * scale}px, ${-(center.y - cropH / 2) * scale}px)`,
      }
    : { visibility: 'hidden' };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60" role="dialog" aria-modal="true" aria-labelledby="tl-crop-title">
      <div className="w-full max-w-2xl bg-white rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 text-xs text-slate-700 max-h-full overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="tl-crop-title" className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Crop className="w-4 h-4 text-[#16a34a]" /> Crop {spec.label}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Required ratio {spec.ratioLabel}. Drag the photo (or use the arrow keys) to position it, and zoom to tighten the crop.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="p-1.5 text-slate-400 hover:text-slate-700" aria-label="Close cropper">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={frameRef}
          className="relative w-full overflow-hidden rounded-xl bg-slate-900 cursor-grab active:cursor-grabbing touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]"
          style={{ aspectRatio: String(spec.ratio), margin: '0 auto', maxWidth: `calc(55vh * ${spec.ratio})` }}
          tabIndex={0}
          aria-label="Crop area. Use arrow keys to move the photo."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {src && <img ref={imgRef} src={src} alt="" onLoad={onLoad} draggable="false" className="absolute left-0 top-0 max-w-none pointer-events-none" style={imgStyle} />}
        </div>

        <label className="flex items-center gap-3">
          <ZoomIn className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Zoom</span>
          <input
            type="range"
            min={1}
            max={maxZoom}
            step={0.01}
            value={zoom}
            disabled={maxZoom <= 1}
            onChange={(e) => onZoom(Number(e.target.value))}
            className="flex-1 accent-[#16a34a]"
          />
          {natural && (
            <span className="font-mono text-[11px] text-slate-500 w-28 text-right">
              {Math.round(cropW)} × {Math.round(cropH)} px
            </span>
          )}
        </label>

        {tooSmall && (
          <p className="text-rose-600">
            This image is too small to crop to {spec.ratioLabel} at the minimum of {spec.min[0]} × {spec.min[1]} px.
          </p>
        )}
        {error && <p className="text-rose-600" role="alert">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={apply} disabled={!natural || busy || tooSmall} className="px-4 py-2 btn-eventfrog text-xs disabled:opacity-50">
            {busy ? 'Cropping…' : 'Use cropped image'}
          </button>
        </div>
      </div>
    </div>
  );
}
