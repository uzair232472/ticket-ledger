import { Router } from 'express';
import { orgGuard } from '../middlewares/auth.js';
import { myEvents, pack, scanTicket, syncScans, stats, recent } from '../controllers/checkinController.js';

// Gate check-in. Event access (assigned gate staff, owning organizer, Super Admin) is checked per request.
const router = Router();
const scanners = orgGuard('gate.scan');
const viewers = orgGuard('gate.stats');

router.get('/events', scanners, myEvents);
router.get('/events/:id/pack', scanners, pack);
router.get('/events/:id/stats', viewers, stats);
router.get('/events/:id/recent', viewers, recent);
router.post('/scan', scanners, scanTicket);
router.post('/sync', scanners, syncScans);

export default router;
