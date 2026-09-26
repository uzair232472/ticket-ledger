import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';
import prisma from './src/config/prisma.js';

test('MODULE 6 - Seat Map, 10-Minute Redis Lock & Double-Booking Prevention Tests', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const getToken = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@123' }),
    });
    const body = await res.json();
    return body.data.token;
  };

  const customer1Token = await getToken('customer@ticketledger.pk');
  const customer2Token = await getToken('pending_organizer@ticketledger.pk'); // distinct user
  const organizerToken = await getToken('organizer@ticketledger.pk');

  // Find PSL Final event
  const event = await prisma.event.findFirst({
    where: { name: { contains: 'PSL 2026 Final' } },
    include: { tiers: true },
  });
  assert.ok(event, 'PSL Event must exist');

  let testSeatId = '';
  let soldSeatId = '';
  let blockedSeatId = '';

  await t.test('1. Retrieve interactive seat map with sections, rows, and summary', async () => {
    const res = await fetch(`${baseUrl}/seats/event/${event.id}`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.summary.total >= 80);
    assert.ok(body.data.summary.sold >= 1);
    assert.ok(Object.keys(body.data.sections).length >= 4);

    const availableSeat = body.data.seats.find((s) => s.status === 'AVAILABLE');
    assert.ok(availableSeat);
    testSeatId = availableSeat.id;

    const soldSeat = body.data.seats.find((s) => s.status === 'SOLD');
    assert.ok(soldSeat);
    soldSeatId = soldSeat.id;

    const blockedSeat = body.data.seats.find((s) => s.status === 'BLOCKED');
    assert.ok(blockedSeat);
    blockedSeatId = blockedSeat.id;
  });

  await t.test('2. Customer 1 acquires 10-minute atomic seat lock', async () => {
    const res = await fetch(`${baseUrl}/seats/lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: testSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.seat.status, 'LOCKED');
    assert.strictEqual(body.data.seat.ttlSeconds, 600);
    assert.ok(body.data.seat.lockedUntil);
  });

  await t.test('3. Double-Booking Prevention: Customer 2 is blocked from locking the same seat', async () => {
    const res = await fetch(`${baseUrl}/seats/lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: testSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.match(body.message, /currently reserved by another customer/i);
  });

  await t.test('4. Double-Booking Prevention: Attempting to lock an already SOLD seat is rejected', async () => {
    const res = await fetch(`${baseUrl}/seats/lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: soldSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.match(body.message, /already been sold/i);
  });

  await t.test('5. Attempting to lock a BLOCKED seat is rejected', async () => {
    const res = await fetch(`${baseUrl}/seats/lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: blockedSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.match(body.message, /blocked by venue/i);
  });

  await t.test('6. Customer 1 unselects/unlocks the seat before 10-minute expiry', async () => {
    const res = await fetch(`${baseUrl}/seats/unlock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: testSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.seat.status, 'AVAILABLE');
  });

  await t.test('7. Once unlocked, Customer 2 can now successfully lock the seat', async () => {
    const res = await fetch(`${baseUrl}/seats/lock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seatId: testSeatId }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.seat.status, 'LOCKED');
  });

  await t.test('8. Expired lock reconciliation resets status to AVAILABLE', async () => {
    // Manually backdate the lockedUntil in PostgreSQL to simulate an expired 10-minute timer
    await prisma.seat.update({
      where: { id: testSeatId },
      data: {
        lockedUntil: new Date(Date.now() - 10000), // 10 seconds ago
      },
    });

    const res = await fetch(`${baseUrl}/seats/event/${event.id}`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);

    const seat = body.data.seats.find((s) => s.id === testSeatId);
    assert.strictEqual(seat.status, 'AVAILABLE', 'Expired lock must automatically reconcile to AVAILABLE');
  });

  await t.test('9. Organizer generates venue grid for a custom section', async () => {
    const res = await fetch(`${baseUrl}/seats/generate-grid`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${organizerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: event.id,
        section: 'Media Box',
        tierId: event.tiers[0].id,
        rows: 2,
        seatsPerRow: 5,
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.count, 10);
  });

  await new Promise((resolve) => server.close(resolve));
});
