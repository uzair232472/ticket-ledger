import prisma from '../config/prisma.js';
import mlService from '../services/mlService.js';

/**
 * 1. AI Real-Time Fraud & Scalper Bot Check (Module 15: Calls FastAPI /fraud/score and saves score)
 */
export const checkFraud = async (req, res) => {
  try {
    const telemetry = req.body || {};
    const userId = req.user?.id || null;
    const sessionId = req.headers['x-session-id'] || telemetry.sessionId || 'session_' + Math.random().toString(36).substring(7);

    // Call FastAPI ML service
    const result = await mlService.checkFraudRisk(telemetry);

    // Persist ML prediction and returned score in database
    const savedEvent = await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId,
        action: 'AI_BOT_EVALUATION',
        metadata: {
          telemetry,
          fraudScore: result.fraud_score,
          classification: result.classification || (result.is_bot ? 'HIGH_RISK_BOT' : 'NORMAL'),
          isBot: result.is_bot,
          riskLevel: result.risk_level,
          actionRecommended: result.action_recommended,
          anomalyFactors: result.anomaly_factors,
          confidence: result.confidence,
          savedAt: new Date().toISOString(),
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
            predictionEventId: savedEvent.id,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        saved_prediction_id: savedEvent.id,
      },
    });
  } catch (error) {
    console.error('Error in fraud check controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Pre-Launch AI Demand Forecasting (Module 15: Calls FastAPI /forecast/demand and saves score)
 */
export const forecastDemand = async (req, res) => {
  try {
    const eventParams = req.body || {};
    const userId = req.user?.id || null;
    const sessionId = req.headers['x-session-id'] || 'demand_' + Math.random().toString(36).substring(7);

    // Call FastAPI ML service
    const result = await mlService.forecastEventDemand(eventParams);

    // Persist ML prediction and returned score in database
    const savedEvent = await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId,
        action: 'AI_DEMAND_FORECAST',
        eventId: eventParams.eventId || null,
        metadata: {
          eventParams,
          projected48hSales: result.projected_48h_sales,
          projectedRevenuePkr: result.projected_revenue_pkr,
          selloutProbability: result.sellout_probability,
          demandTier: result.demand_tier,
          demandLevel: result.demand_level || result.demand_tier,
          pricingRecommendation: result.pricing_recommendation,
          savedAt: new Date().toISOString(),
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        saved_prediction_id: savedEvent.id,
      },
    });
  } catch (error) {
    console.error('Error in demand forecast controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Purchase Intent & Abandonment Scoring (Module 15: Calls FastAPI /intent/predict and saves score)
 */
export const scoreIntent = async (req, res) => {
  try {
    const sessionParams = req.body || {};
    const userId = req.user?.id || null;
    const sessionId = req.headers['x-session-id'] || sessionParams.sessionId || 'session_' + Math.random().toString(36).substring(7);

    // Call FastAPI ML service
    const result = await mlService.scorePurchaseIntent(sessionParams);

    // Persist ML prediction and returned score in database
    const savedEvent = await prisma.behaviorEvent.create({
      data: {
        userId,
        sessionId,
        action: 'AI_INTENT_EVALUATION',
        metadata: {
          sessionParams,
          purchaseIntentScore: result.purchase_intent_score ?? result.intent_score,
          intentScore: result.intent_score,
          intentLevel: result.intent_level,
          suggestedAction: result.suggested_action,
          savedAt: new Date().toISOString(),
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        saved_prediction_id: savedEvent.id,
      },
    });
  } catch (error) {
    console.error('Error in intent scoring controller:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Trigger Model Retraining (Module 15: Calls FastAPI /train/:modelType)
 */
export const trainModel = async (req, res) => {
  try {
    const { modelType = 'fraud' } = req.params;
    const userId = req.user?.id || null;

    // Call FastAPI ML retraining endpoint
    const result = await mlService.triggerModelTraining(modelType);

    // Record audit log of model retraining
    if (userId) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'ML_MODEL_RETRAINED',
          targetType: 'MLModel',
          targetId: modelType,
          details: {
            modelName: result.model_name,
            durationSeconds: result.duration_seconds,
            metrics: result.metrics,
            retrainedAt: result.timestamp,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error retraining model:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Query Persisted ML Predictions History
 */
export const getPredictionHistory = async (req, res) => {
  try {
    const { action, limit = 50 } = req.query;

    const validActions = ['AI_BOT_EVALUATION', 'AI_INTENT_EVALUATION', 'AI_DEMAND_FORECAST'];
    const filterAction = action && validActions.includes(action) ? action : { in: validActions };

    const predictions = await prisma.behaviorEvent.findMany({
      where: {
        action: filterAction,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    });

    return res.status(200).json({
      success: true,
      data: {
        total: predictions.length,
        predictions: predictions.map((p) => ({
          id: p.id,
          action: p.action,
          userId: p.userId,
          user: p.user,
          sessionId: p.sessionId,
          scores: p.metadata,
          timestamp: p.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching prediction history:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Super Admin Fraud & Bot Watchlist Feed
 */
export const getFraudWatchlist = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

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
        classification: meta.classification || (meta.isBot ? 'HIGH_RISK_BOT' : 'NORMAL'),
        anomalyFactors: meta.anomalyFactors || [],
        telemetry: meta.telemetry || {},
        timestamp: evt.createdAt,
      };
    });

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
 * 7. Super Admin 1-Click Action to Freeze Fraudulent User Account
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
 * 8. Super Admin 1-Click Action to Unfreeze User Account
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

export default {
  checkFraud,
  forecastDemand,
  scoreIntent,
  trainModel,
  getPredictionHistory,
  getFraudWatchlist,
  freezeUserAccount,
  unfreezeUserAccount,
};
