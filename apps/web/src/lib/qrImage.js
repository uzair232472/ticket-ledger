import jsQR from 'jsqr';

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file could not be opened as an image.'));
    };
    img.src = url;
  });

/**
 * Reads the QR code in an image file (screenshot or photo of a pass). Tries the browser's BarcodeDetector,
 * then jsQR at a few sizes (large photos read better scaled down, tiny screenshots better scaled up).
 * Resolves with the decoded text, or throws when no QR code is found.
 */
export async function decodeQrFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file (PNG, JPG or WebP) of the ticket QR.');
  const img = await loadImage(file);

  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      // Some platforms expose BarcodeDetector but never answer; don't let that block the jsQR fallback
      const codes = await Promise.race([detector.detect(img), new Promise((resolve) => setTimeout(() => resolve([]), 1500))]);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch {
      /* fall back to jsQR */
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  for (const target of [1000, 1600, 700, 2200, 500]) {
    const scale = target / longest;
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.fillStyle = '#fff'; // transparent PNGs: give the code a light background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;
  }
  throw new Error('No QR code was found in this image. Use a clear, straight-on picture of the whole code.');
}
