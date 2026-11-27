/**
 * Account links for the fraud model's inputs and the admin account-graph view. READ-ONLY: nothing here changes
 * an order, payment, ticket, account or checkout, and no decision path reads it (checkout calls only the rules).
 *
 * Two accounts are LINKED when, before the moment in question,
 *   - they had the same phone number (digits only, last 10: "+92 300 1234567" = "03001234567"), or
 *   - they used the same browser (the x-session-id the web app keeps in localStorage, seen in BehaviorEvent).
 * A shared family phone or a shared computer links accounts too; links are evidence for a reviewer and an input
 * for the shadow model, never proof.
 *
 * Inputs for the fraud model (same columns as fraud_purchases.csv, generator 2.3.0), all as of `at`:
 *   linked_accounts                  other accounts linked to the buyer
 *   linked_accounts_confirmed_fraud  of those, accounts with an order whose latest review before `at` is CONFIRMED_FRAUD
 *   linked_orders_same_event_24h     orders by linked accounts for the same event in the 24 h before `at`
 *
 * Limits: the phone number is the account's CURRENT number (its history is not kept); browser links need the
 * customer to have used the web app while signed in. Phone matching scans the users table (fine at today's
 * size; an expression index on the normalised number is the next step for a large user base).
 */
import prisma from '../../config/prisma.js';

const DAY = 86400_000;
const BROWSER_LOOKBACK_DAYS = 180;
const MAX_LINKS = 200;
const utc = (d) => d.toISOString();

/** Other accounts linked to `userId` before `at`: Map(id -> Set('phone' | 'browser')). */
export async function linkedAccounts(userId, at = new Date(), db = prisma) {
  const since = new Date(at.getTime() - BROWSER_LOOKBACK_DAYS * DAY);
  const [phone, browser] = await Promise.all([
    db.$queryRaw`
      SELECT u2.id FROM "User" u1
      JOIN "User" u2 ON u2.id <> u1.id AND u2.phone IS NOT NULL
        AND right(regexp_replace(u2.phone, '\\D', '', 'g'), 10) = right(regexp_replace(u1.phone, '\\D', '', 'g'), 10)
      WHERE u1.id = ${userId} AND u1.phone IS NOT NULL AND length(regexp_replace(u1.phone, '\\D', '', 'g')) >= 7
        AND u2."createdAt" < (${utc(at)}::timestamptz AT TIME ZONE 'UTC')
      LIMIT ${MAX_LINKS}`,
    db.$queryRaw`
      WITH s AS (
        SELECT DISTINCT "sessionId" FROM "BehaviorEvent"
        WHERE "userId" = ${userId} AND "sessionId" NOT LIKE 'booking_%'
          AND "createdAt" >= (${utc(since)}::timestamptz AT TIME ZONE 'UTC') AND "createdAt" < (${utc(at)}::timestamptz AT TIME ZONE 'UTC'))
      SELECT DISTINCT b."userId" AS id FROM "BehaviorEvent" b JOIN s ON s."sessionId" = b."sessionId"
      WHERE b."userId" IS NOT NULL AND b."userId" <> ${userId} AND b."createdAt" < (${utc(at)}::timestamptz AT TIME ZONE 'UTC')
      LIMIT ${MAX_LINKS}`,
  ]);
  const links = new Map();
  const add = (id, via) => { if (!links.has(id)) links.set(id, new Set()); links.get(id).add(via); };
  for (const r of phone) add(r.id, 'phone');
  for (const r of browser) add(r.id, 'browser');
  return links;
}

/** Accounts (of `ids`) with an order whose latest review before `at` is CONFIRMED_FRAUD. */
export async function confirmedFraudAccounts(ids, at = new Date(), db = prisma) {
  if (!ids.length) return new Set();
  const rows = await db.$queryRaw`
    SELECT DISTINCT o."userId" AS id FROM "FraudReview" r JOIN "Order" o ON o.id = r."orderId"
    WHERE o."userId" = ANY(${ids}) AND r.decision::text = 'CONFIRMED_FRAUD'
      AND r."createdAt" < (${utc(at)}::timestamptz AT TIME ZONE 'UTC')
      AND NOT EXISTS (SELECT 1 FROM "FraudReview" r2 WHERE r2."sampleId" = r."sampleId" AND r2."createdAt" > r."createdAt"
                      AND r2."createdAt" < (${utc(at)}::timestamptz AT TIME ZONE 'UTC'))`;
  return new Set(rows.map((r) => r.id));
}

/** The three link inputs of the fraud model for one checkout. */
export async function linkFeatures({ userId, eventId, at }, db = prisma) {
  const when = at instanceof Date ? at : new Date(at);
  const links = await linkedAccounts(userId, when, db);
  const ids = [...links.keys()];
  const [fraud, sameEvent] = await Promise.all([
    confirmedFraudAccounts(ids, when, db),
    ids.length ? db.order.count({ where: { userId: { in: ids }, eventId, createdAt: { gte: new Date(when.getTime() - DAY), lt: when } } }) : 0,
  ]);
  return { linked_accounts: ids.length, linked_accounts_confirmed_fraud: fraud.size, linked_orders_same_event_24h: sameEvent };
}

const mask = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 7 ? `•••${d.slice(-3)}` : null;
};

/**
 * The account graph around `userId` for SUPER_ADMIN investigations: accounts (nodes) and their links (edges),
 * up to `depth` steps and `maxNodes` accounts. Phone numbers are masked; browsers are not identified at all.
 */
export async function accountGraph(userId, { depth = 2, maxNodes = 40, now = new Date() } = {}, db = prisma) {
  const seen = new Map([[userId, 0]]);
  const edges = new Map(); // "a|b" -> Set(via)
  let frontier = [userId];
  let truncated = false;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const links = await linkedAccounts(id, now, db);
      for (const [other, via] of links) {
        const key = [id, other].sort().join('|');
        if (!edges.has(key)) edges.set(key, new Set());
        for (const v of via) edges.get(key).add(v);
        if (!seen.has(other)) {
          if (seen.size >= maxNodes) { truncated = true; continue; }
          seen.set(other, d);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const ids = [...seen.keys()];
  const [users, orders, fraud] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, phone: true, createdAt: true, status: true } }),
    db.order.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
    confirmedFraudAccounts(ids, now, db),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const orderCount = new Map(orders.map((o) => [o.userId, o._count._all]));
  const nodes = ids.filter((id) => byId.has(id)).map((id) => {
    const u = byId.get(id);
    return {
      id, depth: seen.get(id), name: u.name || null, email: u.email || null, phone: mask(u.phone), createdAt: u.createdAt,
      status: u.status, frozen: ['FROZEN', 'SUSPENDED', 'BANNED', 'BLACKLISTED'].includes(u.status), orders: orderCount.get(id) || 0, confirmedFraud: fraud.has(id), root: id === userId,
    };
  });
  const kept = new Set(nodes.map((n) => n.id));
  const list = [...edges.entries()].map(([k, via]) => { const [a, b] = k.split('|'); return { a, b, via: [...via].sort() }; })
    .filter((e) => kept.has(e.a) && kept.has(e.b));
  return {
    root: userId, nodes, edges: list, truncated, depth,
    summary: {
      accounts: nodes.length - 1, confirmedFraud: nodes.filter((n) => n.confirmedFraud && !n.root).length,
      viaPhone: list.filter((e) => e.via.includes('phone')).length, viaBrowser: list.filter((e) => e.via.includes('browser')).length,
    },
    note: 'Accounts are linked when they had the same phone number or used the same browser. A shared family phone or computer links accounts too: evidence for review, not proof. Viewing this graph counts as seeing detector output for every account in it (blind reviews of these accounts are marked as not blind).',
  };
}
