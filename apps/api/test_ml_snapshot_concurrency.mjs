/**
 * Snapshot integrity under concurrency, and the point-in-time typical price. Database COPY only (name must
 * end in "_verify") with migrations 20261122120000_ml_input_changes and 20261123120000_..._commit_time.
 *
 * Concurrent changes are made from OTHER database connections at each point of a capture:
 *   A. committed after the inputs were read, before the check     -> not exact
 *   B. committed after the check, before the row is saved          -> exact, and the stored values are the
 *                                                                     ones that held at the prediction moment
 *   C. in flight (uncommitted) during the whole capture             -> exact, stored values = committed values
 *   D. a long transaction: its change is logged at COMMIT time, not at its statement time
 * Typical price:
 *   E. a reference event's price changes after the prediction moment -> not exact (no point-in-time value)
 *   F. an event created after the prediction moment never counts, even with a backdated sales-open date
 *   G. without the commit-time log nothing is marked exact
 *
 *   DATABASE_URL=postgresql://.../ticketledger_export_verify node --test test_ml_snapshot_concurrency.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
process.env.ML_SHADOW_ENABLED = 'false';
const { PrismaClient } = await import('@prisma/client');
const prisma = (await import('./src/config/prisma.js')).default;
const other = new PrismaClient(); // a second, independent client: the "concurrent writer"
const { demandSnapshot, referenceEventIds, clearReferencePriceCache } = await import('./src/services/ml/features.js');
const { logPredictions, __setShadowDeps } = await import('./src/services/ml/shadow.js');
const { checkSnapshots, commitTimeLogInstalled } = await import('./src/services/ml/snapshotIntegrity.js');
test.after(async () => {
  __setShadowDeps(null);
  // Retire the fixture organizer (test domain): its events then never enter a later run's typical prices
  if (company) await prisma.user.update({ where: { id: company.userId }, data: { email: `retired-${company.userId}@example.com` } }).catch(() => {});
  await prisma.$disconnect(); await other.$disconnect();
});

const tag = randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let company;
async function freshEvent({ open = new Date(Date.now() - 86_400_000) } = {}) {
  if (!company) {
    const org = await prisma.user.create({ data: { email: `org-${tag}@fx${tag}.pk`, passwordHash: 'x', name: 'Org', role: 'ORGANIZER' } });
    company = await prisma.company.create({ data: { userId: org.id, companyName: `Fx ${tag}`, ownerName: 'Org', phone: '0300', email: org.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
  }
  const start = new Date(Date.now() + 20 * 86_400_000);
  const e = await prisma.event.create({
    data: {
      companyId: company.id, name: `C-${randomUUID().slice(0, 6)}-${tag}`, description: 'fixture', type: 'CRICKET_MATCH', status: 'PUBLISHED', city: 'Lahore', venue: 'Ground',
      date: start, time: '19:00', startsAt: start, salesOpenAt: open, createdAt: new Date(Math.min(open.getTime(), Date.now()) - 3600_000),
      tiers: { create: [{ name: 'General', price: 1000, totalQuantity: 100, availableQuantity: 100 }, { name: 'VIP', price: 3000, totalQuantity: 20, availableQuantity: 20 }] },
    },
    include: { tiers: true },
  });
  // In the simulated timeline the event was created long before any prediction
  await prisma.mlInputChange.updateMany({ where: { eventId: e.id }, data: { changedAt: new Date(Date.now() - 3600_000) } });
  clearReferencePriceCache();
  return e;
}
/** One demand prediction for `e`, prediction moment = asOf, the typical price not checked unless asked. */
async function capture(e, asOf, { referenceAt = null } = {}) {
  const { features, context } = await demandSnapshot({ eventId: e.id, at: asOf });
  const subjectId = `${e.id}|${randomUUID().slice(0, 6)}`;
  await logPredictions('demand', [{ subjectType: 'EVENT_FORECAST', subjectId, eventId: e.id, asOf, referenceAt, rule: { score: 1 }, features, context }]);
  return (await prisma.mlPrediction.findFirst({ where: { modelName: 'demand', role: 'RULES', subjectId } })).output.context;
}

test('the commit-time change log is installed', async () => {
  assert.equal(await commitTimeLogInstalled(prisma), true);
});

test('A. change committed after the inputs were read, before the check -> not exact', async () => {
  const e = await freshEvent();
  const asOf = new Date();
  __setShadowDeps({ hooks: { beforeCheck: () => other.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 1500 } }) } });
  const c = await capture(e, asOf);
  __setShadowDeps({ hooks: {} });
  assert.equal(c.exact, false);
  assert.equal(c.min_price, 1000, 'the values read were the old ones');
  assert.match(c.integrity.reason, /inputs changed after the prediction moment \(TicketTier\)/);
});

test('B. change committed after the check, before the save -> exact, and the stored values held at the prediction moment', async () => {
  const e = await freshEvent();
  const asOf = new Date();
  __setShadowDeps({ hooks: { afterCheck: () => other.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 1500 } }) } });
  const c = await capture(e, asOf);
  __setShadowDeps({ hooks: {} });
  assert.equal(c.exact, true);
  assert.equal(c.min_price, 1000);
  assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: e.tiers[0].id } })).price), 1500, 'the change did commit');
  assert.ok((await prisma.mlInputChange.findFirst({ where: { eventId: e.id }, orderBy: { changedAt: 'desc' } })).changedAt > new Date(c.integrity.checked_at), 'logged after the check');
});

test('C. a writer in flight during the whole capture, committed afterwards -> exact with the committed values', async () => {
  const e = await freshEvent();
  let release;
  const gate = new Promise((r) => { release = r; });
  let started;
  const begun = new Promise((r) => { started = r; });
  const writer = other.$transaction(async (tx) => {
    await tx.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 2500 } });
    started();
    await gate; // keep it open (uncommitted) while the capture runs
  }, { timeout: 30_000 });
  await begun;
  const asOf = new Date();
  const c = await capture(e, asOf);
  release();
  await writer;
  assert.equal(c.exact, true);
  assert.equal(c.min_price, 1000, 'the uncommitted price was not the price at the prediction moment');
  assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: e.tiers[0].id } })).price), 2500);
});

test('D. a long transaction is logged at COMMIT time (not when its statement ran)', async () => {
  const e = await freshEvent();
  const t0 = Date.now();
  await other.$transaction(async (tx) => {
    await tx.ticketTier.update({ where: { id: e.tiers[0].id }, data: { price: 1800 } });
    await sleep(3000);
  }, { timeout: 30_000 });
  const row = await prisma.mlInputChange.findFirst({ where: { eventId: e.id }, orderBy: { changedAt: 'desc' } });
  assert.ok(row.changedAt.getTime() >= t0 + 2500, `logged ${row.changedAt.getTime() - t0} ms after the statement`);
  // And so a capture whose prediction moment fell between the statement and the commit is not exact
  const c = await capture(e, new Date(t0 + 1000));
  assert.equal(c.exact, false);
});

test('E. a typical-price event changing after the prediction moment -> not exact', async () => {
  const ref = await freshEvent({ open: new Date(Date.now() - 10 * 86_400_000) });
  const e = await freshEvent();
  const asOf = new Date();
  assert.ok((await referenceEventIds(asOf)).has(ref.id));
  await other.ticketTier.update({ where: { id: ref.tiers[0].id }, data: { price: 99999 } });
  const c = await capture(e, asOf, { referenceAt: asOf });
  assert.equal(c.exact, false);
  assert.match(c.integrity.reason, /typical-price inputs changed after the prediction moment/);
  assert.equal(c.integrity.reference_changes >= 1, true);
  // Without a reference check (a model with no price-relative inputs) the same capture is exact
  assert.equal((await capture(e, asOf)).exact, true);
});

test('F. an event created after the prediction moment never counts, even with a backdated sales open', async () => {
  const asOf = new Date(Date.now() - 60_000);
  const late = await prisma.event.create({
    data: {
      companyId: company.id, name: `late-${tag}`, description: 'fixture', type: 'CRICKET_MATCH', status: 'PUBLISHED', city: 'Lahore', venue: 'Ground',
      date: new Date(Date.now() + 9e8), time: '19:00', salesOpenAt: new Date(Date.now() - 30 * 86_400_000),
      tiers: { create: [{ name: 'G', price: 777777, totalQuantity: 1, availableQuantity: 1 }] },
    },
  });
  clearReferencePriceCache();
  assert.equal((await referenceEventIds(asOf)).has(late.id), false);
  assert.equal((await referenceEventIds(new Date())).has(late.id), true);
});

test('G. without the commit-time log nothing is marked exact', async () => {
  const fake = { $queryRaw: async () => [], mlInputChange: { findMany: async () => [] } };
  const [r] = await checkSnapshots(fake, [{ eventId: 'x', windowStart: new Date() }]);
  assert.equal(r.exact, false);
  assert.match(r.reason, /commit-time change log not installed/);
});

test('H. an update to a typical-price organizer company/account after the prediction moment -> not exact', async () => {
  // Its own organizer and reference event, all dated long before the reference moment
  const org = await prisma.user.create({ data: { email: `org2-${tag}@fx${tag}.pk`, passwordHash: 'x', name: 'Org2', role: 'ORGANIZER' } });
  const co = await prisma.company.create({ data: { userId: org.id, companyName: `Fx2 ${tag}`, ownerName: 'Org2', phone: '0300', email: org.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
  const ref = await prisma.event.create({
    data: {
      companyId: co.id, name: `H-${tag}`, description: 'fixture', type: 'CRICKET_MATCH', status: 'PUBLISHED', city: 'Lahore', venue: 'Ground',
      date: new Date(Date.UTC(1976, 6, 1)), time: '19:00', salesOpenAt: new Date(Date.UTC(1976, 0, 1)), createdAt: new Date(Date.UTC(1975, 0, 1)),
      tiers: { create: [{ name: 'G', price: 1200, totalQuantity: 10, availableQuantity: 10 }] },
    },
  });
  const old = new Date(Date.UTC(1975, 0, 1)).toISOString();
  await prisma.$executeRaw`UPDATE "User" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${org.id}`;
  await prisma.$executeRaw`UPDATE "Company" SET "updatedAt" = ${old}::timestamptz AT TIME ZONE 'UTC' WHERE id = ${co.id}`;
  await prisma.mlInputChange.updateMany({ where: { eventId: ref.id }, data: { changedAt: new Date(old) } });
  clearReferencePriceCache();
  // Before every fixture of every test file (they are dated 1980s onwards), so only this test's data is in scope
  const referenceAt = new Date(Date.UTC(1977, 0, 1));
  const { reference } = { reference: (await import('./src/services/ml/features.js')).referenceInputs };
  const r = await reference(referenceAt);
  assert.ok(r.eventIds.has(ref.id) && r.ownerIds.includes(org.id));
  const e = await freshEvent();
  const before = await checkSnapshots(prisma, [{ eventId: e.id, windowStart: new Date(), referenceAt }], { reference });
  assert.equal(before[0].exact, true, JSON.stringify(before[0]));
  // The organizer account changes after the reference moment (old value not recorded)
  await other.user.update({ where: { id: org.id }, data: { email: `org2-${tag}@example.com` } });
  const after = await checkSnapshots(prisma, [{ eventId: e.id, windowStart: new Date(), referenceAt }], { reference });
  assert.equal(after[0].exact, false);
  assert.match(after[0].reason, /organizer company\/account update/);
});
