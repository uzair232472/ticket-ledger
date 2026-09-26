import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  initiateBooking,
  confirmBooking,
  cancelBooking,
  getMyBookings,
  getBookingById,
} from '../controllers/bookingController.js';

const router = Router();

// All booking endpoints require authentication
router.use(requireAuth);

router.post('/initiate', initiateBooking);
router.post('/confirm', confirmBooking);
router.post('/cancel', cancelBooking);
router.get('/my-bookings', getMyBookings);
router.get('/:id', getBookingById);

export default router;
