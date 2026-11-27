import prisma from '../config/prisma.js';
import { recordProfileView } from '../services/ml/fraudReview.js';
import { getScopedEventIds } from '../services/accessService.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import { behaviourReport, customerTimeline } from '../services/behaviourReport.js';

/**
 * 1. Track a behavioral event from client or background
 */
export const recordClientEvent = async (req, res) => {
  try {
    const { action, eventId, metadata, sessionId } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Action is required. Valid actions: ' + Object.values(BEHAVIOR_ACTIONS).join(', '),
      });
    }

    const recorded = await behaviorService.trackBehavior({
      req,
      userId: req.user?.id || null,
      sessionId: sessionId || req.headers['x-session-id'] || null,
      action,
      eventId: eventId || null,
      metadata: metadata || {},
    });

    return res.status(200).json({
      success: true,
      message: `Behavioral event '${action}' tracked successfully`,
      data: recorded,
    });
  } catch (error) {
    console.error('[BehaviorController] recordClientEvent error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Get current authenticated user's behavioral profile
 */
export const getMyBehaviorProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.headers['x-session-id'] || null;
    const profile = await behaviorService.getUserBehavioralProfile(userId, sessionId);

    return res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('[BehaviorController] getMyBehaviorProfile error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Super Admin / Organizer inspect any user's behavioral profile
 */
export const getUserBehaviorProfileById = async (req, res) => {
  try {
    const { userId } = req.params;
    // Super Admins see the platform-wide profile. Organization members (attendee.view) see only behaviour on
    // their organization's events they cover, and only for people who bought tickets to one of them.
    if (req.user.role === 'SUPER_ADMIN') {
      const profile = await behaviorService.getUserBehavioralProfile(userId);
      // Shows the account's fraud score: logged so a later blind fraud review by this admin is marked exposed
      await recordProfileView(req.user.id, userId).catch(() => {});
      return res.status(200).json({ success: true, data: profile });
    }
    const eventIds = await getScopedEventIds(req.user, 'attendee.view');
    const customer = eventIds.length
      ? await prisma.order.findFirst({ where: { userId, eventId: { in: eventIds }, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, select: { id: true } })
      : null;
    if (!customer) {
      return res.status(404).json({ success: false, message: 'No attendee with this id on your events.' });
    }
    const profile = await behaviorService.getUserBehavioralProfile(userId, null, { eventIds });
    return res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('[BehaviorController] getUserBehaviorProfileById error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Explicitly attach guest session to user
 */
export const linkSessionToUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required' });
    }

    const result = await behaviorService.attachSessionToUser({ sessionId, userId });

    return res.status(200).json({
      success: true,
      message: `Attached ${result.count} past behavioral events to user profile`,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  recordClientEvent,
  getMyBehaviorProfile,
  getUserBehaviorProfileById,
  linkSessionToUser,
};

/**
 * 5. Super admin behaviour report: what happened, on which event, by which customer (counts only, no model)
 */
export const getBehaviourReport = async (req, res) => {
  try {
    const { days, eventId, scope } = req.query;
    const data = await behaviourReport({ days, eventId: typeof eventId === 'string' && eventId ? eventId : null, scope });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[BehaviorController] getBehaviourReport error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

/** 6. One customer's timeline (super admin) */
export const getCustomerTimeline = async (req, res) => {
  try {
    const { eventId, limit } = req.query;
    const data = await customerTimeline({ userId: req.params.userId, eventId: typeof eventId === 'string' && eventId ? eventId : null, limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
