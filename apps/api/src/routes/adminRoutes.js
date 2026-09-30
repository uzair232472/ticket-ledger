import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/auth.js';
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

const router = Router();

// Guard middlewares
const superAdminGuard = [authenticateJWT, requireRole(['SUPER_ADMIN'])];
const organizerOrAdminGuard = [authenticateJWT, requireRole(['ORGANIZER', 'SUPER_ADMIN'])];

// Super Admin Command Center Endpoints
router.get('/metrics', superAdminGuard, getSuperAdminMetrics);
router.get('/users', superAdminGuard, getUsersList);
router.put('/users/:id/status', superAdminGuard, updateUserStatus);
router.get('/events', superAdminGuard, getAllEventsAdmin);
router.get('/transactions', superAdminGuard, getAllTransactionsAdmin);
router.get('/blockchain-logs', superAdminGuard, getBlockchainLogs);
router.get('/fraud-alerts', superAdminGuard, getFraudAlerts);
router.get('/gate-scans', superAdminGuard, getGateScanLogs);
router.get('/audit-logs', superAdminGuard, getAuditLogs);

// Organizer Analytics Dashboard Endpoint
router.get('/organizer-dashboard', organizerOrAdminGuard, getOrganizerDashboard);

export default router;
