import React from 'react';
import { ImagePlus } from 'lucide-react';

const sentence = (text = '') => text.replace(/^the /i, '').replace(/ shown here$/i, '').replace(/^\w/, (c) => c.toUpperCase());

/**
 * A scaled copy of the container a photo is displayed in (same aspect ratio, object-fit: cover and
 * object-position), so the organizer sees the real crop. `dimmed` = nothing uploaded yet: the fallback
 * shows faintly behind a "No image uploaded" placeholder. `shade` adds the hero's text-contrast gradient.
 */
export default function PreviewFrame({ frame, src, dimmed = false, emptyLabel }) {
  const empty = dimmed || !src;
  return (
    <figure
      className={`tl-imf-frame${empty ? '' : ' is-filled'}`}
      style={{ flex: `${frame.width} 1 0`, aspectRatio: frame.aspect }}
    >
      {src && <img src={src} alt="" className={dimmed ? 'is-fallback' : ''} style={{ objectPosition: frame.position }} />}
      {frame.shade && src && !dimmed && <span className="tl-imf-frame-shade" aria-hidden="true" />}
      {empty && (
        <span className="tl-imf-empty">
          <ImagePlus className="w-7 h-7" aria-hidden="true" />
          {emptyLabel && <strong>{sentence(emptyLabel)}</strong>}
          <span>No image uploaded</span>
        </span>
      )}
      {!empty && frame.label && <figcaption>{frame.label}</figcaption>}
    </figure>
  );
}
