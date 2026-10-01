import { EVENT_IMAGE_SPECS, MAX_DIMENSION, MAX_PIXELS, RATIO_TOLERANCE } from '../config/eventMedia.js';
import { inspectImage } from '../utils/imageInspect.js';
import { uploadFile } from '../utils/storage.js';

export class MediaValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const mb = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/**
 * Checks one uploaded file against the placement's requirements using its real bytes.
 * Returns the detected { format, mime, ext, width, height }; throws MediaValidationError otherwise.
 */
export function validateEventImage(file, kind) {
  const spec = EVENT_IMAGE_SPECS[kind];
  const name = file.originalname ? `"${file.originalname}"` : 'The file';
  if (file.size > spec.maxBytes) {
    throw new MediaValidationError(`${spec.label}: ${name} is ${mb(file.size)}; the maximum is ${mb(spec.maxBytes)}.`);
  }
  const info = inspectImage(file.buffer);
  if (!info) {
    throw new MediaValidationError(`${spec.label}: ${name} is not a valid JPEG, PNG or WebP image.`);
  }
  const { width, height } = info;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new MediaValidationError(`${spec.label}: ${width} × ${height} px is too large; keep each side under ${MAX_DIMENSION} px.`);
  }
  // Any-ratio images (venue plans) are checked by long/short side so portrait plans work too
  const [w, h] = spec.ratio ? [width, height] : [Math.max(width, height), Math.min(width, height)];
  if (w < spec.min[0] || h < spec.min[1]) {
    throw new MediaValidationError(`${spec.label}: ${width} × ${height} px is below the minimum of ${spec.min[0]} × ${spec.min[1]} px.`);
  }
  const ratio = width / height;
  if (spec.ratio && Math.abs(ratio - spec.ratio) / spec.ratio > RATIO_TOLERANCE) {
    throw new MediaValidationError(`${spec.label}: ${width} × ${height} px does not match the required ${spec.ratioLabel} ratio. Crop it to ${spec.ratioLabel} and upload again.`);
  }
  return info;
}

/** Validates every file first, then uploads them, so a bad file never leaves earlier ones half-saved. */
export async function uploadEventImages(entries) {
  const checked = entries.map(({ file, kind }) => ({ file, kind, info: validateEventImage(file, kind) }));
  const results = [];
  for (const { file, info } of checked) {
    const res = await uploadFile(file, 'event_media', { extension: info.ext });
    results.push(res.url);
  }
  return results;
}
