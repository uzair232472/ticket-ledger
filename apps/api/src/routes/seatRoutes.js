import express from 'express';
import { 
  getEventSeatMap, 
  lockSeat, 
  unlockSeat, 
  generateSeatGrid 
} from '../controllers/seatController.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';

const router = express.Router();

// Public / optional auth endpoint to view seat map
router.get('/event/:eventId', (req, res, next) => {
  // If authorization header is provided, attach user; otherwise proceed
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next);
  }
  next();
}, getEventSeatMap);

// Seat reservation & locking endpoints (Require login)
router.post('/lock', authenticateJWT, lockSeat);
router.post('/unlock', authenticateJWT, unlockSeat);

// Venue grid generation (Organizer / Super Admin only)
router.post('/generate-grid', authenticateJWT, requireRole('ORGANIZER', 'SUPER_ADMIN'), generateSeatGrid);

export default router;
