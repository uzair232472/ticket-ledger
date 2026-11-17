import { Router } from 'express';
import { authenticateJWT } from '../middlewares/auth.js';
import { claimGift, previewGift } from '../controllers/ticketExtrasController.js';

// Gift claim links (/gifts/:token): anyone may look; claiming needs the account the gift was sent to
const router = Router();
router.get('/:token', previewGift);
router.post('/:token/claim', authenticateJWT, claimGift);
export default router;
