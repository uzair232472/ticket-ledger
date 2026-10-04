import express from 'express';
import { authenticateJWT } from '../middlewares/auth.js';
import { addToWishlist, getWishlist, getWishlistIds, removeFromWishlist } from '../controllers/wishlistController.js';

const router = express.Router();

// Signed-in users only; every handler works on the caller's own wishlist
router.use(authenticateJWT);
router.get('/', getWishlist);
router.get('/ids', getWishlistIds);
router.post('/:eventId', addToWishlist);
router.delete('/:eventId', removeFromWishlist);

export default router;
