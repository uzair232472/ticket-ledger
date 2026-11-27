import { Router } from 'express';
import { requireAdmin } from '../services/adminAccess.js';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
import { mlInsightsRateLimiter, mlLegacyRateLimiter } from '../middlewares/rateLimit.js';
import { orgGuard } from '../middlewares/auth.js';
import {
  getAbandonmentInsight, getAttendanceInsight, getBehaviourInsight, getCrowdInsight, getDemandInsight, getFraudInsight,
  getIntentInsight, getMlFlags, getMonitor, getModelOps, getReviewedCases, getAccountGraph, getGovernance,
} from '../controllers/mlInsightsController.js';
import {
  checkFraud,
  forecastDemand,
  scoreIntent,
  trainModel,
  getPredictionHistory,
  getFraudWatchlist,
  freezeUserAccount,
  unfreezeUserAccount,
  fraudReviewQueue,
  submitFraudReview,
  fraudReviewHistory,
  fraudReviewMetrics,
} from '../controllers/mlController.js';

const router = Router();

// Legacy scoring endpoints (Step 6): SUPER_ADMIN only and rate-limited. The app itself never calls them:
// checkout and the pre-launch page evaluate the same rules inside the API. They stay for diagnostics. Anonymous
// callers get 401, other roles 403 (test_ml_step6_api.mjs).
const legacy = [authenticateJWT, requireRole('SUPER_ADMIN'), mlLegacyRateLimiter];

router.post('/fraud/score', ...legacy, checkFraud);
router.post('/fraud-check', ...legacy, checkFraud);

router.post('/forecast/demand', ...legacy, forecastDemand);
router.post('/demand-forecast', ...legacy, forecastDemand);

router.post('/intent/predict', ...legacy, scoreIntent);
router.post('/intent-score', ...legacy, scoreIntent);

// Module 15 Model Retraining Trigger
router.post('/train/:modelType', authenticateJWT, requireRole('SUPER_ADMIN'), trainModel);

// Module 15 Persisted Scores & Predictions Query
router.get('/predictions', authenticateJWT, requireRole('SUPER_ADMIN'), getPredictionHistory);

// Super Admin Watchlist & Account Freeze Controls
router.get('/fraud-watchlist', authenticateJWT, requireRole('SUPER_ADMIN'), getFraudWatchlist);
router.post('/freeze-user/:userId', authenticateJWT, requireAdmin('admin.fraud'), freezeUserAccount);
router.post('/unfreeze-user/:userId', authenticateJWT, requireAdmin('admin.fraud'), unfreezeUserAccount);

// Blind fraud review: reviewers never see which detector flagged an order or any score.
// Metrics (sampling-weighted precision / recall / false-flag rate) are for super admins only.
router.get('/fraud-review/queue', authenticateJWT, requireAdmin('admin.fraud'), fraudReviewQueue);
router.post('/fraud-review/:sampleId', authenticateJWT, requireAdmin('admin.fraud'), submitFraudReview);
router.get('/fraud-review/:sampleId/history', authenticateJWT, requireAdmin('admin.fraud'), fraudReviewHistory);
router.get('/fraud-review-metrics', authenticateJWT, requireRole('SUPER_ADMIN'), fraudReviewMetrics);
// Resolved blind reviews beside the rule decision, model probability and its reasons (never shown to reviewers)
router.get('/fraud-review-cases', authenticateJWT, requireRole('SUPER_ADMIN'), getReviewedCases);
// Accounts linked by a shared phone number or browser (investigations); viewing counts as detector exposure
router.get('/account-graph/:userId', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getAccountGraph);

// Step 6: read-only AI insights (aggregates; rules decide everything) and the AI monitor
router.get('/flags', getMlFlags);
router.get('/monitor', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getMonitor);
router.get('/ops/:name', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getModelOps);
router.get('/governance', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getGovernance);
router.get('/insights/behaviour', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getBehaviourInsight);
router.get('/insights/fraud', authenticateJWT, requireRole('SUPER_ADMIN'), mlInsightsRateLimiter, getFraudInsight);
router.get('/insights/events/:id/intent', ...orgGuard('attendee.view'), mlInsightsRateLimiter, getIntentInsight);
router.get('/insights/events/:id/abandonment', ...orgGuard('attendee.view'), mlInsightsRateLimiter, getAbandonmentInsight);
router.get('/insights/events/:id/demand', ...orgGuard('event.pricing'), mlInsightsRateLimiter, getDemandInsight);
router.get('/insights/events/:id/attendance', ...orgGuard('event.view'), mlInsightsRateLimiter, getAttendanceInsight);
router.get('/insights/events/:id/crowd', ...orgGuard('gate.supervise'), mlInsightsRateLimiter, getCrowdInsight);

export default router;
