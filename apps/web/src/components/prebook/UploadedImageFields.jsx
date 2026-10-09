import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import api from '../../utils/api';
import ImageField, { emptyImageValue } from '../event-form/ImageField';
import GalleryField from '../event-form/GalleryField';

/*
 * Image controls for the prebooking form. Unlike the event form (which uploads on save), images are
 * uploaded as soon as they are chosen and the form keeps only their URLs, so an autosaved draft still has
 * them when the organizer comes back or fixes a clashing date.
 */

const KIND = { banner: 'banner', card: 'card', galleryWide: 'galleryWide', gallery: 'gallery' };

export async function uploadPrebookImage(file, kind) {
  const form = new FormData();
  form.append('kind', KIND[kind]);
  form.append('image', file);
  const res = await api.post('/prebook/images', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return res.data.data.url;
}

const Status = ({ busy, error }) => (
  <>
    {busy && (
      <p className="tl-wz-hint">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
        Uploading…
      </p>
    )}
    {error && (
      <p className="tl-wz-error" role="alert">
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
        {error}
      </p>
    )}
  </>
);

/** One image placement; `url` in, `onChange(url | null)` out. */
export function UploadedImageField({ kind, url, onChange, fallbackSrc, fallbackLabel }) {
  const [value, setValue] = useState(() => emptyImageValue(url));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A different saved URL (e.g. the draft loaded) resets the control
  useEffect(() => {
    if (!busy) setValue(emptyImageValue(url));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = async (next) => {
    setError('');
    if (next.file) {
      setValue(next); // preview while uploading
      setBusy(true);
      try {
        const uploaded = await uploadPrebookImage(next.file, kind);
        onChange(uploaded);
        setValue(emptyImageValue(uploaded));
      } catch (err) {
        setError(err.response?.data?.message || 'The image could not be uploaded. Try again.');
        setValue(emptyImageValue(url));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (next.removed) {
      onChange(null);
      setValue(emptyImageValue(null));
      return;
    }
    setValue(next);
  };

  return (
    <>
      <ImageField kind={kind} value={value} onChange={change} fallbackSrc={fallbackSrc} fallbackLabel={fallbackLabel} />
      <Status busy={busy} error={error} />
    </>
  );
}

/** Ordered gallery; `urls` in, `onChange(urls)` out. New files are uploaded in place, keeping their order. */
export function UploadedGalleryField({ urls, onChange }) {
  const [pending, setPending] = useState([]); // items being uploaded, shown with their preview
  const [error, setError] = useState('');
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const items = [...urls.map((url, i) => ({ key: `url-${i}-${url}`, url })), ...pending];

  const change = async (next) => {
    setError('');
    const kept = next.filter((item) => item.url).map((item) => item.url);
    const added = next.filter((item) => item.file && !pending.some((p) => p.key === item.key));
    onChange(kept);
    if (!added.length) {
      setPending((prev) => prev.filter((p) => next.some((n) => n.key === p.key)));
      return;
    }
    setPending((prev) => [...prev, ...added]);
    for (const item of added) {
      try {
        const url = await uploadPrebookImage(item.file, 'gallery');
        onChange([...urlsRef.current, url]);
        urlsRef.current = [...urlsRef.current, url];
      } catch (err) {
        setError(err.response?.data?.message || 'An image could not be uploaded. Try again.');
      } finally {
        setPending((prev) => prev.filter((p) => p.key !== item.key));
      }
    }
  };

  return (
    <>
      <GalleryField items={items} onChange={change} savedItems={items} />
      <Status busy={pending.length > 0} error={error} />
    </>
  );
}
