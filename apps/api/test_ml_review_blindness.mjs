/**
 * Blind fraud review: exposure detection, blind-only labels, unresolved cases reported separately.
 * Runs against a database COPY (name must end in "_verify").
 *
 *   DATABASE_URL=postgresql://.../ticketledger_export_verify node --test test_ml_review_blindness.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
const prisma = (await import('./src/config/prisma.js')).default;
const r = await import('./src/services/ml/fraudReview.js');
test.after(() => prisma.$disconnect());
const admin = async () => (await prisma.user.create({ data: { email: `rev-${randomUUID().slice(0, 8)}@ticketledger.pk`, passwordHash: 'x', name: 'Reviewer', role: 'SUPER_ADMIN' } })).id;

test('reviewState / effectiveReview: only blind reviews count', () => {
  const t = (m) => new Date(Date.UTC(2026, 0, 1, 0, m));
  assert.equal(r.reviewState([]), 'UNREVIEWED');
  assert.equal(r.reviewState([{ decision: 'CONFIRMED_FRAUD', blind: false, createdAt: t(1) }]), 'EXPOSED_ONLY');
  assert.equal(r.reviewState([{ decision: 'CONFIRMED_FRAUD', blind: null, createdAt: t(1) }]), 'EXPOSED_ONLY', 'pre-check reviews are not blind');
  const mixed = [{ decision: 'LEGITIMATE', blind: true, createdAt: t(1) }, { decision: 'CONFIRMED_FRAUD', blind: false, createdAt: t(2) }];
  assert.equal(r.effectiveReview(mixed).decision, 'LEGITIMATE', 'a later exposed review does not override a blind one');
  assert.equal(r.reviewState([...mixed, { decision: 'UNRESOLVED', blind: true, createdAt: t(3) }]), 'UNRESOLVED');
});

test('unresolvedReport: counted per cell, with the range they leave open', () => {
  const cells = {
    RULE_AND_ML: { population: 10, resolved: [{ fraud: 1, weight: 1 }, { fraud: 1, weight: 1 }], unresolved: 0, unresolvedWeights: [] },
    RULE_ONLY: { population: 10, resolved: [{ fraud: 1, weight: 1 }, { fraud: 0, weight: 1 }], unresolved: 2, unresolvedWeights: [1, 1] },
    ML_ONLY: { population: 0, resolved: [], unresolved: 0, unresolvedWeights: [] },
    NEITHER: { population: 100, resolved: [{ fraud: 0, weight: 50 }], unresolved: 0, unresolvedWeights: [] },
  };
  const u = r.unresolvedReport(cells);
  assert.equal(u.total, 2);
  assert.equal(u.perCell.RULE_ONLY.share, 0.5);
  assert.deepEqual(u.tooMany, ['RULE_ONLY']);
  assert.ok(u.ifAllFraud.rules.precision > u.ifAllLegitimate.rules.precision);
  assert.equal(r.unresolvedReport({ ...cells, RULE_ONLY: { ...cells.RULE_ONLY, unresolved: 0, unresolvedWeights: [] } }).ifAllFraud, null);
});

test('exposure: watchlist views, investigations and account actions make a review not blind', async () => {
  const reviewer = await admin();
  const other = await admin();
  const customer = randomUUID();
  const before = new Date();
  assert.equal((await r.exposureFor({ reviewerId: reviewer, customerId: customer, before })).blind, true);
  await r.recordWatchlistView(reviewer, [randomUUID(), customer]);
  const e = await r.exposureFor({ reviewerId: reviewer, customerId: customer, before: new Date(Date.now() + 1000) });
  assert.equal(e.blind, false);
  assert.equal(e.exposure[0].action, 'FRAUD_WATCHLIST_VIEWED');
  assert.equal((await r.exposureFor({ reviewerId: other, customerId: customer, before: new Date(Date.now() + 1000) })).blind, true, 'another admin stays blind');
  assert.equal((await r.exposureFor({ reviewerId: reviewer, customerId: customer, before })).blind, true, 'only exposure BEFORE the review counts');
  const c3 = randomUUID();
  await prisma.auditLog.create({ data: { userId: other, action: 'ORGANIZER_SENT_INTENT_REMINDER', targetType: 'User', targetId: c3, details: {} } });
  assert.equal((await r.exposureFor({ reviewerId: other, customerId: c3, before: new Date(Date.now() + 1000) })).blind, true, 'actions that show no fraud output keep the reviewer blind');
  await r.recordProfileView(other, c3);
  assert.equal((await r.exposureFor({ reviewerId: other, customerId: c3, before: new Date(Date.now() + 1000) })).blind, false, 'admin behaviour profile shows the fraud score');
  const c2 = randomUUID();
  await prisma.auditLog.create({ data: { userId: other, action: 'INVESTIGATION_VIEWED', targetType: 'User', targetId: c2, details: {} } });
  assert.equal((await r.exposureFor({ reviewerId: other, customerId: c2, before: new Date(Date.now() + 1000) })).blind, false);
});

test('recordReview stores blindness without returning it; the queue shows no account id', async () => {
  const org = await prisma.user.findFirst({ where: { role: 'CUSTOMER' }, select: { id: true } });
  const ev = await prisma.event.findFirst({ select: { id: true } });
  const order = await prisma.order.create({ data: { userId: org.id, eventId: ev.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
  const sample = await prisma.fraudSample.create({ data: { orderId: order.id, cell: 'NEITHER', selected: true, inclusionProbability: 0.02, mlWouldFlag: false } });
  const reviewer = await admin();
  await r.recordWatchlistView(reviewer, [org.id]);
  await new Promise((res) => setTimeout(res, 20));
  const rev = await r.recordReview({ sampleId: sample.id, decision: 'CONFIRMED_FRAUD', reviewerId: reviewer });
  assert.equal('blind' in rev, false, 'the reviewer is not told (it would reveal a flag)');
  const stored = await prisma.fraudReview.findUnique({ where: { id: rev.id } });
  assert.equal(stored.blind, false);
  assert.equal(stored.exposure[0].action, 'FRAUD_WATCHLIST_VIEWED');
  const q = await r.reviewQueue({ limit: 100, reviewerId: randomUUID() });
  const item = q.items.find((i) => i.sampleId === sample.id);
  assert.ok(item, 'exposed-only items stay open for an independent reviewer');
  assert.equal(item.customer.userId, undefined);
  assert.match(item.customer.ref, /^C-[0-9a-f]{10}$/);
  assert.ok(!(await r.reviewQueue({ limit: 100, reviewerId: reviewer })).items.some((i) => i.sampleId === sample.id), 'not asked again of the same reviewer');
  const h = await r.reviewHistory(sample.id);
  assert.equal('blind' in h.reviews[0], false);
  const m = await r.reviewMetrics();
  assert.ok(m.reviewProgress.NEITHER.exposedOnly >= 1 && m.reviewProgress.NEITHER.exposedReviews >= 1);
  assert.ok('unresolved' in m);
});
