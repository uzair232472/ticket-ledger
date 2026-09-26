import express from 'express';
import { 
  register, 
  login, 
  sendOtp, 
  verifyOtp, 
  getMe 
} from '../controllers/authController.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/otp/send', sendOtp);
router.post('/otp/verify', verifyOtp);

// Authenticated route
router.get('/me', authenticateJWT, getMe);

// Role-protected test routes for verifying role guards
router.get('/role-test/admin', authenticateJWT, requireRole('SUPER_ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Super Admin access granted', user: req.user });
});

router.get('/role-test/organizer', authenticateJWT, requireRole('ORGANIZER', 'SUPER_ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Organizer access granted', user: req.user });
});

router.get('/role-test/staff', authenticateJWT, requireRole('GATE_STAFF', 'SUPER_ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Gate Staff access granted', user: req.user });
});

router.get('/role-test/customer', authenticateJWT, requireRole('CUSTOMER', 'SUPER_ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Customer access granted', user: req.user });
});

export default router;
