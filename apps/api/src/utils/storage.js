import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Configure Cloudinary if credentials are provided in .env
const isCloudinaryConfigured = 
  process.env.CLOUDINARY_CLOUD_NAME && 
  process.env.CLOUDINARY_API_KEY && 
  process.env.CLOUDINARY_API_KEY !== 'mock_key' &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_API_SECRET !== 'mock_secret';

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Storage Abstraction:
 * Uploads a document/image either to Cloudinary (if configured) or to local uploads directory.
 *
 * @param {Object} file - Multer file object or file metadata with buffer/path
 * @param {string} folder - Destination subfolder (e.g. 'company_docs', 'banners')
 * @param {Object} [options]
 * @param {string} [options.extension] - Extension to store under (e.g. from the sniffed image type) instead of the client filename's
 * @returns {Promise<{ url: string, publicId: string, provider: string }>}
 */
export const uploadFile = async (file, folder = 'company_docs', options = {}) => {
  if (!file) {
    throw new Error('No file provided for upload.');
  }

  // 1. If Cloudinary is actively configured with valid keys, upload to Cloudinary
  if (isCloudinaryConfigured) {
    try {
      return await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `ticketledger/${folder}`, resource_type: 'auto' },
          (error, result) => {
            if (error) return reject(error);
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              provider: 'cloudinary',
            });
          }
        );

        if (file.buffer) {
          stream.end(file.buffer);
        } else if (file.path) {
          fs.createReadStream(file.path).pipe(stream);
        } else {
          reject(new Error('Invalid file buffer or path'));
        }
      });
    } catch (err) {
      console.warn('Cloudinary upload error, falling back to local storage:', err.message);
    }
  }

  // 2. Local File Storage Fallback (Reliable for sandbox/development/offline)
  const uploadsDir = path.resolve('uploads', folder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const extension = options.extension || path.extname(file.originalname || '') || '.pdf';
  const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${extension}`;
  const targetPath = path.join(uploadsDir, filename);

  if (file.buffer) {
    fs.writeFileSync(targetPath, file.buffer);
  } else if (file.path) {
    fs.copyFileSync(file.path, targetPath);
  } else {
    // Generate placeholder sample document if mock URL is passed
    fs.writeFileSync(targetPath, 'TicketLedger Document Verification Placeholder');
  }

  const localUrl = `/uploads/${folder}/${filename}`;

  return {
    url: localUrl,
    publicId: filename,
    provider: 'local_storage',
  };
};

/*
 * Private files (support attachments): never served from the public /uploads folder. Locally they go to
 * private_uploads/<folder>/ (outside every static route); with Cloudinary they are uploaded as "authenticated"
 * assets. Callers keep the returned `key` and serve the file through an access-checked route
 * (privateFileAccess → { path } to stream, or { url } a short-lived signed Cloudinary link).
 */
export const uploadPrivateFile = async (file, folder = 'private') => {
  if (!file?.buffer && !file?.path) throw new Error('No file provided for upload.');
  if (isCloudinaryConfigured) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: `ticketledger/${folder}`, resource_type: 'auto', type: 'authenticated' }, (error, r) => (error ? reject(error) : resolve(r)));
        if (file.buffer) stream.end(file.buffer);
        else fs.createReadStream(file.path).pipe(stream);
      });
      return { key: `cld:${result.resource_type}:${result.format || ''}:${result.public_id}`, provider: 'cloudinary' };
    } catch (err) {
      console.warn('Cloudinary private upload failed, storing locally:', err.message);
    }
  }
  const dir = path.resolve('private_uploads', folder);
  fs.mkdirSync(dir, { recursive: true });
  const ext = (path.extname(file.originalname || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const target = path.join(dir, name);
  if (file.buffer) fs.writeFileSync(target, file.buffer);
  else fs.copyFileSync(file.path, target);
  return { key: `local:${folder}/${name}`, provider: 'local_storage' };
};

/** Where to read a private file: { path } (local) or { url } (signed, valid 5 minutes). Null when unknown. */
export const privateFileAccess = (key) => {
  if (!key) return null;
  if (key.startsWith('local:')) {
    const rel = key.slice(6);
    const base = path.resolve('private_uploads');
    const full = path.resolve(base, rel);
    if (!full.startsWith(base + path.sep) || !fs.existsSync(full)) return null;
    return { path: full };
  }
  if (key.startsWith('cld:') && isCloudinaryConfigured) {
    const [, resourceType, format, ...rest] = key.split(':');
    const publicId = rest.join(':');
    return { url: cloudinary.utils.private_download_url(publicId, format, { resource_type: resourceType, type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300 }) };
  }
  return null;
};
