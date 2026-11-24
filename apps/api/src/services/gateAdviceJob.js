/**
 * Gate advice as a background job. "Tell ticket holders their gate" can mean thousands of in-app messages and
 * emails, so the request only queues a run (GateAdviceRun) and returns; the run is sent here, right away in the
 * same process and, as a fallback, by the one-minute job in server.js (after a restart, or on another server).
 *
 * Never twice:
 *   - one QUEUED or RUNNING run per event (partial unique index, migration 20261124140000): a double click or a
 *     second manager gets the run that is already going;
 *   - a run is claimed QUEUED -> RUNNING by one worker only (conditional update);
 *   - each person is recorded (GateAdviceDelivery, unique per event + person + advice) BEFORE their message, so a
 *     second run, or a run restarted after a crash, skips everyone who already got the same advice. People whose
 *     gate changed since (a new plan) do get the new advice. A failed message is un-recorded so a later run retries.
 * A run left RUNNING for STALE_MIN minutes (the server stopped mid-run) is queued again and resumes the same way.
 */
import prisma from '../config/prisma.js';
import { gateLoadPlan, notifyGatePlan } from './gateLoadPlan.js';
import { GateError } from './checkinService.js';
import { dispatchNotification } from './notificationService.js';
import { eventTiming, TIMING_SELECT } from './eventTiming.js';

const STALE_MIN = 15;
const isUniqueViolation = (e) => e?.code === 'P2002';

export const runView = (r) => r && ({
  id: r.id, status: r.status, people: r.people, sent: r.sent, failed: r.failed, skipped: r.skipped,
  error: r.error, createdAt: r.createdAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
});

/** Advice is only useful before the event ends, and never for a cancelled event. */
async function adviceRefusal(eventId, now) {
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: TIMING_SELECT });
  if (!ev) return 'Event not found.';
  if (ev.status === 'CANCELLED') return 'This event was cancelled, so no gate advice is sent.';
  if (eventTiming(ev, now).ended) return 'This event has ended, so no gate advice is sent.';
  return null;
}

/**
 * Queues a run for the event (the request handler). Returns { run, created }: created is false when a run for
 * this event was already queued or sending, which is then returned instead of starting a second one.
 */
export async function queueGateAdvice(event, user, { now = new Date(), start = true } = {}) {
  const refusal = await adviceRefusal(event.id, now);
  if (refusal) throw new GateError(409, refusal, 'ADVICE_REFUSED');
  // Same check as the send itself, so the manager hears it now rather than from a failed run
  const plan = await gateLoadPlan(event, { now });
  if (!plan.ready) throw new GateError(409, plan.message, 'PLAN_NOT_READY');
  const active = () => prisma.gateAdviceRun.findFirst({ where: { eventId: event.id, status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
  const existing = await active();
  if (existing) return { run: existing, created: false };
  let run;
  let created = true;
  try {
    run = await prisma.gateAdviceRun.create({ data: { eventId: event.id, companyId: event.companyId ?? null, requestedById: user.id } });
  } catch (e) {
    // Two requests at the same moment: the database let only one create the run (partial unique index)
    if (!isUniqueViolation(e)) throw e;
    created = false;
    run = await active();
    if (!run) throw new GateError(409, 'Gate advice for this event was just sent. Refresh to see the result.', 'ADVICE_JUST_SENT');
  }
  if (start && created) setImmediate(() => { processGateAdvice().catch((e) => console.error('[Gate advice] failed:', e.message)); });
  return { run, created };
}

/** The latest run for an event (for the page to show progress and the result), or null. */
export const latestGateAdvice = (eventId) => prisma.gateAdviceRun.findFirst({ where: { eventId }, orderBy: { createdAt: 'desc' } });

/** Sends one claimed run. */
async function sendRun(run, { dispatch, now }) {
  const refusal = await adviceRefusal(run.eventId, now);
  if (refusal) return prisma.gateAdviceRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: refusal, finishedAt: new Date() } });
  const event = await prisma.event.findUnique({ where: { id: run.eventId }, select: { id: true, name: true, companyId: true } });
  try {
    const out = await notifyGatePlan(event, { id: run.requestedById }, {
      dispatch,
      now,
      // skipDuplicates: an existing record (same person, same advice) inserts nothing and is not an error
      claim: async (userId, adviceKey) => (await prisma.gateAdviceDelivery.createMany({ data: [{ runId: run.id, eventId: run.eventId, userId, adviceKey }], skipDuplicates: true })).count === 1,
      release: (userId, adviceKey) => prisma.gateAdviceDelivery.deleteMany({ where: { eventId: run.eventId, userId, adviceKey, runId: run.id } }),
    });
    return prisma.gateAdviceRun.update({
      where: { id: run.id },
      data: { status: 'DONE', people: out.people, sent: out.sent, failed: out.failed, skipped: out.skipped, finishedAt: new Date() },
    });
  } catch (e) {
    return prisma.gateAdviceRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: String(e.message || e).slice(0, 500), finishedAt: new Date() } });
  }
}

let busy = false;
let again = false; // a run was queued while this server was already sending: look once more before stopping

/**
 * Sends every queued run (oldest first). Safe to call often and from several servers: a run is sent by whoever
 * claims it. Returns { runs } = number of runs this call sent.
 */
export async function processGateAdvice({ dispatch = dispatchNotification, now = () => new Date() } = {}) {
  if (busy) {
    again = true;
    return { runs: 0, busy: true };
  }
  busy = true;
  try {
    // Runs left RUNNING by a server that stopped: queue again (their deliveries so far are kept and skipped)
    await prisma.gateAdviceRun.updateMany({ where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_MIN * 60_000) } }, data: { status: 'QUEUED' } });
    let runs = 0;
    for (;;) {
      again = false;
      const next = await prisma.gateAdviceRun.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      if (!next) {
        if (again) continue;
        break;
      }
      const claimed = await prisma.gateAdviceRun.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
      if (!claimed.count) continue;
      await sendRun(next, { dispatch, now: now() });
      runs += 1;
    }
    return { runs };
  } finally {
    busy = false;
  }
}
