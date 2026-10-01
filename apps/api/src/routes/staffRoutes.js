import express from 'express';
import {
  createInvite,
  listStaff,
  listInvitableEvents,
  resendInvite,
  cancelInvite,
  deactivateStaff,
  getMyGateEvents,
} from '../controllers/staffController.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';

const router = express.Router();

router.use(authenticateJWT);

// Gate staff: events they are assigned to (organizers and admins see their scoped events)
router.get('/my-events', requireRole('GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN'), getMyGateEvents);

// Staff management: organizers for their own company, Super Admin for everyone.
// Each handler enforces company ownership itself; the role check alone is not enough.
const manager = requireRole('ORGANIZER', 'SUPER_ADMIN');
router.get('/', manager, listStaff);
router.get('/events', manager, listInvitableEvents);
router.post('/invites', manager, createInvite);
router.post('/invites/:id/resend', manager, resendInvite);
router.delete('/invites/:id', manager, cancelInvite);
router.patch('/:id/deactivate', manager, deactivateStaff);

export default router;
