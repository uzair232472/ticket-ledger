import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import {
  checkFraud,
  forecastDemand,
  scoreIntent,
  getFraudWatchlist,
  freezeUserAccount,
  unfreezeUserAccount,
} from '../controllers/mlController.js';

const router = Router();

// Public / Session Evaluation Endpoints (accepts optional Bearer token)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next);
  }
  next();
};

router.post('/fraud-check', optionalAuth, checkFraud);
router.post('/demand-forecast', optionalAuth, forecastDemand);
router.post('/intent-score', optionalAuth, scoreIntent);

// Super Admin Watchlist & Account Freeze Controls
router.get('/fraud-watchlist', authenticateJWT, requireRole('SUPER_ADMIN'), getFraudWatchlist);
router.post('/freeze-user/:userId', authenticateJWT, requireRole('SUPER_ADMIN'), freezeUserAccount);
router.post('/unfreeze-user/:userId', authenticateJWT, requireRole('SUPER_ADMIN'), unfreezeUserAccount);

export default router;
