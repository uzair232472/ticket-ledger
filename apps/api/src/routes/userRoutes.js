import express from 'express';
import { 
  getProfile, 
  updateProfile, 
  updateWallet, 
  updateNotifications, 
  getAccountHistory 
} from '../controllers/userController.js';
import { authenticateJWT } from '../middlewares/auth.js';

const router = express.Router();

// All user routes require authenticated session
router.use(authenticateJWT);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.put('/wallet', updateWallet);
router.put('/notifications', updateNotifications);
router.get('/history', getAccountHistory);

export default router;
