import express from 'express';
import multer from 'multer';
import { 
  registerCompany, 
  getMyCompany, 
  getAllCompanies, 
  updateCompanyStatus,
  requireApprovedOrganizer 
} from '../controllers/companyController.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';

const router = express.Router();

// Multer memory storage setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
});

// All company routes require authentication
router.use(authenticateJWT);

// Organizer routes
router.post(
  '/register', 
  requireRole('ORGANIZER', 'SUPER_ADMIN'), 
  upload.single('document'), 
  registerCompany
);

router.get('/my-company', requireRole('ORGANIZER', 'SUPER_ADMIN'), getMyCompany);

// Route to verify requireApprovedOrganizer guard works
router.get('/guard-check', requireApprovedOrganizer, (req, res) => {
  res.json({
    success: true,
    message: 'Authorized! Company is fully APPROVED to create events.',
    company: req.company,
  });
});

// Super Admin governance routes
router.get('/admin/all', requireRole('SUPER_ADMIN'), getAllCompanies);
router.patch('/admin/:id/status', requireRole('SUPER_ADMIN'), updateCompanyStatus);

export default router;
