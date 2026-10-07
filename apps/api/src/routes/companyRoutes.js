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

// Verification documents: 1 to 4 files (PDF, PNG, JPG or WebP, 10 MB each)
const MAX_COMPANY_DOCUMENTS = 4;
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_COMPANY_DOCUMENTS },
  fileFilter: (req, file, cb) => {
    if (DOCUMENT_TYPES.has(file.mimetype)) return cb(null, true);
    const err = new Error(`"${file.originalname}" is not a PDF, PNG, JPG or WebP file.`);
    err.status = 400;
    return cb(err);
  },
});

// `documents` (up to 4) is the current field; `document` (one file) is still accepted from older clients.
// Multer errors (too many files, too large, wrong type) become a 400 with a readable message.
const documentUpload = (req, res, next) =>
  upload.fields([{ name: 'documents', maxCount: MAX_COMPANY_DOCUMENTS }, { name: 'document', maxCount: 1 }])(req, res, (err) => {
    if (!err) return next();
    let message = err.message;
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = `You can upload at most ${MAX_COMPANY_DOCUMENTS} documents.`;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Each document must be 10 MB or smaller.';
    return res.status(400).json({ success: false, message });
  });

// All company routes require authentication
router.use(authenticateJWT);

// Organizer routes
router.post(
  '/register', 
  requireRole('ORGANIZER', 'SUPER_ADMIN'), 
  documentUpload,
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
