import express from 'express';
import multer from 'multer';
import { authenticateJWT, loadOrgContext, requirePermission } from '../middlewares/auth.js';
import * as c from '../controllers/orgController.js';

// Organization membership. Every route is scoped to the caller's ACTIVE membership; Super Admins must name the
// organization with ?companyId= (audited as SUPER_ADMIN_ORG_ACCESS) and are refused without one.
const router = express.Router();
router.use(authenticateJWT, loadOrgContext);

const can = (permission) => requirePermission(permission, { allowPlatformAdmin: false });

// Uploads: organization documents (PDF or image, 10 MB, 5 per request) and the logo (image, 2 MB)
const upload = (types, { fileSize, files }, field, many) => {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize, files },
    fileFilter: (req, file, cb) => (types.has(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error(`"${file.originalname}" is not an allowed file type.`), { status: 400 }))),
  });
  const mw = many ? m.array(field, files) : m.single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') message = `Each file must be ${Math.round(fileSize / 1048576)} MB or smaller.`;
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = `Upload at most ${files} file${files === 1 ? '' : 's'} at a time.`;
    return res.status(400).json({ success: false, message });
  });
};
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const documentUpload = upload(new Set(['application/pdf', ...IMAGES]), { fileSize: 10 * 1024 * 1024, files: 5 }, 'documents', true);
const logoUpload = upload(IMAGES, { fileSize: 2 * 1024 * 1024, files: 1 }, 'logo', false);
// Any active member may read these
const member = can([]);

router.get('/me', c.me);
router.get('/roles', c.roles);

router.get('/members', can('staff.view'), c.listMembers);
router.get('/members/:id', can('staff.view'), c.getMember);
router.patch('/members/:id', can('staff.roles'), c.updateMember);
router.put('/members/:id/events', can('staff.manage'), c.setMemberEvents);
router.post('/members/:id/deactivate', can('staff.manage'), c.deactivateMember);
router.post('/members/:id/reactivate', can('staff.manage'), c.reactivateMember);
router.delete('/members/:id', can('staff.manage'), c.removeMember);
router.post('/ownership/transfer', can('staff.roles'), c.transferOwnership);

router.get('/invitations', can('staff.view'), c.listInvitations);
router.post('/invitations', can('staff.invite'), c.createInvitation);
router.post('/invitations/:id/resend', can('staff.invite'), c.resendInvitation);
router.delete('/invitations/:id', can('staff.invite'), c.revokeInvitation);

router.get('/activity', can('audit.view'), c.activity);
router.get('/members/:id/activity', can('audit.view'), (req, res, next) => {
  req.query.memberId = req.params.id;
  return c.activity(req, res, next);
});

// Organization profile (everyone in the organization reads it; owners and admins change it)
router.get('/profile', member, c.getProfile);
router.patch('/profile', can('org.settings'), logoUpload, c.updateProfile);

// Document library
router.get('/documents', can('org.documents'), c.listDocuments);
router.post('/documents', can('org.documents'), documentUpload, c.uploadDocuments);
router.patch('/documents/:id', can('org.documents'), c.updateDocument);
router.post('/documents/:id/archive', can('org.documents'), c.archiveDocument);
router.post('/documents/:id/restore', can('org.documents'), c.restoreDocument);

// Payout & tax details (?reveal=true shows full account numbers to finance.manage, and is audited)
router.get('/finance', can('finance.view'), c.getFinance);
router.put('/finance', can('finance.manage'), c.updateFinance);
router.get('/payouts', can('finance.view'), c.listPayouts);

// Branches / operating locations
router.get('/branches', member, c.listBranches);
router.post('/branches', can('org.settings'), c.createBranch);
router.patch('/branches/:id', can('org.settings'), c.updateBranch);
router.delete('/branches/:id', can('org.settings'), c.deleteBranch);
router.put('/events/:eventId/branch', can('event.edit'), c.setEventBranch);

// Automatic abandoned-checkout reminders
router.get('/recovery', can('attendee.contact'), c.getRecovery);
router.put('/recovery', can('attendee.contact'), c.updateRecovery);

// Checkout settings: fees and tax (finance.manage), each event's rules (event.edit)
router.get('/checkout', member, c.getCheckout);
router.put('/checkout/fees', can('finance.manage'), c.updateCheckoutFees);
router.put('/events/:eventId/checkout-rules', can('event.edit'), c.updateEventCheckoutRules);

// Discount codes
router.get('/discounts', can('discount.manage'), c.listDiscounts);
router.post('/discounts', can('discount.manage'), c.createDiscount);
router.patch('/discounts/:id', can('discount.manage'), c.updateDiscount);
router.delete('/discounts/:id', can('discount.manage'), c.deleteDiscount);

export default router;
