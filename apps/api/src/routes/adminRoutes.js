import { Router } from 'express';
import { authenticateJWT, requireRole, orgGuard } from '../middlewares/auth.js';
import {
  getSuperAdminMetrics,
  getUsersList,
  updateUserStatus,
  getAllEventsAdmin,
  getAllTransactionsAdmin,
  getBlockchainLogs,
  getFraudAlerts,
  getGateScanLogs,
  getAuditLogs,
  getOrganizerDashboard,
} from '../controllers/adminController.js';
import { listEventsForReview, reviewEvent, getPendingCounts } from '../controllers/eventReviewController.js';
import { listPromotions, reviewPromotion } from '../controllers/promotionController.js';
import { listMints, retryMints, resolveMint, continueMintResolution, verifyMint } from '../controllers/mintAdminController.js';
import { listScheduleChanges, reviewScheduleChange, listRefunds, retryRefundsHandler } from '../controllers/lifecycleController.js';
import { requireAdmin } from '../services/adminAccess.js';
import * as consoleCtl from '../controllers/adminConsoleController.js';

const router = Router();

// Guard middlewares
const superAdminGuard = [authenticateJWT, requireRole(['SUPER_ADMIN'])];
// One admin permission per area (services/adminAccess.js); admins without a role are Owners (everything)
const admin = (permission) => [authenticateJWT, requireAdmin(permission)];
const organizerOrAdminGuard = orgGuard('event.view');

// Super Admin Command Center Endpoints
router.get('/metrics', admin('admin.view'), getSuperAdminMetrics);
router.get('/users', admin('admin.view'), getUsersList);
router.put('/users/:id/status', admin('admin.users'), updateUserStatus);
router.get('/events', admin('admin.view'), getAllEventsAdmin);
// Event approvals: queue of submitted events, and approve / reject (with comment)
router.get('/pending-counts', admin('admin.view'), getPendingCounts);
router.get('/event-reviews', admin('admin.approvals'), listEventsForReview);
router.post('/event-reviews/:id', admin('admin.approvals'), reviewEvent);
router.get('/promotions', admin('admin.approvals'), listPromotions);
router.post('/promotions/:id', admin('admin.approvals'), reviewPromotion);
router.get('/schedule-changes', admin('admin.approvals'), listScheduleChanges);
router.post('/schedule-changes/:id', admin('admin.approvals'), reviewScheduleChange);
router.get('/refunds', admin('admin.finance'), listRefunds);
router.post('/refunds/retry', admin('admin.finance'), retryRefundsHandler);
router.get('/mints', admin('admin.view'), listMints);
router.post('/mints/retry', admin('admin.approvals'), retryMints);
router.post('/mints/:ticketId/resolve', admin('admin.approvals'), resolveMint);
router.post('/mints/:ticketId/verify', admin('admin.view'), verifyMint);
router.post('/mint-resolutions/:id/continue', admin('admin.approvals'), continueMintResolution);
router.get('/transactions', admin('admin.view'), getAllTransactionsAdmin);
router.get('/blockchain-logs', admin('admin.view'), getBlockchainLogs);
router.get('/fraud-alerts', admin('admin.fraud'), getFraudAlerts);
router.get('/gate-scans', admin('admin.view'), getGateScanLogs);
router.get('/audit-logs', admin('admin.view'), getAuditLogs);

// Admin console: my access, finance, settings, platform notifications, exports, investigations, undo, admins
router.get('/me', admin('admin.view'), consoleCtl.me);
router.get('/finance', admin('admin.finance'), consoleCtl.finance);
router.get('/config', admin('admin.view'), consoleCtl.getConfig);
router.put('/config/:key', admin('admin.config'), consoleCtl.setConfig);
router.get('/broadcasts', admin('admin.notify'), consoleCtl.listBroadcasts);
router.get('/broadcasts/audience', admin('admin.notify'), consoleCtl.previewAudience);
router.post('/broadcasts', admin('admin.notify'), consoleCtl.sendBroadcast);
router.post('/broadcasts/:id/cancel', admin('admin.notify'), consoleCtl.cancelBroadcast);
router.get('/exports', admin('admin.export'), consoleCtl.datasets);
router.get('/exports/:dataset', admin('admin.export'), consoleCtl.exportData);
router.get('/investigations', admin('admin.fraud'), consoleCtl.listCases);
router.post('/investigations', admin('admin.fraud'), consoleCtl.openCase);
router.get('/investigations/:id', admin('admin.fraud'), consoleCtl.getCase);
router.post('/investigations/:id/notes', admin('admin.fraud'), consoleCtl.addCaseNote);
router.patch('/investigations/:id', admin('admin.fraud'), consoleCtl.updateCase);
router.get('/actions', admin('admin.view'), consoleCtl.listActions);
router.post('/actions/:id/undo', admin('admin.view'), consoleCtl.undoAction);
router.get('/admins', admin('admin.admins'), consoleCtl.listAdmins);
router.post('/admins', admin('admin.admins'), consoleCtl.addAdmin);
router.patch('/admins/:id', admin('admin.admins'), consoleCtl.updateAdmin);
router.delete('/admins/:id', admin('admin.admins'), consoleCtl.removeAdmin);

// Organizer Analytics Dashboard Endpoint
router.get('/organizer-dashboard', organizerOrAdminGuard, getOrganizerDashboard);

export default router;
