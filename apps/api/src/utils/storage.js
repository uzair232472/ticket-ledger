import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

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
