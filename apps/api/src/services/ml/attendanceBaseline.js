/**
 * Attendance baseline: tickets sold x the historical show rate of past finished events.
 * Replaces the fixed percentages (it was clearly better in the leakage-free comparison:
 * apps/ml-service/reports/v0/attendance_baseline_comparison.md). Mirrors
 * ml/baselines.py: attendance_show_rate / attendance_current_rule.
 *
 *  - Counted tickets: live passes (ACTIVE / SCANNED) of events that have finished (endsAt, or start + 4 h)
 *    before `at`, excluding cancelled events. Refunded tickets (CANCELLED) and retired records of moved
 *    passes (TRANSFERRED / RESOLD) are not counted.
 *  - Attended: checkedInAt is set (a reversed first admission clears it).
 *  - Same event type with >= 200 such tickets, else all types with >= 200, else the old fixed rule - so
 *    on day one the app behaves exactly as before and switches over as check-ins build up.
 */
import prisma from '../../config/prisma.js';

export const MIN_TICKETS = 200;
const CACHE_MS = 10 * 60_000;
let cache = { at: 0, rows: null };

/** The previous rule (organizerDashboardService): fixed % by type, +2 points in Lahore/Karachi, 65..98. */
export function fixedRule(type, city) {
  let rate = 88.5;
  const factors = [];
  if (type === 'CRICKET_MATCH') {
    rate = 92.4;
    factors.push('High fan enthusiasm for live cricket match');
  } else if (type === 'MUSIC_CONCERT' || type === 'MUSIC_FESTIVAL') {
    rate = 86.8;
    factors.push('Weekend music concert profile with average 13% no-show buffer');
  } else if (type === 'KABADDI') {
    rate = 89.1;
    factors.push('Strong regional sports audience loyalty');
  }
  if (city === 'Lahore' || city === 'Karachi') {
    rate += 2.0;
    factors.push(`Metro city venue (${city}) minimizes commute attrition`);
  }
  return { rate: Math.min(98, Math.max(65, Math.round(rate * 10) / 10)), factors };
}

async function historyByType(at) {
  if (cache.rows && Date.now() - cache.at < CACHE_MS && Math.abs(at - cache.asOf) < CACHE_MS) return cache.rows;
  const rows = await prisma.$queryRaw`
    SELECT e."type"::text AS type, COUNT(*)::int AS tickets, COUNT(t."checkedInAt")::int AS attended
    FROM "Ticket" t JOIN "Event" e ON e."id" = t."eventId"
    WHERE t."status" IN ('ACTIVE', 'SCANNED')
      AND e."cancelledAt" IS NULL
      AND COALESCE(e."endsAt", COALESCE(e."startsAt", e."date") + INTERVAL '4 hours') < (${new Date(at).toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY e."type"`;
  cache = { at: Date.now(), asOf: at, rows };
  return rows;
}

export const clearAttendanceCache = () => { cache = { at: 0, rows: null }; };

/** @returns {{rate:number, basis:'HISTORY_TYPE'|'HISTORY_ALL'|'FIXED_RULE', tickets:number, factors:string[]}} rate in % */
export async function showRate({ type, city }, at = new Date()) {
  const rows = await historyByType(at);
  const own = rows.find((r) => r.type === type);
  if (own && own.tickets >= MIN_TICKETS) {
    const rate = Math.round((own.attended / own.tickets) * 1000) / 10;
    return { rate, basis: 'HISTORY_TYPE', tickets: own.tickets, factors: [`${rate}% of ${own.tickets.toLocaleString()} tickets for past events of this type were checked in`] };
  }
  const tickets = rows.reduce((a, r) => a + r.tickets, 0);
  if (tickets >= MIN_TICKETS) {
    const rate = Math.round((rows.reduce((a, r) => a + r.attended, 0) / tickets) * 1000) / 10;
    return { rate, basis: 'HISTORY_ALL', tickets, factors: [`${rate}% of ${tickets.toLocaleString()} tickets for all past events were checked in (too few for this event type yet)`] };
  }
  const f = fixedRule(type, city);
  return { rate: f.rate, basis: 'FIXED_RULE', tickets, factors: [...f.factors, 'Standard estimate until enough past check-ins exist'] };
}
