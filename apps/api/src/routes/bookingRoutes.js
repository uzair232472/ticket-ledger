import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  initiateBooking,
  confirmBooking,
  cancelBooking,
  getMyBookings,
  getBookingById,
} from '../controllers/bookingController.js';
import { getMyRefunds, getMyEventNotices } from '../controllers/lifecycleController.js';

const router = Router();

// All booking endpoints require authentication
router.use(requireAuth);

router.post('/initiate', initiateBooking);
router.post('/confirm', confirmBooking);
router.post('/cancel', cancelBooking);
router.get('/my-bookings', getMyBookings);
// Refunds paid to me, and my events that were cancelled, postponed or moved (before /:id)
router.get('/refunds', getMyRefunds);
router.get('/event-notices', getMyEventNotices);
router.get('/:id', getBookingById);

export default router;
