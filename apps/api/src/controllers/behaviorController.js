import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

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
    const profile = await behaviorService.getUserBehavioralProfile(userId);

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
