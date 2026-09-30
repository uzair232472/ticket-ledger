import intentAnalyticsService from '../services/intentAnalyticsService.js';

/**
 * 1. Get Event Purchase Intent Analytics, Conversion Funnel, and Watchers
 */
export const getEventIntentAnalytics = async (req, res) => {
  try {
    const { eventId } = req.params;
    const analytics = await intentAnalyticsService.getEventIntentAnalytics(eventId, req.user);
    return res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('Error fetching event intent analytics:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to fetch intent analytics',
    });
  }
};

/**
 * 2. Send Reminder to a Specific High-Intent / Abandoned Attendee
 */
export const sendAttendeeReminder = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { targetUserId, reminderType, customMessage } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'targetUserId is required to dispatch a reminder',
      });
    }

    const result = await intentAnalyticsService.sendAttendeeReminder({
      eventId,
      targetUserId,
      reminderType,
      customMessage,
      requesterUser: req.user,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error sending attendee reminder:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to send reminder',
    });
  }
};

/**
 * 3. Batch Dispatch Reminders to Audience (High Intent or Abandoned)
 */
export const sendBatchAttendeeReminders = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { targetAudience = 'HIGH_INTENT' } = req.body;

    const result = await intentAnalyticsService.sendBatchAttendeeReminders({
      eventId,
      targetAudience,
      requesterUser: req.user,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error sending batch attendee reminders:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to send batch reminders',
    });
  }
};

/**
 * 4. Get Abandoned Intent Dashboard (Users who viewed, selected seat, started checkout, abandoned, didn't buy)
 */
export const getAbandonedDashboard = async (req, res) => {
  try {
    const { eventId, minScore, reason, limit } = req.query;
    const data = await intentAnalyticsService.getAbandonedIntentDashboard({
      eventId,
      minScore,
      reason,
      limit: limit ? parseInt(limit, 10) : 50,
      requesterUser: req.user,
    });
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching abandoned intent dashboard:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to fetch abandoned intent dashboard',
    });
  }
};

/**
 * 5. Send Recovery Reminder to Single Abandoned Prospect
 */
export const sendAbandonedReminder = async (req, res) => {
  try {
    const { targetUserId, eventId, customMessage, discountCode } = req.body;
    if (!targetUserId || !eventId) {
      return res.status(400).json({
        success: false,
        message: 'targetUserId and eventId are required',
      });
    }

    const result = await intentAnalyticsService.sendAbandonedCartReminder({
      targetUserId,
      eventId,
      customMessage,
      discountCode,
      requesterUser: req.user,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error sending abandoned cart reminder:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to send abandoned cart reminder',
    });
  }
};

/**
 * 6. Send Batch Recovery Reminders to All Abandoned Users
 */
export const sendBatchAbandonedReminders = async (req, res) => {
  try {
    const { eventId, discountCode } = req.body;
    const result = await intentAnalyticsService.sendBatchAbandonedCartReminders({
      eventId,
      discountCode,
      requesterUser: req.user,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error sending batch abandoned cart reminders:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to send batch abandoned reminders',
    });
  }
};

export default {
  getEventIntentAnalytics,
  sendAttendeeReminder,
  sendBatchAttendeeReminders,
  getAbandonedDashboard,
  sendAbandonedReminder,
  sendBatchAbandonedReminders,
};

