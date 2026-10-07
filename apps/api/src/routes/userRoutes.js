import express from 'express';
import multer from 'multer';
import { 
  getProfile, 
  updateProfile, 
  updateWallet, 
  updateNotifications, 
  getAccountHistory,
  changePassword,
  updateAvatar,
  removeAvatar,
} from '../controllers/userController.js';
import { authRateLimiter } from '../middlewares/rateLimit.js';
import { authenticateJWT } from '../middlewares/auth.js';

const router = express.Router();

// Profile pictures: one image, PNG/JPG/WebP, up to 2 MB
const avatarUpload = (req, res, next) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (r, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
  }).single('avatar')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'The picture must be 2 MB or smaller.' : 'Upload one PNG, JPG or WebP image.';
    return res.status(400).json({ success: false, message });
  });

// All user routes require authenticated session
router.use(authenticateJWT);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.put('/avatar', avatarUpload, updateAvatar);
router.delete('/avatar', removeAvatar);
router.put('/wallet', updateWallet);
router.put('/notifications', updateNotifications);
router.put('/password', authRateLimiter, changePassword);
router.get('/history', getAccountHistory);

export default router;
