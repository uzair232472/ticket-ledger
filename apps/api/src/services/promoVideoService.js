import { HERO_VIDEO_SPECS, RATIO_TOLERANCE } from '../config/eventMedia.js';
import { MediaValidationError } from './eventMediaService.js';
import { uploadFile } from '../utils/storage.js';

const MB = 1024 * 1024;

/** Top-level boxes of an MP4 / MOV buffer between start and end: [{ type, start, end }] (start = after the header). */
function boxes(buf, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

/** Width, height and duration (seconds) from the moov box, or null when they can't be read. */
export function readMp4Info(buf) {
  const moov = boxes(buf, 0, buf.length).find((b) => b.type === 'moov');
  if (!moov) return null;
  const inMoov = boxes(buf, moov.start, moov.end);
  let seconds = null;
  const mvhd = inMoov.find((b) => b.type === 'mvhd');
  if (mvhd) {
    const v = buf[mvhd.start];
    const scale = buf.readUInt32BE(mvhd.start + (v === 1 ? 20 : 12));
    const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
    if (scale > 0) seconds = duration / scale;
  }
  // The video track is the one with a non-zero size (audio tracks report 0 × 0)
  for (const trak of inMoov.filter((b) => b.type === 'trak')) {
    const tkhd = boxes(buf, trak.start, trak.end).find((b) => b.type === 'tkhd');
    if (!tkhd) continue;
    const at = tkhd.start + (buf[tkhd.start] === 1 ? 88 : 76);
    if (at + 8 > tkhd.end) continue;
    const width = Math.round(buf.readUInt32BE(at) / 65536);
    const height = Math.round(buf.readUInt32BE(at + 4) / 65536);
    if (width > 0 && height > 0) return { width, height, seconds };
  }
  return seconds != null ? { width: null, height: null, seconds } : null;
}

/** "mp4" or "webm" from the file's first bytes, or null. */
function sniffVideo(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return null;
}

/** Checks a hero promo video against HERO_VIDEO_SPECS[kind]; throws a MediaValidationError with what to change. */
export function validateHeroVideo(file, kind) {
  const spec = HERO_VIDEO_SPECS[kind];
  const fail = (msg) => {
    throw new MediaValidationError(`${spec.label}: ${msg}`);
  };
  const type = sniffVideo(file.buffer);
  if (!type) fail('upload an MP4 (H.264) or WebM video.');
  if (file.size > spec.maxBytes) fail(`the file is ${(file.size / MB).toFixed(1)} MB; the limit is ${spec.maxBytes / MB} MB.`);
  if (type === 'mp4') {
    const info = readMp4Info(file.buffer);
    if (info?.seconds != null && info.seconds > spec.maxSeconds + 0.5) {
      fail(`the video is ${Math.round(info.seconds)} seconds long; keep it to ${spec.maxSeconds} seconds or less.`);
    }
    if (info?.width) {
      const [minW, minH] = spec.min;
      const [recW, recH] = spec.recommended;
      if (Math.abs(info.width / info.height - spec.ratio) / spec.ratio > RATIO_TOLERANCE) {
        fail(`the video is ${info.width} × ${info.height}; it needs a ${spec.ratioLabel} frame (${recW} × ${recH} recommended).`);
      }
      if (info.width < minW || info.height < minH) {
        fail(`the video is ${info.width} × ${info.height}; it needs at least ${minW} × ${minH} (${recW} × ${recH} recommended).`);
      }
    }
  }
  return { ext: `.${type}` };
}

/** Validates every video first, then uploads them: { desktop?: url, mobile?: url }. */
export async function uploadHeroVideos({ desktop, mobile }) {
  const entries = [['desktop', desktop], ['mobile', mobile]].filter(([, file]) => file);
  const checked = entries.map(([kind, file]) => ({ kind, file, info: validateHeroVideo(file, kind) }));
  const urls = {};
  for (const { kind, file, info } of checked) {
    urls[kind] = (await uploadFile(file, 'event_media', { extension: info.ext })).url;
  }
  return urls;
}
