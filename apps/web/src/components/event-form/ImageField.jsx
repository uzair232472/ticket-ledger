import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { ACCEPT_ATTR, EVENT_IMAGE_SPECS, checkImageFile, specHelperText, specLimitText } from '../../utils/eventImageSpecs';
import { resolveMediaUrl } from '../../utils/eventMedia';
import ImageCropper from './ImageCropper';
import PreviewFrame from './PreviewFrame';

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
    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
      <div>
        <label htmlFor={id} className="block text-slate-700 font-semibold">
          {spec.label} <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <p className="text-[11px] text-slate-500 mt-0.5">{spec.description}</p>
        <p className="text-[11px] text-slate-700 font-medium mt-1.5" id={`${id}-help`}>{specHelperText(spec)}</p>
        <p className="text-[10px] text-slate-400">{specLimitText(spec)}. {spec.fallbackNote}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {spec.frames.map((frame) => (
          <PreviewFrame key={frame.label} frame={frame} src={src || fallbackSrc} dimmed={showFallback} />
        ))}
      </div>
      <p className="text-[11px] text-slate-500" aria-live="polite">
        {showFallback ? `Not set: attendees see ${fallbackLabel}` : status}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={onSelect}
          aria-describedby={`${id}-help`}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={checking}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white font-semibold disabled:opacity-60"
        >
          <ImagePlus className="w-3.5 h-3.5" /> {checking ? 'Checking…' : src && !showFallback ? 'Replace image' : 'Choose image'}
        </button>
        {src && !showFallback && (
          <button
            type="button"
            onClick={() => onChange({ ...value, file: null, previewUrl: null, removed: true })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-rose-600 font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
        )}
        {changed && value.savedUrl && (
          <button
            type="button"
            onClick={() => onChange(emptyImageValue(value.savedUrl))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Keep current image
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-rose-600" role="alert">
          <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" /> {error}
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
    </div>
  );
}
