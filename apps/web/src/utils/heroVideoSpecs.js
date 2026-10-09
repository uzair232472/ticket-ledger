/**
 * Promo videos for the home page hero. Keep in sync with HERO_VIDEO_SPECS in apps/api/src/config/eventMedia.js
 * (the API checks the same limits). TicketLedger's own hero films are 1920 × 1080 and 608 × 1080 (phones).
 */
const MB = 1024 * 1024;
export const RATIO_TOLERANCE = 0.1;

export const HERO_VIDEO_SPECS = {
  desktop: { label: 'Desktop video', ratio: 16 / 9, ratioLabel: '16:9 landscape', recommended: [1920, 1080], min: [1280, 720], maxBytes: 30 * MB, maxSeconds: 60 },
  mobile: { label: 'Phone video', ratio: 9 / 16, ratioLabel: '9:16 portrait', recommended: [1080, 1920], min: [540, 960], maxBytes: 15 * MB, maxSeconds: 60 },
};

/** What organizers are told before they make a hero promo video. */
export const HERO_VIDEO_GUIDE = [
  ['Desktop size', '1920 × 1080 px, 16:9 landscape (at least 1280 × 720).'],
  ['Phone size (optional)', '1080 × 1920 px, 9:16 portrait. Without it, phones show the desktop video cropped to its centre.'],
  ['Length', '15–30 seconds works best; 60 seconds at most. It plays on a loop, so make the end flow into the start.'],
  ['File', 'MP4 (H.264) or WebM. Up to 30 MB for desktop and 15 MB for phones.'],
  ['Sound', 'The video plays muted. Don’t rely on voice-over; put key words on screen.'],
  ['Safe area', 'Keep titles, logos and faces in the middle. Edges are cropped on different screens, and the TicketLedger headline and buttons cover the bottom third.'],
  ['No video?', 'We use your event banner instead (2400 × 1080 px, 20:9).'],
];

/** Reads a video file's size and length in the browser: { width, height, seconds } (null if unreadable). */
export function readVideoMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight, seconds: video.duration });
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** The first problem with a chosen video for `kind`, or null when it fits. */
export async function checkHeroVideo(file, kind) {
  const spec = HERO_VIDEO_SPECS[kind];
  if (!/^video\/(mp4|webm|quicktime)$/.test(file.type) && !/\.(mp4|webm|m4v)$/i.test(file.name)) return 'Choose an MP4 or WebM video.';
  if (file.size > spec.maxBytes) return `This file is ${(file.size / MB).toFixed(1)} MB; the limit is ${spec.maxBytes / MB} MB.`;
  const meta = await readVideoMeta(file);
  if (!meta) return null; // the browser can't read it; the server checks it again
  const [recW, recH] = spec.recommended;
  if (Number.isFinite(meta.seconds) && meta.seconds > spec.maxSeconds + 0.5) {
    return `This video is ${Math.round(meta.seconds)} seconds long; keep it to ${spec.maxSeconds} seconds or less.`;
  }
  if (meta.width && meta.height) {
    if (Math.abs(meta.width / meta.height - spec.ratio) / spec.ratio > RATIO_TOLERANCE) {
      return `This video is ${meta.width} × ${meta.height}; it needs a ${spec.ratioLabel} frame (${recW} × ${recH} recommended).`;
    }
    if (meta.width < spec.min[0] || meta.height < spec.min[1]) {
      return `This video is ${meta.width} × ${meta.height}; it needs at least ${spec.min[0]} × ${spec.min[1]} (${recW} × ${recH} recommended).`;
    }
  }
  return null;
}
