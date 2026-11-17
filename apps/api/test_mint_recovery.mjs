// Payment → ticket issuance recovery (services/nftService.js), tested directly against the database.
// Runs in simulation mode (no transactions are sent) and builds its own throwaway user, company, event,
// seats and paid order, removed again at the end.
//   node --test test_mint_recovery.mjs
process.env.POLYGON_PRIVATE_KEY = '';
process.env.NFT_MINT_FAIL_ATTEMPTS = '2';

import assert from 'node:assert/strict';
import test from 'node:test';
import 'dotenv/config';

const { default: prisma } = await import('./src/config/prisma.js');
const { default: nftService, MAX_MINT_ATTEMPTS, ALERT_AFTER_ATTEMPTS, mintView } = await import('./src/services/nftService.js');

const tag = `mintrec_${Date.now()}`;
const made = {};
const ticketIds = [];

const reload = (id) => prisma.ticket.findUnique({ where: { id } });
const makeDue = (ids) => prisma.ticket.updateMany({ where: { id: { in: ids } }, data: { mintNextAttemptAt: new Date(Date.now() - 1000) } });

test('NFT issuance recovery', async (t) => {
  t.after(async () => {
    if (made.event) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: ticketIds } } });
      await prisma.ticket.deleteMany({ where: { eventId: made.event.id } });
      await prisma.order.deleteMany({ where: { eventId: made.event.id } });
      await prisma.seat.deleteMany({ where: { eventId: made.event.id } });
      await prisma.ticketTier.deleteMany({ where: { eventId: made.event.id } });
      await prisma.event.delete({ where: { id: made.event.id } });
    }
    if (made.company) await prisma.company.delete({ where: { id: made.company.id } });
    for (const u of [made.organizer, made.customer].filter(Boolean)) {
      await prisma.notification.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.notification.deleteMany({ where: { type: 'ADMIN_MINT_FAILED', message: { contains: tag } } });
    await prisma.$disconnect();
  });

  await t.test('setup: a paid order with three tickets and one unpaid checkout', async () => {
    made.organizer = await prisma.user.create({ data: { email: `${tag}_org@example.test`, passwordHash: 'x', name: 'Mint Test Organizer', role: 'ORGANIZER', status: 'ACTIVE' } });
    made.customer = await prisma.user.create({ data: { email: `${tag}_fan@example.test`, passwordHash: 'x', name: 'Mint Test Fan', status: 'ACTIVE' } });
    made.company = await prisma.company.create({
      data: { userId: made.organizer.id, companyName: `Mint Test Co ${tag}`, ownerName: 'Test', phone: '0300', email: `${tag}_co@example.test`, city: 'Lahore', ntnCnic: '0', documentUrl: 'x', status: 'APPROVED' },
    });
    made.event = await prisma.event.create({
      data: { companyId: made.company.id, name: `Mint Recovery ${tag}`, description: 'test', type: 'MUSIC_CONCERT', date: new Date(Date.now() + 30 * 864e5), time: '19:00', city: 'Lahore', venue: 'Test Hall', status: 'PUBLISHED' },
    });
    const tier = await prisma.ticketTier.create({ data: { eventId: made.event.id, name: 'Standard', price: 2500, totalQuantity: 4, availableQuantity: 0 } });
    const seats = [];
    for (let i = 1; i <= 4; i++) seats.push(await prisma.seat.create({ data: { eventId: made.event.id, tierId: tier.id, section: 'A', row: 'A', seatNumber: String(i), status: 'SOLD' } }));

    // Paid more than a minute ago, so the background job may pick it up
    made.order = await prisma.order.create({ data: { userId: made.customer.id, eventId: made.event.id, totalAmount: 7500, status: 'SUCCESSFUL', paymentTxId: `pay_${tag}` } });
    for (const s of seats.slice(0, 3)) {
      const tk = await prisma.ticket.create({ data: { orderId: made.order.id, eventId: made.event.id, seatId: s.id, userId: made.customer.id, price: 2500 } });
      ticketIds.push(tk.id);
    }
    made.unpaid = await prisma.order.create({ data: { userId: made.customer.id, eventId: made.event.id, totalAmount: 2500, status: 'PENDING' } });
    made.unpaidTicket = await prisma.ticket.create({ data: { orderId: made.unpaid.id, eventId: made.event.id, seatId: seats[3].id, userId: made.customer.id, price: 2500 } });
    ticketIds.push(made.unpaidTicket.id);
    await prisma.$executeRaw`UPDATE "Order" SET "updatedAt" = now() - interval '5 minutes' WHERE id = ${made.order.id}`;
  });

  await t.test('a failed mint keeps the booking and schedules a retry', async () => {
    const result = await nftService.batchMintOrderTickets(made.order.id);
    assert.equal(result.totalMinted, 0);
    const order = await prisma.order.findUnique({ where: { id: made.order.id } });
    assert.equal(order.status, 'SUCCESSFUL', 'payment stays successful');
    for (const id of ticketIds.slice(0, 3)) {
      const tk = await reload(id);
      assert.equal(tk.status, 'ACTIVE', 'ticket stays valid for entry');
      assert.equal(tk.mintStatus, 'PENDING');
      assert.equal(tk.mintAttempts, 1);
      assert.match(tk.mintError, /Simulated minting failure/);
      assert.ok(tk.mintNextAttemptAt > new Date(), 'next attempt is in the future');
      assert.equal(mintView(tk).label, 'NFT pending');
    }
  });

  await t.test('the job respects the backoff', async () => {
    const r = await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal(r.minted + r.retrying + r.failed, 0, 'nothing is due yet');
  });

  await t.test('second failure, then the third attempt mints and tells the customer', async () => {
    await makeDue(ticketIds.slice(0, 3));
    let r = await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal(r.retrying, 3);
    assert.equal((await reload(ticketIds[0])).mintAttempts, 2);

    await makeDue(ticketIds.slice(0, 3));
    r = await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal(r.minted, 3);
    for (const id of ticketIds.slice(0, 3)) {
      const tk = await reload(id);
      assert.equal(tk.mintStatus, 'MINTED');
      assert.ok(tk.tokenId && tk.txHash && tk.mintedAt);
      assert.equal(tk.mintSimulated, true, 'a simulation-mode token is marked simulated');
      assert.equal(mintView(tk).status, 'SIMULATED', 'and is never shown as verified');
      assert.equal(tk.mintError, null);
    }
    const notice = await prisma.notification.findMany({ where: { userId: made.customer.id, type: 'TICKET_ISSUED' } });
    assert.equal(notice.length, 1, 'one notice per order, not per ticket');
  });

  await t.test('an unpaid checkout is never minted', async () => {
    await nftService.retryDueMints({ userId: made.customer.id });
    const r = await nftService.mintTicketNFT(made.unpaidTicket.id);
    assert.equal(r.outcome, 'SKIPPED');
    const tk = await reload(made.unpaidTicket.id);
    assert.equal(tk.tokenId, null);
    assert.equal(tk.mintAttempts, 0);
  });

  await t.test('a minted ticket is never minted again', async () => {
    const before = await reload(ticketIds[0]);
    const r = await nftService.mintTicketNFT(ticketIds[0], { force: true });
    assert.equal(r.outcome, 'ALREADY_MINTED');
    assert.equal((await reload(ticketIds[0])).txHash, before.txHash);
  });

  await t.test('two concurrent attempts on one ticket: only one claims it', async () => {
    process.env.NFT_MINT_FAIL_ATTEMPTS = '0';
    await prisma.ticket.update({ where: { id: ticketIds[1] }, data: { mintStatus: 'PENDING', tokenId: null, txHash: null, mintAttempts: 0, mintedAt: null } });
    const [a, b] = await Promise.all([nftService.mintTicketNFT(ticketIds[1]), nftService.mintTicketNFT(ticketIds[1])]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.ok(outcomes.includes('MINTED'));
    assert.ok(outcomes.some((o) => o === 'SKIPPED' || o === 'ALREADY_MINTED'));
    assert.equal((await reload(ticketIds[1])).mintAttempts, 1);
  });

  await t.test('retries running out marks FAILED and alerts admins and the customer', async () => {
    process.env.NFT_MINT_FAIL_ATTEMPTS = String(MAX_MINT_ATTEMPTS + 5);
    await prisma.ticket.update({ where: { id: ticketIds[2] }, data: { mintStatus: 'PENDING', tokenId: null, txHash: null, mintAttempts: MAX_MINT_ATTEMPTS - 1, mintedAt: null } });
    const r = await nftService.processMints([ticketIds[2]]);
    assert.equal(r.failed, 1);
    const tk = await reload(ticketIds[2]);
    assert.equal(tk.mintStatus, 'FAILED');
    assert.equal(tk.status, 'ACTIVE', 'still valid at the gate');
    assert.equal(mintView(tk).status, 'FAILED');
    const delayed = await prisma.notification.count({ where: { userId: made.customer.id, type: 'TICKET_ISSUANCE_DELAYED' } });
    assert.equal(delayed, 1);
    const admins = await prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
    if (admins) {
      const alert = await prisma.notification.findFirst({ where: { type: 'ADMIN_MINT_FAILED', message: { contains: tag } }, orderBy: { createdAt: 'desc' } });
      assert.ok(alert, 'admins are alerted');
    }
    // The job leaves FAILED tickets alone
    const job = await nftService.retryDueMints({ userId: made.customer.id });
    assert.equal(job.failed + job.retrying, 0);
  });

  await t.test('an admin retry gives a FAILED ticket fresh attempts', async () => {
    process.env.NFT_MINT_FAIL_ATTEMPTS = '0';
    const r = await nftService.processMints([ticketIds[2]], { force: true });
    assert.equal(r.minted, 1);
    const tk = await reload(ticketIds[2]);
    assert.equal(tk.mintStatus, 'MINTED');
    assert.equal(tk.mintAttempts, 1);
  });

  await t.test('alert threshold constant is sane', () => {
    assert.ok(ALERT_AFTER_ATTEMPTS < MAX_MINT_ATTEMPTS);
  });
});
