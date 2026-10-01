import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, GripVertical, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { ACCEPT_ATTR, EVENT_IMAGE_SPECS, checkImageFile, specHelperText, specLimitText } from '../../utils/eventImageSpecs';
import { resolveMediaUrl } from '../../utils/eventMedia';
import ImageCropper from './ImageCropper';
import PreviewFrame from './PreviewFrame';

const spec = EVENT_IMAGE_SPECS.gallery;
let nextKey = 0;

/** Gallery form items: saved images ({ id, url }) and new files ({ file, previewUrl }), in display order. */
export const galleryItemsFromSaved = (images = []) => images.map((img) => ({ key: `saved-${img.id}`, id: img.id, url: img.url }));

const newItem = (file) => ({ key: `new-${nextKey++}`, file, previewUrl: URL.createObjectURL(file) });
const itemSrc = (item) => item.previewUrl || resolveMediaUrl(item.url);

/**
 * Ordered "Scrolling Gallery Images": add several at once (wrong-ratio files go through the cropper one
 * by one), reorder with drag-and-drop or the arrow buttons, remove. Saved images are only deleted on save.
 */
export default function GalleryField({ items, onChange, savedItems }) {
  const id = useId();
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  const [errors, setErrors] = useState([]);
  const [cropQueue, setCropQueue] = useState([]);
  const [checking, setChecking] = useState(false);
  const [dragKey, setDragKey] = useState(null);

  itemsRef.current = items;

  // Release previews of new files that are no longer in the list (and all of them on unmount)
  const previewsRef = useRef(new Set());
  useEffect(() => {
    const live = new Set(items.filter((i) => i.previewUrl).map((i) => i.previewUrl));
    previewsRef.current.forEach((url) => !live.has(url) && URL.revokeObjectURL(url));
    previewsRef.current = live;
  }, [items]);
  useEffect(() => () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const room = spec.maxCount - items.length;

  const onSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const problems = [];
    if (files.length > room) problems.push(`Only ${spec.maxCount} gallery images are allowed; ${files.length - Math.max(room, 0)} not added.`);
    setChecking(true);
    const accepted = [];
    const toCrop = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      const result = await checkImageFile(file, spec);
      if (result.ok) accepted.push(newItem(file));
      else if (result.needsCrop) toCrop.push(file);
      else problems.push(`${file.name}: ${result.error}`);
    }
    setChecking(false);
    if (accepted.length) onChange([...itemsRef.current, ...accepted]);
    setCropQueue((q) => [...q, ...toCrop]);
    setErrors(problems);
  };

  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const onDrop = (targetKey) => {
    const from = items.findIndex((i) => i.key === dragKey);
    const to = items.findIndex((i) => i.key === targetKey);
    setDragKey(null);
    if (from >= 0 && to >= 0) move(from, to);
  };

  const savedKeys = savedItems.map((i) => i.key).join();
  const changed = items.map((i) => i.key).join() !== savedKeys;

  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
      <div>
        <label htmlFor={id} className="block text-slate-700 font-semibold">
          {spec.label} <span className="font-normal text-slate-400">(optional · {items.length}/{spec.maxCount})</span>
        </label>
        <p className="text-[11px] text-slate-500 mt-0.5">{spec.description}</p>
        <p className="text-[11px] text-slate-700 font-medium mt-1.5" id={`${id}-help`}>{specHelperText(spec)}</p>
        <p className="text-[10px] text-slate-400">{specLimitText(spec)}. {spec.fallbackNote}</p>
      </div>

      {items.length > 0 ? (
        <ol className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {items.map((item, i) => (
            <li
              key={item.key}
              draggable
              onDragStart={(e) => {
                setDragKey(item.key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(item.key);
              }}
              onDragEnd={() => setDragKey(null)}
              className={`p-2 rounded-xl bg-white border space-y-2 ${dragKey === item.key ? 'opacity-50 border-[#22c55e]' : 'border-slate-200'}`}
            >
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1 cursor-grab">
                  <GripVertical className="w-3.5 h-3.5" aria-hidden="true" /> #{i + 1}
                </span>
                {item.file && <span className="text-[#16a34a] font-semibold">New</span>}
              </div>
              <PreviewFrame frame={{ ...spec.frames[0], width: '100%' }} src={itemSrc(item)} />
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="p-1 rounded-lg border border-slate-200 disabled:opacity-30" aria-label={`Move image ${i + 1} earlier`}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} className="p-1 rounded-lg border border-slate-200 disabled:opacity-30" aria-label={`Move image ${i + 1} later`}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button type="button" onClick={() => onChange(items.filter((x) => x.key !== item.key))} className="p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove image ${i + 1}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-slate-500">No gallery images: attendees see category photos in the strip.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} id={id} type="file" multiple accept={ACCEPT_ATTR} onChange={onSelect} aria-describedby={`${id}-help`} className="sr-only" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={checking || room <= 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white font-semibold disabled:opacity-60"
        >
          <ImagePlus className="w-3.5 h-3.5" /> {checking ? 'Checking…' : room <= 0 ? 'Gallery is full' : 'Add images'}
        </button>
        {changed && savedItems.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(savedItems)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Restore saved gallery
          </button>
        )}
        {changed && <span className="text-[11px] text-slate-500">Changes apply when you save.</span>}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1 text-rose-600" role="alert">
          {errors.map((msg) => (
            <li key={msg} className="flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" /> {msg}
            </li>
          ))}
        </ul>
      )}

      {cropQueue[0] && (
        <ImageCropper
          key={`${cropQueue[0].name}-${cropQueue.length}`}
          file={cropQueue[0]}
          spec={spec}
          onCancel={() => setCropQueue((q) => q.slice(1))}
          onApply={(file) => {
            setCropQueue((q) => q.slice(1));
            if (itemsRef.current.length < spec.maxCount) onChange([...itemsRef.current, newItem(file)]);
          }}
        />
      )}
    </div>
  );
}
