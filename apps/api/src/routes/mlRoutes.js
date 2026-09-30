import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import {
  checkFraud,
  forecastDemand,
  scoreIntent,
  trainModel,
  getPredictionHistory,
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

// Module 15 Primary Endpoints (with legacy aliases)
router.post('/fraud/score', optionalAuth, checkFraud);
router.post('/fraud-check', optionalAuth, checkFraud);

router.post('/forecast/demand', optionalAuth, forecastDemand);
router.post('/demand-forecast', optionalAuth, forecastDemand);

router.post('/intent/predict', optionalAuth, scoreIntent);
router.post('/intent-score', optionalAuth, scoreIntent);

// Module 15 Model Retraining Trigger
router.post('/train/:modelType', authenticateJWT, requireRole('SUPER_ADMIN'), trainModel);

// Module 15 Persisted Scores & Predictions Query
router.get('/predictions', authenticateJWT, requireRole('SUPER_ADMIN'), getPredictionHistory);

// Super Admin Watchlist & Account Freeze Controls
router.get('/fraud-watchlist', authenticateJWT, requireRole('SUPER_ADMIN'), getFraudWatchlist);
router.post('/freeze-user/:userId', authenticateJWT, requireRole('SUPER_ADMIN'), freezeUserAccount);
router.post('/unfreeze-user/:userId', authenticateJWT, requireRole('SUPER_ADMIN'), unfreezeUserAccount);

export default router;
