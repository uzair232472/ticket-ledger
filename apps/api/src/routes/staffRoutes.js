import express from 'express';
import {
  createInvite,
  listStaff,
  listInvitableEvents,
  resendInvite,
  cancelInvite,
  deactivateStaff,
  reactivateStaff,
  revokeEventAccess,
  getMyGateEvents,
} from '../controllers/staffController.js';
import { authenticateJWT, loadOrgContext, requirePermission } from '../middlewares/auth.js';

const router = express.Router();

router.use(authenticateJWT, loadOrgContext);

// Events the caller scans at (gate staff: their assignments; owners and admins: their organization's events)
router.get('/my-events', requirePermission('gate.scan'), getMyGateEvents);

// Gate staff management: members holding staff.* permissions for their own organization, Super Admin for all.
// Each handler also checks the staff member and event belong to the caller's organization.
router.get('/', requirePermission('staff.view'), listStaff);
router.get('/events', requirePermission('staff.invite'), listInvitableEvents);
router.post('/invites', requirePermission('staff.invite'), createInvite);
router.post('/invites/:id/resend', requirePermission('staff.invite'), resendInvite);
router.delete('/invites/:id', requirePermission('staff.invite'), cancelInvite);
router.patch('/:id/deactivate', requirePermission('staff.manage'), deactivateStaff);
router.patch('/:id/reactivate', requirePermission('staff.manage'), reactivateStaff);
router.delete('/:id/events/:eventId', requirePermission('staff.manage'), revokeEventAccess);

export default router;
