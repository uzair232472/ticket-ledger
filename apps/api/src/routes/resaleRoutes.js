import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middlewares/auth.js';
import {
  listTicketForResale,
  cancelResaleListing,
  getMarketListings,
  getMyListings,
  buyResaleTicket,
} from '../controllers/resaleController.js';

const router = Router();

// Public discovery
router.get('/market', optionalAuth, getMarketListings);

// Protected endpoints
router.post('/list', requireAuth, listTicketForResale);
router.post('/cancel/:listingId', requireAuth, cancelResaleListing);
router.get('/my-listings', requireAuth, getMyListings);
router.post('/buy/:listingId', requireAuth, buyResaleTicket);

export default router;
