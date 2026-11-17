import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  initiateBooking,
  confirmBooking,
  cancelBooking,
  getMyBookings,
  getBookingById,
  quoteBookingDiscount,
  downloadInvoice,
  checkoutCart,
  confirmCart,
} from '../controllers/bookingController.js';
import { getMyRefunds, getMyEventNotices } from '../controllers/lifecycleController.js';
import * as extras from '../controllers/ticketExtrasController.js';

const router = Router();

// All booking endpoints require authentication
router.use(requireAuth);

router.post('/initiate', initiateBooking);
// Check a discount code for the held seats before paying
router.post('/discount/quote', quoteBookingDiscount);
// Full price of held seats before paying: discount (code or group), service fee, tax, total
router.post('/quote', quoteBookingDiscount);
router.post('/confirm', confirmBooking);
// Several events, one payment
router.post('/cart/checkout', checkoutCart);
router.post('/cart/confirm', confirmCart);
router.post('/cancel', cancelBooking);
router.get('/my-bookings', getMyBookings);
// Refunds paid to me, and my events that were cancelled, postponed or moved (before /:id)
router.get('/refunds', getMyRefunds);
router.get('/event-notices', getMyEventNotices);
// Gifts and group tickets
router.get('/gifts', extras.myGifts);
router.post('/gifts', extras.sendGifts);
router.post('/gifts/:id/cancel', extras.cancelGift);
router.post('/gifts/:id/claim', extras.claimWaiting);
// Booking changes: move a ticket to another free seat of the same type (when the event allows it)
router.get('/tickets/:ticketId/seat-options', extras.seatOptions);
router.post('/tickets/:ticketId/change-seat', extras.changeSeat);
router.get('/:id/invoice', downloadInvoice);
router.get('/:id', getBookingById);

export default router;
