import React from 'react';
import { ImageOff } from 'lucide-react';

/**
 * A scaled copy of the container a photo is displayed in (same aspect ratio, object-fit: cover and
 * object-position), so the organizer sees the real crop. `shade` adds the hero's text-contrast gradient.
 */
export default function PreviewFrame({ frame, src, dimmed = false }) {
  return (
    <figure className="space-y-1" style={{ width: frame.width, maxWidth: '100%' }}>
      <div className="relative overflow-hidden rounded-md bg-slate-200 border border-slate-200" style={{ aspectRatio: frame.aspect }}>
        {src ? (
          <img
            src={src}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover ${dimmed ? 'opacity-50 grayscale' : ''}`}
            style={{ objectPosition: frame.position }}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-slate-400">
            <ImageOff className="w-5 h-5" aria-hidden="true" />
          </span>
        )}
        {frame.shade && src && (
          <span
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 22%), linear-gradient(0deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 38%, rgba(0,0,0,0) 62%)' }}
            aria-hidden="true"
          />
        )}
      </div>
      <figcaption className="text-[10px] text-slate-400">{frame.label}</figcaption>
    </figure>
  );
}
