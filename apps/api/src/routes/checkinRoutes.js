import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import { myEvents, pack, scanTicket, syncScans, stats, recent } from '../controllers/checkinController.js';

// Gate check-in. Event access (assigned gate staff, owning organizer, Super Admin) is checked per request.
const router = Router();
const scanners = requireRole('GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN');

router.get('/events', authenticateJWT, scanners, myEvents);
router.get('/events/:id/pack', authenticateJWT, scanners, pack);
router.get('/events/:id/stats', authenticateJWT, scanners, stats);
router.get('/events/:id/recent', authenticateJWT, scanners, recent);
router.post('/scan', authenticateJWT, scanners, scanTicket);
router.post('/sync', authenticateJWT, scanners, syncScans);

export default router;
