import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, GripVertical, ImagePlus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ACCEPT_ATTR, EVENT_IMAGE_SPECS, checkImageFile } from '../../utils/eventImageSpecs';
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
    <section className="tl-imf" aria-labelledby={`${id}-title`}>
      <header className="tl-imf-head">
        <div>
          <h3 id={`${id}-title`}>Scrolling gallery</h3>
          <p>Multiple square images for the event gallery.</p>
        </div>
        <p className="tl-imf-spec" id={`${id}-help`}>
          <b>{items.length} / {spec.maxCount} images</b>
          Recommended: {spec.recommended[0]} × {spec.recommended[1]} px
          <br />
          {spec.ratioLabel} · Max {Math.round(spec.maxBytes / 1048576)}MB each · JPG, PNG, WebP
        </p>
      </header>

      {items.length > 0 ? (
        <ol className="tl-imf-gallery">
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
              className={dragKey === item.key ? 'is-dragging' : ''}
            >
              <PreviewFrame frame={{ ...spec.frames[0], label: item.file ? 'New' : `#${i + 1}` }} src={itemSrc(item)} />
              <div className="tl-imf-gallery-bar">
                <span><GripVertical className="w-3.5 h-3.5" aria-hidden="true" /> #{i + 1}</span>
                <div>
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move image ${i + 1} earlier`}>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label={`Move image ${i + 1} later`}>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onChange(items.filter((x) => x.key !== item.key))} aria-label={`Remove image ${i + 1}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="tl-imf-gallery" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <div key={n} className="tl-imf-slot">
              <span className="tl-imf-empty">
                <ImagePlus className="w-6 h-6" />
                <strong>Category artwork</strong>
                <span>No image uploaded</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="tl-imf-status">
        {items.length === 0 ? 'Optional. Until you add some, attendees see category photos in the strip.' : changed ? 'Changes apply when you save. Drag or use the arrows to reorder.' : 'Drag or use the arrows to reorder.'}
      </p>

      <div className="tl-imf-actions">
        <input ref={inputRef} id={id} type="file" multiple accept={ACCEPT_ATTR} onChange={onSelect} aria-describedby={`${id}-help`} className="sr-only" />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={checking || room <= 0} className="tl-imf-btn">
          <Upload className="w-4 h-4" /> {checking ? 'Checking…' : room <= 0 ? 'Gallery is full' : 'Add images'}
        </button>
        {changed && savedItems.length > 0 && (
          <button type="button" onClick={() => onChange(savedItems)} className="tl-imf-btn tl-imf-btn--quiet">
            <RotateCcw className="w-4 h-4" /> Restore saved gallery
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((msg) => (
            <li key={msg} className="tl-imf-error">
              <AlertCircle className="w-4 h-4" /> {msg}
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
    </section>
  );
}
