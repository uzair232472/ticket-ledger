import express from 'express';
import multer from 'multer';
import { 
  registerCompany, 
  getMyCompany, 
  getAllCompanies, 
  updateCompanyStatus,
  requireApprovedOrganizer 
} from '../controllers/companyController.js';
import { authenticateJWT, requireRole, loadOrgContext } from '../middlewares/auth.js';
import { pendingFinanceReviews, reviewFinance } from '../services/orgProfileService.js';
import { adminPayouts, decide as decidePayout } from '../services/payoutService.js';
import { AccessError } from '../services/orgAccess.js';

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

// Owners see their company in full; other members see it without verification documents
router.get('/my-company', getMyCompany);

// Route to verify requireApprovedOrganizer guard works
router.get('/guard-check', loadOrgContext, requireApprovedOrganizer, (req, res) => {
  res.json({
    success: true,
    message: 'Authorized! Company is fully APPROVED to create events.',
    company: req.company,
  });
});

// Super Admin governance routes
router.get('/admin/all', requireRole('SUPER_ADMIN'), getAllCompanies);
router.patch('/admin/:id/status', requireRole('SUPER_ADMIN'), updateCompanyStatus);

// Payout details waiting for a check, and the decision (verify / reject with a note)
const adminFail = (res, e, fallback) => (e instanceof AccessError ? res.status(e.status).json({ success: false, message: e.message }) : (console.error(fallback, e), res.status(500).json({ success: false, message: fallback })));
router.get('/admin/finance/pending', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    res.json({ success: true, data: { reviews: await pendingFinanceReviews() } });
  } catch (e) {
    adminFail(res, e, 'Could not load payout reviews.');
  }
});
router.post('/admin/:id/finance/review', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const finance = await reviewFinance(req, req.params.id, { status, note });
    res.json({ success: true, message: status === 'VERIFIED' ? 'Payout details verified.' : 'Payout details rejected. The owners were told why.', data: { finance } });
  } catch (e) {
    adminFail(res, e, 'Could not save the review.');
  }
});

// Payouts to organizations: the queue, and marking a transfer paid / failed / held
router.get('/admin/payouts', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const status = ['SCHEDULED', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'].includes(req.query.status) ? req.query.status : undefined;
    res.json({ success: true, data: { payouts: await adminPayouts({ status }) } });
  } catch (e) {
    adminFail(res, e, 'Could not load payouts.');
  }
});
router.post('/admin/payouts/:id/decide', requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const action = String(req.body?.action || '');
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 120) : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    const payout = await decidePayout(req.user, req.params.id, { action, reference, reason });
    res.json({ success: true, message: { PAID: 'Marked paid. The organizer was told.', FAILED: 'Marked failed. The organizer was told.', HOLD: 'Payout put on hold.', RELEASE: 'Hold released.', RETRY: 'Ready to pay again.' }[action] || 'Saved.', data: { payout } });
  } catch (e) {
    adminFail(res, e, 'Could not update the payout.');
  }
});

export default router;
