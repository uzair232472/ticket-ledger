import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ACCEPT_ATTR, EVENT_IMAGE_SPECS, checkImageFile } from '../../utils/eventImageSpecs';
import { resolveMediaUrl } from '../../utils/eventMedia';
import ImageCropper from './ImageCropper';
import PreviewFrame from './PreviewFrame';

// Short titles and descriptions for the image cards
export const CARD_COPY = {
  banner: { title: 'Event banner', text: 'Wide banner shown on your event page.' },
  card: { title: 'Event card image', text: 'Main image for event listings.' },
  galleryWide: { title: 'Gallery wide image', text: 'Wide image for the gallery section.' },
  gallery: { title: 'Scrolling gallery', text: 'Multiple square images for the event gallery.' },
};

/** Form value for one image placement. Nothing changes on the server until the event is saved. */
export const emptyImageValue = (savedUrl = null) => ({ savedUrl, file: null, previewUrl: null, removed: false });

/** What attendees will see for this value: a new file, the saved image, or nothing. */
export const imageValueSrc = (value) => value.previewUrl || (!value.removed && value.savedUrl ? resolveMediaUrl(value.savedUrl) : null);

/**
 * Upload control for a single-image placement: requirements shown up front, a preview in the real
 * container shape, crop when the ratio is wrong, and replace / remove / undo.
 */
export default function ImageField({ kind, value, onChange, fallbackSrc, fallbackLabel }) {
  const spec = EVENT_IMAGE_SPECS[kind];
  const id = useId();
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState(null);
  const [checking, setChecking] = useState(false);

  // Release the temporary preview when it is replaced or the form closes
  useEffect(() => () => value.previewUrl && URL.revokeObjectURL(value.previewUrl), [value.previewUrl]);

  const acceptFile = (file) => {
    onChange({ ...value, file, previewUrl: URL.createObjectURL(file), removed: false });
  };

  const onSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setError('');
    setChecking(true);
    const result = await checkImageFile(file, spec);
    setChecking(false);
    if (result.ok) acceptFile(file);
    else if (result.needsCrop) {
      setError(result.error);
      setCropFile(file);
    } else setError(result.error);
  };

  const src = imageValueSrc(value);
  const changed = Boolean(value.file) || value.removed;
  const showFallback = !src && fallbackSrc;

  let status = 'No image';
  if (value.file) status = value.savedUrl ? 'New image, replaces the current one when you save' : 'New image, uploaded when you save';
  else if (value.removed) status = 'Will be removed when you save';
  else if (value.savedUrl) status = 'Current image';

  return (
    <section className="tl-imf" aria-labelledby={`${id}-title`}>
      <header className="tl-imf-head">
        <div>
          <h3 id={`${id}-title`}>{CARD_COPY[kind]?.title || spec.label}</h3>
          <p>{CARD_COPY[kind]?.text || spec.description}</p>
        </div>
        <p className="tl-imf-spec" id={`${id}-help`}>
          <b>Recommended: {spec.recommended[0]} × {spec.recommended[1]} px</b>
          {spec.ratioLabel} · Max {Math.round(spec.maxBytes / 1048576)}MB · JPG, PNG, WebP
        </p>
      </header>

      <div className="tl-imf-frames">
        {spec.frames.map((frame) => (
          <PreviewFrame key={frame.label} frame={frame} src={src || fallbackSrc} dimmed={showFallback} emptyLabel={fallbackLabel} />
        ))}
      </div>
      <p className="tl-imf-status" aria-live="polite">
        {showFallback ? `Optional. Until you add one, attendees see ${fallbackLabel}.` : status}
      </p>

      <div className="tl-imf-actions">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={onSelect}
          aria-describedby={`${id}-help`}
          className="sr-only"
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={checking} className="tl-imf-btn">
          <Upload className="w-4 h-4" /> {checking ? 'Checking…' : src && !showFallback ? 'Replace image' : 'Choose image'}
        </button>
        {src && !showFallback && (
          <button type="button" onClick={() => onChange({ ...value, file: null, previewUrl: null, removed: true })} className="tl-imf-btn tl-imf-btn--quiet">
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        )}
        {changed && value.savedUrl && (
          <button type="button" onClick={() => onChange(emptyImageValue(value.savedUrl))} className="tl-imf-btn tl-imf-btn--quiet">
            <RotateCcw className="w-4 h-4" /> Keep current
          </button>
        )}
      </div>

      {error && (
        <p className="tl-imf-error" role="alert">
          <AlertCircle className="w-4 h-4" /> {error}
        </p>
      )}

      {cropFile && (
        <ImageCropper
          file={cropFile}
          spec={spec}
          onCancel={() => setCropFile(null)}
          onApply={(file) => {
            setCropFile(null);
            setError('');
            acceptFile(file);
          }}
        />
      )}
    </section>
  );
}
