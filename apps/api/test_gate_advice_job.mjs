// Gate advice background job (services/gateAdviceJob.js): queued by the request, sent in the background,
// never twice. Runs against the development database with its own company, event and users (removed after).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

const prisma = (await import('./src/config/prisma.js')).default;
const { queueGateAdvice, processGateAdvice, latestGateAdvice } = await import('./src/services/gateAdviceJob.js');

const run = crypto.randomBytes(4).toString('hex');
const userIds = [];
let company;
let event;
const sent = [];
const dispatch = async (msg) => { sent.push(msg); };

test.before(async () => {
  const mk = async (n) => {
    const u = await prisma.user.create({ data: { name: `Advice ${n}`, email: `gadv_${n}_${run}@example.com`, passwordHash: 'x', role: n === 'owner' ? 'ORGANIZER' : 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    userIds.push(u.id);
    return u;
  };
  const owner = await mk('owner');
  const a = await mk('a');
  const b = await mk('b');
  company = await prisma.company.create({ data: { userId: owner.id, companyName: `Advice Org ${run}`, ownerName: owner.name, phone: '+923001112223', email: owner.email, city: 'Lahore', ntnCnic: '1234567-8', documentUrl: '/x.pdf', status: 'APPROVED' } });
  const start = new Date(Date.now() + 2 * 24 * 3600000);
  event = await prisma.event.create({ data: { companyId: company.id, name: `Advice Event ${run}`, description: 'test', type: 'MUSIC_CONCERT', status: 'PUBLISHED', date: start, startsAt: start, endsAt: new Date(start.getTime() + 3 * 3600000), time: '19:00', city: 'Lahore', venue: 'Hall' } });
  await prisma.eventGate.createMany({ data: [{ eventId: event.id, name: 'Gate North', type: 'ENTRY', capacityPerHour: 600, sortOrder: 1 }, { eventId: event.id, name: 'Gate South', type: 'ENTRY', capacityPerHour: 600, sortOrder: 2 }] });
  const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name: 'Standard', price: 1000, totalQuantity: 20, availableQuantity: 0 } });
  let k = 0;
  for (const [u, section] of [[a, 'North'], [a, 'North'], [b, 'South']]) {
    const order = await prisma.order.create({ data: { userId: u.id, eventId: event.id, totalAmount: 1000, status: 'SUCCESSFUL' } });
    const seat = await prisma.seat.create({ data: { eventId: event.id, tierId: tier.id, section, row: 'A', seatNumber: String(++k), status: 'SOLD' } });
    await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, seatId: seat.id, userId: u.id, price: 1000, manualCode: `TL-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` } });
  }
  event.owner = owner;
});

test.after(async () => {
  if (event) {
    await prisma.gateAdviceDelivery.deleteMany({ where: { eventId: event.id } });
    await prisma.gateAdviceRun.deleteMany({ where: { eventId: event.id } });
    await prisma.auditLog.deleteMany({ where: { targetId: event.id } });
  }
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  if (company) {
    await prisma.event.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('the request only queues; the job sends one message per person', async () => {
  const { run: r, created } = await queueGateAdvice(event, event.owner, { start: false });
  assert.equal(created, true);
  assert.equal(r.status, 'QUEUED');
  assert.equal(sent.length, 0, 'nothing is sent inside the request');

  const again = await queueGateAdvice(event, event.owner, { start: false });
  assert.equal(again.created, false, 'a second click returns the run already queued');
  assert.equal(again.run.id, r.id);

  const out = await processGateAdvice({ dispatch });
  assert.equal(out.runs, 1);
  const done = await latestGateAdvice(event.id);
  assert.equal(done.status, 'DONE');
  assert.equal(done.people, 2);
  assert.equal(done.sent, 2);
  assert.equal(sent.length, 2, 'two people, one message each (the holder of two tickets gets one)');
  assert.ok(sent.every((m) => m.type === 'GATE_ADVICE' && /Gate (North|South)/.test(m.message)));
});

test('a second run sends nothing to people who already got the same advice', async () => {
  const before = sent.length;
  await queueGateAdvice(event, event.owner, { start: false });
  await processGateAdvice({ dispatch });
  const r = await latestGateAdvice(event.id);
  assert.equal(r.status, 'DONE');
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 2);
  assert.equal(sent.length, before);
});

test('a failed message is retried by the next run, the others are not repeated', async () => {
  // Clear one person's record (as if never told) and make their message fail once
  const deliveries = await prisma.gateAdviceDelivery.findMany({ where: { eventId: event.id } });
  const victim = deliveries[0].userId;
  await prisma.gateAdviceDelivery.deleteMany({ where: { eventId: event.id, userId: victim } });
  const before = sent.length;
  const failing = async (msg) => { if (msg.userId === victim) throw new Error('mail down'); sent.push(msg); };
  await queueGateAdvice(event, event.owner, { start: false });
  await processGateAdvice({ dispatch: failing });
  let r = await latestGateAdvice(event.id);
  assert.deepEqual([r.sent, r.failed, r.skipped], [0, 1, 1]);
  assert.equal(await prisma.gateAdviceDelivery.count({ where: { eventId: event.id, userId: victim } }), 0, 'failed message is not recorded as sent');

  await queueGateAdvice(event, event.owner, { start: false });
  await processGateAdvice({ dispatch });
  r = await latestGateAdvice(event.id);
  assert.deepEqual([r.sent, r.failed, r.skipped], [1, 0, 1]);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).userId, victim);
});

test('a run left RUNNING by a stopped server is resumed without repeating anyone', async () => {
  const r = await prisma.gateAdviceRun.create({ data: { eventId: event.id, companyId: company.id, requestedById: event.owner.id, status: 'RUNNING', startedAt: new Date(Date.now() - 20 * 60_000) } });
  const before = sent.length;
  await processGateAdvice({ dispatch });
  const after = await prisma.gateAdviceRun.findUnique({ where: { id: r.id } });
  assert.equal(after.status, 'DONE');
  assert.equal(after.skipped, 2);
  assert.equal(sent.length, before);
});

test('the database refuses a second active run for the same event', async () => {
  await prisma.gateAdviceRun.create({ data: { eventId: event.id, requestedById: event.owner.id, status: 'QUEUED' } });
  await assert.rejects(prisma.gateAdviceRun.create({ data: { eventId: event.id, requestedById: event.owner.id, status: 'RUNNING' } }), (e) => e.code === 'P2002');
  await processGateAdvice({ dispatch });
});

test('no advice for a cancelled or ended event', async () => {
  await prisma.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
  await assert.rejects(queueGateAdvice(event, event.owner, { start: false }), (e) => e.status === 409 && /cancelled/.test(e.message));
  await prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED', startsAt: new Date(Date.now() - 5 * 3600000), endsAt: new Date(Date.now() - 3600000), date: new Date(Date.now() - 5 * 3600000) } });
  await assert.rejects(queueGateAdvice(event, event.owner, { start: false }), (e) => e.status === 409 && /ended/.test(e.message));
});
