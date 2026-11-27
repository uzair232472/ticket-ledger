/**
 * Step 6: read-only AI insight and monitor endpoints. Every answer is labelled decision_source 'rules' and every
 * experimental block says may_serve_decisions:false / validated:false. Organizers get the rules part only unless
 * ML_INSIGHTS_ORGANIZER is on, and never anything about an individual customer (insights.js answers are aggregates).
 */
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { mlFlags, publicMlFlags } from '../config/mlFlags.js';
import { canAccessEvent } from '../services/orgAccess.js';
import {
  abandonmentInsight, attendanceInsight, behaviourInsight, crowdInsight, demandInsight, fraudInsight, intentInsight,
} from '../services/ml/insights.js';
import { MONITORED, governanceSnapshot, modelOps, monitorSnapshot } from '../services/ml/monitor.js';
import { reviewedCases, recordWatchlistView } from '../services/ml/fraudReview.js';
import { accountGraph } from '../services/ml/accountLinks.js';

const disabled = (res) => res.json({ success: true, data: { enabled: false, decision_source: 'rules', reason: 'ML_INSIGHTS_ENABLED is off' } });

/** Organizers see the rules part; the experimental block is withheld unless ML_INSIGHTS_ORGANIZER is on. */
export function forViewer(answer, user, flags = mlFlags()) {
  if (user?.role === 'SUPER_ADMIN' || flags.organizerInsights) return { enabled: true, ...answer };
  const { experimental, ...rest } = answer;
  return {
    enabled: true,
    ...rest,
    experimental: {
      model: experimental?.model ?? null, status: experimental?.status ?? null, may_serve_decisions: false, validated: false,
      value: null, hidden: true, unavailable_reason: 'ORGANIZER_VIEW_RULES_ONLY',
    },
  };
}

const fail = (res, error, what) => {
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: 'Invalid request' });
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  console.error(`[ML insights] ${what} failed:`, error.message);
  return res.status(500).json({ success: false, message: 'Could not load the insight.' });
};

/** GET /api/ml/flags (public: booleans only) */
export const getMlFlags = (req, res) => res.json({ success: true, data: publicMlFlags() });

const eventInsight = (feature, permission, fn) => async (req, res) => {
  try {
    if (!mlFlags().insights) return disabled(res);
    const id = z.string().uuid().parse(req.params.id);
    const event = await prisma.event.findUnique({ where: { id }, select: { id: true, companyId: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canAccessEvent(req.user, event, { permission, req }))) return res.status(403).json({ success: false, message: 'You cannot view insights for this event.' });
    return res.json({ success: true, data: forViewer(await fn(id, req), req.user) });
  } catch (error) {
    return fail(res, error, feature);
  }
};

const whatIfSchema = z.object({
  price: z.coerce.number().positive().max(10_000_000).optional(),
  capacity: z.coerce.number().int().positive().max(1_000_000).optional(),
});

export const getIntentInsight = eventInsight('intent', 'attendee.view', (id) => intentInsight(id));
export const getAbandonmentInsight = eventInsight('abandonment', 'attendee.view', (id) => abandonmentInsight(id));
export const getDemandInsight = eventInsight('demand', 'event.pricing', (id, req) => {
  const w = whatIfSchema.parse(req.query || {});
  return demandInsight(id, { whatIf: w.price || w.capacity ? w : null });
});
export const getAttendanceInsight = eventInsight('attendance', 'event.view', (id) => attendanceInsight(id));
export const getCrowdInsight = eventInsight('crowd', 'gate.supervise', (id) => crowdInsight(id));

const adminInsight = (feature, fn) => async (req, res) => {
  try {
    if (!mlFlags().insights) return disabled(res);
    return res.json({ success: true, data: { enabled: true, ...(await fn()) } });
  } catch (error) {
    return fail(res, error, feature);
  }
};
export const getBehaviourInsight = adminInsight('behaviour', () => behaviourInsight());
export const getFraudInsight = adminInsight('fraud', () => fraudInsight());
export const getMonitor = adminInsight('monitor', () => monitorSnapshot());
/** GET /api/ml/governance (SUPER_ADMIN): go-live readiness of every model + the governance report data. */
export const getGovernance = adminInsight('governance', () => governanceSnapshot());

/** GET /api/ml/ops/:name (SUPER_ADMIN): offline model card + live input drift. */
export const getModelOps = async (req, res) => {
  try {
    if (!mlFlags().insights) return disabled(res);
    const name = z.enum(MONITORED.map((m) => m.name)).parse(req.params.name);
    return res.json({ success: true, data: { enabled: true, ...(await modelOps(name)) } });
  } catch (error) {
    return fail(res, error, 'model ops');
  }
};

/** GET /api/ml/fraud-review-cases (SUPER_ADMIN): resolved blind reviews next to the rule and the shadow model. */
export const getReviewedCases = async (req, res) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit ?? undefined);
    return res.json({ success: true, data: { decision_source: 'rules', cases: await reviewedCases({ limit }) } });
  } catch (error) {
    return fail(res, error, 'reviewed cases');
  }
};

/**
 * GET /api/ml/account-graph/:userId (SUPER_ADMIN): accounts linked by a shared phone number or browser.
 * Viewing it is recorded as seeing detector output for every account shown, so later reviews of those accounts
 * by this admin are not counted as blind.
 */
export const getAccountGraph = async (req, res) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const depth = z.coerce.number().int().min(1).max(3).default(2).parse(req.query.depth ?? undefined);
    const graph = await accountGraph(userId, { depth });
    if (!graph.nodes.length) return res.status(404).json({ success: false, message: 'Account not found' });
    await recordWatchlistView(req.user.id, graph.nodes.map((n) => n.id), prisma, 'account_graph');
    return res.json({ success: true, data: graph });
  } catch (error) {
    return fail(res, error, 'account graph');
  }
};
