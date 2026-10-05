import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';
import prisma from './src/config/prisma.js';

test('MODULE 5 - Event Management, Ticket Tiers & Multi-Criteria Discovery Tests', async (t) => {
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

  const approvedOrgToken = await getToken('organizer@ticketledger.pk');
  const pendingOrgToken = await getToken('pending_organizer@ticketledger.pk');

  let pslEventId = '';

  await t.test('1. Public discovery endpoint returns seeded Pakistani events', async () => {
    const res = await fetch(`${baseUrl}/events`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.events.length >= 3);

    const psl = body.data.events.find(e => e.name.includes('PSL 2026 Final') || e.name.includes('PSL 10 Final') || e.name.includes('PSL'));
    assert.ok(psl);
    assert.strictEqual(psl.type, 'CRICKET_MATCH');
    assert.strictEqual(psl.city, 'Lahore');
    assert.ok(Number(psl.pricing.minPrice) > 0);
    assert.ok(Number(psl.pricing.maxPrice) >= Number(psl.pricing.minPrice));
    pslEventId = psl.id;
  });

  await t.test('2. Filter events by type (CRICKET_MATCH)', async () => {
    const res = await fetch(`${baseUrl}/events?type=CRICKET_MATCH`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.events.every(e => e.type === 'CRICKET_MATCH'));
  });

  await t.test('3. Filter events by city (Karachi)', async () => {
    const res = await fetch(`${baseUrl}/events?city=Karachi`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.events.length >= 1);
    assert.ok(body.data.events.every(e => e.city.toLowerCase() === 'karachi'));
  });

  await t.test('4. Keyword search across name, venue, description', async () => {
    const res = await fetch(`${baseUrl}/events?search=Atif`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.events.length, 1);
    assert.match(body.data.events[0].name, /Atif Aslam/);
  });

  await t.test('5. Price filter across ticket tiers (minPrice=10000)', async () => {
    const res = await fetch(`${baseUrl}/events?minPrice=10000`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.events.every(e => e.pricing.maxPrice >= 10000));
  });

  await t.test('6. Retrieve public event details with tiers and organizer info', async () => {
    const res = await fetch(`${baseUrl}/events/${pslEventId}`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.event.company.companyName.includes('Pakistan Cricket Board') || body.data.event.company.companyName.includes('PCB'));
    assert.ok(body.data.event.tiers.length >= 3);
  });

  await t.test('7. Unapproved organizer blocked from creating an event', async () => {
    // Ensure company is in PENDING state
    await prisma.company.updateMany({
      where: { user: { email: 'pending_organizer@ticketledger.pk' } },
      data: { status: 'PENDING' },
    });

    const res = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pendingOrgToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Unapproved Match',
        description: 'Should be blocked by requireApprovedOrganizer',
        type: 'CRICKET_MATCH',
        date: '2026-11-20T14:00:00Z',
        time: '2:00 PM',
        city: 'Karachi',
        venue: 'National Stadium',
        tiers: [{ name: 'General', price: 1000, totalQuantity: 100 }],
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  let createdEventId = '';

  await t.test('8. Approved organizer creates new event with ticket tiers', async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${approvedOrgToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Pakistan vs India Kabaddi World Cup Clash',
        description: 'Traditional circle style kabaddi championship exhibition clash at Iqbal Stadium Faisalabad.',
        type: 'KABADDI',
        date: '2026-11-28T16:00:00Z',
        time: '4:00 PM PST',
        city: 'Faisalabad',
        venue: 'Iqbal Stadium, Faisalabad',
        status: 'PUBLISHED',
        tiers: [
          { name: 'Standard Stand', price: 800, totalQuantity: 1500 },
          { name: 'Ring-Side VIP', price: 2500, totalQuantity: 200 },
        ],
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.event.name, 'Pakistan vs India Kabaddi World Cup Clash');
    assert.strictEqual(body.data.event.type, 'KABADDI');
    assert.strictEqual(body.data.event.tiers.length, 2);
    createdEventId = body.data.event.id;
  });

  await t.test('9. Reject event creation without ticket tiers', async () => {
    const res = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${approvedOrgToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Invalid Tierless Event',
        description: 'No ticket tiers provided in payload',
        type: 'BOXING',
        date: '2026-12-01T18:00:00Z',
        time: '6:00 PM',
        city: 'Lahore',
        venue: 'Expo Centre',
        tiers: [],
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('10. Organizer updates event status to PAUSED and PUBLISHED', async () => {
    await prisma.event.update({ where: { id: createdEventId }, data: { status: 'PUBLISHED', approvedAt: new Date() } });

    const res = await fetch(`${baseUrl}/events/${createdEventId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${approvedOrgToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'PAUSED' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.event.status, 'PAUSED');
  });

  await t.test('11. Organizer lists their hosted events', async () => {
    const res = await fetch(`${baseUrl}/events/organizer/my-events`, {
      headers: { Authorization: `Bearer ${approvedOrgToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.events.length >= 2);
  });

  await new Promise((resolve) => server.close(resolve));
});
