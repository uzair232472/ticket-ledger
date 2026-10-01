/**
 * Requirements for organizer-uploaded event images, derived from the components that display them.
 * Keep in sync with apps/api/src/config/eventMedia.js (the API enforces the same limits).
 *
 * `frames` mirror the real containers so previews show exactly what attendees will see:
 * - card:        EventTile (503:377) / home EventCard (4:3), object-position 50% 30%
 * - banner:      EventDetails hero, full width × max(600px, 72svh) on desktop, 100svh on phones, object-position 50% 35%
 * - galleryWide: EventGallery wide photo, 1471:740 desktop / 373:349 phones
 * - gallery:     EventGallery strip cards, 539:550 desktop / 373:349 phones
 */

const MB = 1024 * 1024;

export const RATIO_TOLERANCE = 0.1; // ±10% of the target ratio
export const MAX_DIMENSION = 8000; // px per side
export const MAX_PIXELS = 40_000_000;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export const EVENT_IMAGE_SPECS = {
  card: {
    label: 'Event Card Image',
    description: 'Shown on event tiles in Explore, “Other events”, home page cards and the map.',
    fallbackNote: 'Optional. If empty, the Event Banner is used.',
    ratio: 4 / 3,
    ratioLabel: '4:3',
    recommended: [1600, 1200],
    min: [800, 600],
    maxBytes: 5 * MB,
    maxCount: 1,
    frames: [{ label: 'Event tile', aspect: '503 / 377', position: '50% 30%', width: 220 }],
  },
  banner: {
    label: 'Event Banner',
    description: 'Large photo behind the title at the top of the event page. Phones show only the centre, so keep the subject in the middle.',
    fallbackNote: 'Optional. If empty, the category artwork is used.',
    ratio: 20 / 9,
    ratioLabel: '20:9',
    recommended: [2400, 1080],
    min: [1600, 720],
    maxBytes: 8 * MB,
    maxCount: 1,
    frames: [
      { label: 'Desktop', aspect: '1440 / 648', position: '50% 35%', width: 300, shade: true },
      { label: 'Phone', aspect: '390 / 844', position: '50% 35%', width: 78, shade: true },
    ],
  },
  galleryWide: {
    label: 'Gallery Wide Image',
    description: 'Wide photo opening the gallery below the event details.',
    fallbackNote: 'Optional. If empty, the Event Banner is used.',
    ratio: 2,
    ratioLabel: '2:1',
    recommended: [2400, 1200],
    min: [1400, 700],
    maxBytes: 8 * MB,
    maxCount: 1,
    frames: [
      { label: 'Desktop', aspect: '1471 / 740', position: '50% 50%', width: 240 },
      { label: 'Phone', aspect: '373 / 349', position: '50% 50%', width: 110 },
    ],
  },
  gallery: {
    label: 'Scrolling Gallery Images',
    description: 'Photos in the drifting strip on the event page, shown in this order.',
    fallbackNote: 'Optional. If empty, category photos are shown.',
    ratio: 1,
    ratioLabel: '1:1',
    recommended: [1200, 1200],
    min: [700, 700],
    maxBytes: 5 * MB,
    maxCount: 12,
    frames: [{ label: 'Strip card', aspect: '539 / 550', position: '50% 50%', width: 120 }],
  },
};

const formatMb = (bytes) => `${Math.round((bytes / MB) * 10) / 10}`;

/** "Recommended: 1600 × 1200 px · Ratio: 4:3 · Maximum: 5 MB · Formats: JPG, PNG, WebP" */
export function specHelperText(spec) {
  return `Recommended: ${spec.recommended[0]} × ${spec.recommended[1]} px · Ratio: ${spec.ratioLabel} · Maximum: ${formatMb(spec.maxBytes)} MB · Formats: JPG, PNG, WebP`;
}

export function specLimitText(spec) {
  const count = spec.maxCount > 1 ? ` · Up to ${spec.maxCount} images` : '';
  return `Minimum: ${spec.min[0]} × ${spec.min[1]} px · Larger images are fine if the ratio is ${spec.ratioLabel}${count}`;
}

export const ratioMatches = (width, height, spec) => Math.abs(width / height - spec.ratio) / spec.ratio <= RATIO_TOLERANCE;

/** Reads the natural size of an image file in the browser (rejects if it can't be decoded). */
export function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('decode'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Checks a file against a placement. Returns { ok, error, needsCrop, width, height }.
 * `needsCrop` means the file is otherwise valid but its ratio is wrong (the form offers the cropper).
 */
export async function checkImageFile(file, spec) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, error: `“${file.name}” is not a JPG, PNG or WebP image.` };
  }
  let size;
  try {
    size = await readImageSize(file);
  } catch {
    return { ok: false, error: `“${file.name}” could not be read as an image.` };
  }
  const { width, height } = size;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return { ok: false, error: `${width} × ${height} px is too large. Keep each side under ${MAX_DIMENSION} px.`, width, height };
  }
  if (width < spec.min[0] || height < spec.min[1]) {
    return { ok: false, error: `${width} × ${height} px is below the minimum of ${spec.min[0]} × ${spec.min[1]} px.`, width, height };
  }
  if (!ratioMatches(width, height, spec)) {
    return { ok: false, needsCrop: true, error: `${width} × ${height} px is not ${spec.ratioLabel}. Crop it to fit.`, width, height };
  }
  if (file.size > spec.maxBytes) {
    // Right shape but too heavy: the cropper re-encodes it smaller
    return { ok: false, needsCrop: true, error: `“${file.name}” is ${formatMb(file.size)} MB; the maximum is ${formatMb(spec.maxBytes)} MB.`, width, height };
  }
  return { ok: true, width, height };
}
