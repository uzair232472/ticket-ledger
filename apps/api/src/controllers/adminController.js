import adminService from '../services/adminService.js';
import organizerDashboardService from '../services/organizerDashboardService.js';

/**
 * 1. Super Admin Overview Metrics
 */
export const getSuperAdminMetrics = async (req, res) => {
  try {
    const data = await adminService.getSuperAdminMetrics();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getSuperAdminMetrics:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. User Management Directory
 */
export const getUsersList = async (req, res) => {
  try {
    const { page, limit, search, role, status } = req.query;
    const data = await adminService.getUsersList({ page, limit, search, role, status });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getUsersList:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Update User Status (Freeze / Unfreeze / Blacklist)
 */
export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required (ACTIVE, SUSPENDED, BANNED, DEACTIVATED)' });
    }

    const result = await adminService.updateUserStatus({
      userId: id,
      status,
      reason,
      adminUser: req.user,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in updateUserStatus:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

/**
 * 4. Events Directory
 */
export const getAllEventsAdmin = async (req, res) => {
  try {
    const { page, limit, search, status, city } = req.query;
    const data = await adminService.getAllEventsAdmin({ page, limit, search, status, city });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getAllEventsAdmin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Transactions Directory
 */
export const getAllTransactionsAdmin = async (req, res) => {
  try {
    const { page, limit, search, status, paymentMethod } = req.query;
    const data = await adminService.getAllTransactionsAdmin({ page, limit, search, status, paymentMethod });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getAllTransactionsAdmin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Blockchain Smart Contract Logs
 */
export const getBlockchainLogs = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const data = await adminService.getBlockchainLogs({ page, limit, search });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getBlockchainLogs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Fraud & Bot Alerts
 */
export const getFraudAlerts = async (req, res) => {
  try {
    const { page, limit, minScore } = req.query;
    const data = await adminService.getFraudAlerts({ page, limit, minScore });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getFraudAlerts:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 8. Gate Turnstile Scan Logs
 */
export const getGateScanLogs = async (req, res) => {
  try {
    const { page, limit, eventId, result } = req.query;
    const data = await adminService.getGateScanLogs({ page, limit, eventId, result });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getGateScanLogs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 9. System Audit Logs
 */
export const getAuditLogs = async (req, res) => {
  try {
    const { page, limit, action, search } = req.query;
    const data = await adminService.getAuditLogs({ page, limit, action, search });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getAuditLogs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 10. Organizer Analytics Dashboard Metrics
 */
export const getOrganizerDashboard = async (req, res) => {
  try {
    const { eventId } = req.query;
    const data = await organizerDashboardService.getOrganizerDashboardMetrics({
      organizerUser: req.user,
      eventId,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error in getOrganizerDashboard:', error);
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

export default {
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
};
