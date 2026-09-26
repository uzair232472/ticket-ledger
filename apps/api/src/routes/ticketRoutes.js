import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  mintOrderNFTs,
  getMyNFTTickets,
  getNFTTicketById,
  getCustomerWallet,
  downloadTicketPDF,
  getTicketQR,
  verifyTicketQRPost,
} from '../controllers/ticketController.js';
import {
  transferTicketDirectly,
  getMyTransferHistory,
  getTicketTransferHistory,
} from '../controllers/ticketTransferController.js';

const router = Router();

// Protected routes
router.use(requireAuth);

router.post('/transfer', transferTicketDirectly);
router.get('/my-transfers', getMyTransferHistory);
router.post('/mint/:orderId', mintOrderNFTs);
router.get('/my-nfts', getMyNFTTickets);
router.get('/wallet', getCustomerWallet);
router.get('/:id/pdf', downloadTicketPDF);
router.get('/:id/qr', getTicketQR);
router.post('/verify-qr', verifyTicketQRPost);
router.get('/nft/:id', getNFTTicketById);
router.get('/:ticketId/transfer-history', getTicketTransferHistory);

export default router;
