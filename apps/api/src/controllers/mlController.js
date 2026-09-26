import prisma from '../config/prisma.js';
import mlService from '../services/mlService.js';

/**
 * 1. AI Real-Time Fraud & Scalper Bot Check
 */
export const checkFraud = async (req, res) => {
  try {
    const telemetry = req.body || {};
    const userId = req.user?.id || null;
    const sessionId = req.headers['x-session-id'] || telemetry.sessionId || 'session_' + Math.random().toString(36).substring(7);

    const result = await mlService.checkFraudRisk(telemetry);

    // Record behavioral event in database
    await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId,
        action: 'AI_BOT_EVALUATION',
        metadata: {
          telemetry,
          fraudScore: result.fraud_score,
          isBot: result.is_bot,
          riskLevel: result.risk_level,
          anomalyFactors: result.anomaly_factors,
        },
      },
    });

    // If bot detected, log suspicious audit
    if (result.is_bot && userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'SCALPER_BOT_FLAGGED',
          targetType: 'User',
          targetId: userId,
          details: {
            fraudScore: result.fraud_score,
            riskLevel: result.risk_level,
            anomalyFactors: result.anomaly_factors,
            actionRecommended: result.action_recommended,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in fraud check controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Pre-Launch AI Demand Forecasting
 */
export const forecastDemand = async (req, res) => {
  try {
    const eventParams = req.body || {};
    const result = await mlService.forecastEventDemand(eventParams);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in demand forecast controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Purchase Intent & Abandonment Scoring
 */
export const scoreIntent = async (req, res) => {
  try {
    const sessionParams = req.body || {};
    const result = await mlService.scorePurchaseIntent(sessionParams);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in intent scoring controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Super Admin Fraud & Bot Watchlist Feed
 */
export const getFraudWatchlist = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Fetch flagged behavior events with high fraud score or bot flags
    const flaggedEvents = await prisma.behaviorEvent.findMany({
      where: {
        action: 'AI_BOT_EVALUATION',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            role: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    });

    const formatted = flaggedEvents.map((evt) => {
      const meta = evt.metadata || {};
      return {
        id: evt.id,
        sessionId: evt.sessionId,
        userId: evt.userId,
        user: evt.user,
        fraudScore: meta.fraudScore || 0,
        isBot: Boolean(meta.isBot),
        riskLevel: meta.riskLevel || 'LOW',
        anomalyFactors: meta.anomalyFactors || [],
        telemetry: meta.telemetry || {},
        timestamp: evt.createdAt,
      };
    });

    // Count stats
    const totalFlagged = formatted.length;
    const criticalBots = formatted.filter((f) => f.riskLevel === 'CRITICAL_BOT').length;
    const suspicious = formatted.filter((f) => f.riskLevel === 'SUSPICIOUS').length;

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          totalEvaluated: totalFlagged,
          criticalBots,
          suspicious,
        },
        watchlist: formatted,
      },
    });
  } catch (error) {
    console.error('Error fetching fraud watchlist:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Super Admin 1-Click Action to Freeze Fraudulent User Account
 */
export const freezeUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason = 'High AI Bot / Scalper Fraud Score' } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: 'FROZEN' },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_ACCOUNT_FROZEN_BY_ADMIN',
        targetType: 'User',
        targetId: userId,
        details: {
          targetEmail: user.email,
          reason,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Account for ${user.name} (${user.email}) has been FROZEN. All active booking and ticket operations are blocked.`,
      data: { user: updated },
    });
  } catch (error) {
    console.error('Error freezing user account:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Super Admin 1-Click Action to Unfreeze User Account
 */
export const unfreezeUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_ACCOUNT_UNFROZEN_BY_ADMIN',
        targetType: 'User',
        targetId: userId,
        details: { targetEmail: user.email },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Account for ${user.name} (${user.email}) has been restored to ACTIVE status.`,
      data: { user: updated },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
