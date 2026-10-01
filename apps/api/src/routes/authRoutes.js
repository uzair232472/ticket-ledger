import express from 'express';
import {
  signup,
  login,
  verifyOtp,
  resendOtp,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  getInvite,
  acceptInvite,
  getMe,
  getPendingSignup,
  updatePendingSignup,
} from '../controllers/authController.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import { authRateLimiter, codeCheckRateLimiter } from '../middlewares/rateLimit.js';

const router = express.Router();

// Public routes
router.post('/signup', authRateLimiter, signup);
router.post('/login', authRateLimiter, login);
router.get('/pending-signup', codeCheckRateLimiter, getPendingSignup);
router.patch('/pending-signup', authRateLimiter, updatePendingSignup);
router.post('/verify-otp', codeCheckRateLimiter, verifyOtp);
router.post('/resend-otp', authRateLimiter, resendOtp);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', codeCheckRateLimiter, resetPassword);
router.get('/invite/:token', codeCheckRateLimiter, getInvite);
router.post('/accept-invite', codeCheckRateLimiter, acceptInvite);

// Session routes (authenticated by the httpOnly refresh cookie)
router.post('/refresh', refresh);
router.post('/logout', logout);

// Legacy aliases kept for older clients and scripts
router.post('/register', authRateLimiter, signup);
router.post('/otp/send', authRateLimiter, resendOtp);
router.post('/otp/verify', codeCheckRateLimiter, verifyOtp);

// Authenticated route
router.get('/me', authenticateJWT, getMe);

// Test routes for role verification
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
