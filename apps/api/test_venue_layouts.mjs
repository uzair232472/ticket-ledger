import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import zlib from 'node:zlib';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { buildTemplate, layoutInventory, validateLayout } from '../venue-core/src/index.js';

// Small valid PNG (solid colour) for the plan-upload check
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 200);
  row[0] = 0;
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const rect = (x, y, w, h, rotation = 0) => ({ type: 'rect', x, y, w, h, rotation });

test('Venue layouts: editor, publishing, holds and checkout', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  const stamp = Date.now();
  const tempUsers = [];

  const makeUser = async (role, label) => {
    const user = await prisma.user.create({
      data: { name: label, email: `venue.${label}.${stamp}@ticketledger.pk`, passwordHash: await bcrypt.hash('Password@123', 10), role, status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    tempUsers.push(user.id);
    return user;
  };
  const login = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }) });
    const body = await res.json();
    assert.ok(body.data?.token, `login failed for ${email}: ${body.message}`);
    return body.data.token;
  };
  const call = async (token, method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const other = await makeUser('ORGANIZER', 'otherorg');
  await prisma.company.create({ data: { userId: other.id, companyName: 'Other (venue test)', ownerName: 'O', phone: '03000000000', email: other.email, city: 'Lahore', ntnCnic: `NTN-V-${stamp}`, documentUrl: '/uploads/company_docs/x.pdf', status: 'APPROVED' } });
  const buyer2 = await makeUser('CUSTOMER', 'buyer2');

  const ownerToken = await login('organizer@ticketledger.pk');
  const adminToken = await login('admin@ticketledger.pk');
  const otherToken = await login(other.email);
  const c1Token = await login('customer@ticketledger.pk');
  const c2Token = await login(buyer2.email);
  const c1 = await prisma.user.findUnique({ where: { email: 'customer@ticketledger.pk' } });

  const legacyBefore = await prisma.seat.findMany({ where: { layoutKey: null }, select: { id: true, status: true, tierId: true }, orderBy: { id: 'asc' } });
  let eventId;
  let tiers;
  let layout;

  const venue = () => call(c1Token, 'GET', `/venues/event/${eventId}`);
  const hold = (token, body) => call(token, 'POST', `/venues/event/${eventId}/holds`, body);
  const seatByKey = (key) => prisma.seat.findUnique({ where: { eventId_layoutKey: { eventId, layoutKey: key } } });

  try {
    await t.test('organizer creates a THEATRE event (new category)', async () => {
      const { status, body } = await call(ownerToken, 'POST', '/events', {
        name: `Venue Test Night ${stamp}`,
        description: 'Event created by the venue layout test suite.',
        type: 'THEATRE',
        date: '2027-05-01',
        time: '8:00 PM',
        city: 'Lahore',
        venue: 'Test Hall',
        status: 'PUBLISHED',
        tiers: [
          { name: 'Premium', price: 5000, totalQuantity: 999 },
          { name: 'Standard', price: 2500, totalQuantity: 999 },
          { name: 'Value', price: 1000, totalQuantity: 999 },
        ],
      });
      assert.strictEqual(status, 201, body.message);
      eventId = body.data.event.id;
      tiers = body.data.event.tiers;
    });

    await t.test('editor suggests the theatre template; non-owners are refused', async () => {
      const ed = await call(ownerToken, 'GET', `/venues/event/${eventId}/editor`);
      assert.strictEqual(ed.status, 200, ed.body.message);
      assert.strictEqual(ed.body.data.suggestedTemplate, 'theatre');
      assert.strictEqual(ed.body.data.draft, null);
      assert.strictEqual((await call(otherToken, 'GET', `/venues/event/${eventId}/editor`)).status, 403);
      assert.strictEqual((await call(c1Token, 'GET', `/venues/event/${eventId}/editor`)).status, 403);
      assert.strictEqual((await call(otherToken, 'PUT', `/venues/event/${eventId}/draft`, { data: buildTemplate('theatre') })).status, 403);
      assert.strictEqual((await call(otherToken, 'POST', `/venues/event/${eventId}/publish`)).status, 403);
    });

    await t.test('draft saves without going live; publishing creates exactly the configured seats', async () => {
      const [premium, standard, value] = tiers.sort((a, b) => Number(b.price) - Number(a.price));
      layout = {
        version: 1,
        template: 'custom',
        coordinate: { width: 1000, height: 700 },
        background: null,
        feature: { kind: 'stage', x: 500, y: 60, w: 300, h: 60, rotation: 0, label: 'Stage' },
        sections: [
          { id: 'sec_stalls', name: 'Stalls', booking: 'seats', tierId: premium.id, shape: rect(250, 250, 220, 160), rows: { count: 10, seatsPerRow: 15, rowSpacing: 12, seatSpacing: 10, blocked: ['0:0', '0:1'] } },
          { id: 'sec_floor', name: 'Floor', booking: 'ga', tierId: value.id, shape: rect(650, 250, 220, 160), ga: { capacity: 12 } },
          { id: 'sec_vip', name: 'VIP Tables', booking: 'tables', tierId: premium.id, shape: rect(250, 520, 320, 160), tables: { count: 4, seatsPerTable: 6, columns: 4, mode: 'whole', spacing: 72 } },
          { id: 'sec_lounge', name: 'Lounge', booking: 'tables', tierId: standard.id, shape: rect(700, 520, 320, 160), tables: { count: 3, seatsPerTable: 4, columns: 3, mode: 'seat', spacing: 80 } },
        ],
      };
      const local = validateLayout(layout, { tierIds: tiers.map((x) => x.id), requireTiers: true });
      assert.deepStrictEqual(local.errors, []);
      assert.deepStrictEqual([local.totals.positions, local.totals.blocked, local.totals.sellable], [150 + 12 + 24 + 12, 2, 196]);

      const saved = await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: layout });
      assert.strictEqual(saved.status, 200, saved.body.message);
      assert.deepStrictEqual(saved.body.data.errors, []);
      assert.strictEqual((await venue()).body.data.layout, null, 'a draft is not public');

      const pub = await call(ownerToken, 'POST', `/venues/event/${eventId}/publish`);
      assert.strictEqual(pub.status, 200, pub.body.message);
      const seats = await prisma.seat.findMany({ where: { eventId } });
      assert.strictEqual(seats.length, layoutInventory(layout).length);
      assert.strictEqual(seats.filter((s) => s.status === 'BLOCKED').length, 2);
      assert.strictEqual(seats.filter((s) => s.kind === 'GA_SLOT').length, 12);
      assert.strictEqual(seats.filter((s) => s.wholeTable).length, 24);
      // Tier inventory comes from the plan (no double counting)
      const tierRows = await prisma.ticketTier.findMany({ where: { eventId } });
      const byId = Object.fromEntries(tierRows.map((x) => [x.id, x]));
      assert.strictEqual(byId[premium.id].totalQuantity, 148 + 24);
      assert.strictEqual(byId[standard.id].totalQuantity, 12);
      assert.strictEqual(byId[value.id].totalQuantity, 12);
    });

    await t.test('attendees get the published plan and per-section availability', async () => {
      const { status, body } = await venue();
      assert.strictEqual(status, 200);
      assert.strictEqual(body.data.layout.version, 1);
      assert.strictEqual(body.data.layout.data.sections.length, 4);
      assert.deepStrictEqual(body.data.sections.sec_floor, { total: 12, available: 12, held: 0, sold: 0, blocked: 0 });
      assert.strictEqual(body.data.unavailable['sec_stalls/A/1'], 'B');
    });

    await t.test('two customers cannot hold the same seat, even at the same instant', async () => {
      const a = await hold(c1Token, { key: 'sec_stalls/C/5' });
      assert.strictEqual(a.status, 200, a.body.message);
      const b = await hold(c2Token, { key: 'sec_stalls/C/5' });
      assert.strictEqual(b.status, 409);
      for (const key of ['sec_stalls/D/1', 'sec_stalls/D/2', 'sec_stalls/D/3']) {
        const results = await Promise.all([hold(c1Token, { key }), hold(c2Token, { key })]);
        assert.strictEqual(results.filter((r) => r.status === 200).length, 1, `exactly one winner for ${key}`);
      }
      // Re-holding your own seat keeps the original timer
      const before = await seatByKey('sec_stalls/C/5');
      await new Promise((r) => setTimeout(r, 1100));
      const again = await hold(c1Token, { key: 'sec_stalls/C/5' });
      assert.strictEqual(again.status, 200);
      assert.strictEqual(new Date(again.body.data.holds[0].lockedUntil).getTime(), before.lockedUntil.getTime());
      // Blocked seats can't be held
      assert.strictEqual((await hold(c1Token, { key: 'sec_stalls/A/1' })).status, 409);
      // Releasing someone else's hold does nothing
      const rel = await call(c2Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: ['sec_stalls/C/5'] });
      assert.strictEqual(rel.body.data.released, 0);
      assert.strictEqual((await seatByKey('sec_stalls/C/5')).lockedByUserId, c1.id);
      // Legacy unlock endpoint also refuses another customer's hold
      const legacyUnlock = await call(c2Token, 'POST', '/seats/unlock', { seatId: before.id });
      assert.strictEqual(legacyUnlock.status, 403);
      // Release all of both customers' stalls holds for the next steps
      await call(c1Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: ['sec_stalls/C/5', 'sec_stalls/D/1', 'sec_stalls/D/2', 'sec_stalls/D/3'] });
      await call(c2Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: ['sec_stalls/D/1', 'sec_stalls/D/2', 'sec_stalls/D/3'] });
    });

    await t.test('existing /seats/lock and /seats/unlock still work, with the same guarantees', async () => {
      const seat = await seatByKey('sec_stalls/F/3');
      const a = await call(c1Token, 'POST', '/seats/lock', { seatId: seat.id });
      assert.strictEqual(a.status, 200, a.body.message);
      const [b1, b2] = await Promise.all([call(c2Token, 'POST', '/seats/lock', { seatId: seat.id }), hold(c2Token, { key: 'sec_stalls/F/3' })]);
      assert.deepStrictEqual([b1.status, b2.status], [409, 409]);
      await new Promise((r) => setTimeout(r, 1100));
      const again = await call(c1Token, 'POST', '/seats/lock', { seatId: seat.id });
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.body.data.seat.lockedUntil, a.body.data.seat.lockedUntil, 'no timer restart');
      assert.strictEqual((await call(c1Token, 'POST', '/seats/unlock', { seatId: seat.id })).status, 200);
      assert.strictEqual((await seatByKey('sec_stalls/F/3')).status, 'AVAILABLE');
    });

    await t.test('general admission: quantities never exceed capacity, even concurrently', async () => {
      const a = await hold(c1Token, { sectionId: 'sec_floor', quantity: 3 });
      assert.strictEqual(a.status, 200, a.body.message);
      assert.strictEqual(a.body.data.holds.length, 3);
      const tooMany = await hold(c2Token, { sectionId: 'sec_floor', quantity: 10 });
      assert.strictEqual(tooMany.status, 409);
      assert.match(tooMany.body.message, /Only 9/);
      // Parallel requests for more than what is left: the total held never passes 12
      const [x, y] = await Promise.all([hold(c1Token, { sectionId: 'sec_floor', quantity: 8 }), hold(c2Token, { sectionId: 'sec_floor', quantity: 7 })]);
      assert.ok([x.status, y.status].includes(200));
      const locked = await prisma.seat.count({ where: { eventId, sectionKey: 'sec_floor', status: 'LOCKED' } });
      assert.ok(locked <= 12, `held ${locked} of 12`);
      // Lowering the quantity releases the surplus
      const down = await hold(c1Token, { sectionId: 'sec_floor', quantity: 1 });
      assert.strictEqual(down.body.data.holds.length, 1);
      await hold(c2Token, { sectionId: 'sec_floor', quantity: 0 });
      // Single GA places can't be grabbed by key
      const anyGa = await prisma.seat.findFirst({ where: { eventId, kind: 'GA_SLOT', status: 'AVAILABLE' } });
      assert.strictEqual((await call(c2Token, 'POST', '/seats/lock', { seatId: anyGa.id })).status, 400);
    });

    await t.test('whole tables are held and booked together; individual table seats work alone', async () => {
      const tbl = await hold(c1Token, { tableKey: 'sec_vip/T2' });
      assert.strictEqual(tbl.status, 200, tbl.body.message);
      assert.strictEqual(tbl.body.data.holds.length, 6);
      assert.strictEqual((await hold(c2Token, { tableKey: 'sec_vip/T2' })).status, 409);
      assert.strictEqual((await hold(c2Token, { key: 'sec_vip/Table 3/1' })).status, 400);
      const partial = await call(c1Token, 'POST', '/bookings/initiate', { eventId, seatIds: tbl.body.data.holds.slice(0, 3).map((h) => h.id) });
      assert.strictEqual(partial.status, 400);
      assert.match(partial.body.message, /whole table/);
      const chair = await hold(c2Token, { key: 'sec_lounge/Table 1/2' });
      assert.strictEqual(chair.status, 200, chair.body.message);
      await call(c2Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: ['sec_lounge/Table 1/2'] });
    });

    let orderId;
    await t.test('checkout: server prices, one sale per seat, parallel confirmations are safe', async () => {
      const mine = (await venue()).body.data.mine;
      // c1 holds the whole VIP table (6) and one GA place
      assert.strictEqual(mine.length, 7);
      const init = await call(c1Token, 'POST', '/bookings/initiate', { eventId, seatIds: mine.map((m) => m.id), paymentMethod: 'MOCK' });
      assert.strictEqual(init.status, 201, init.body.message);
      orderId = init.body.data.orderId;
      assert.strictEqual(Number(init.body.data.totalAmount), 6 * 5000 + 1000);
      // Another customer can't start a checkout on the same seats
      const steal = await call(c2Token, 'POST', '/bookings/initiate', { eventId, seatIds: [mine[0].id] });
      assert.strictEqual(steal.status, 409);
      const [r1, r2] = await Promise.all([
        call(c1Token, 'POST', '/bookings/confirm', { orderId, paymentDetails: {} }),
        call(c1Token, 'POST', '/bookings/confirm', { orderId, paymentDetails: {} }),
      ]);
      assert.deepStrictEqual([r1.status, r2.status], [200, 200], `${r1.body.message} / ${r2.body.message}`);
      assert.strictEqual(await prisma.ticket.count({ where: { orderId } }), 7);
      assert.strictEqual(await prisma.seat.count({ where: { eventId, tableKey: 'sec_vip/T2', status: 'SOLD' } }), 6);
      const v = (await venue()).body.data;
      assert.strictEqual(v.unavailable['sec_vip/Table 2/1'], 'S');
      assert.strictEqual(v.sections.sec_floor.sold, 1);
    });

    await t.test('expired holds and lapsed checkouts are released; a late confirmation is refused', async () => {
      const h = await hold(c2Token, { key: 'sec_stalls/E/7' });
      assert.strictEqual(h.status, 200);
      await prisma.seat.update({ where: { id: h.body.data.holds[0].id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      const v = (await call(c2Token, 'GET', `/venues/event/${eventId}`)).body.data;
      assert.strictEqual(v.unavailable['sec_stalls/E/7'], undefined);
      assert.strictEqual(v.mine.length, 0);

      const h2 = await hold(c2Token, { key: 'sec_stalls/E/8' });
      const init = await call(c2Token, 'POST', '/bookings/initiate', { eventId, seatIds: [h2.body.data.holds[0].id] });
      assert.strictEqual(init.status, 201, init.body.message);
      // While the checkout is in its payment grace period nobody else can take the seat
      await prisma.seat.update({ where: { id: h2.body.data.holds[0].id }, data: { lockedUntil: new Date(Date.now() - 30 * 1000) } });
      assert.strictEqual((await hold(c1Token, { key: 'sec_stalls/E/8' })).status, 409);
      // After the grace period the checkout lapses, the seat frees up, and paying late is refused
      await prisma.seat.update({ where: { id: h2.body.data.holds[0].id }, data: { lockedUntil: new Date(Date.now() - 10 * 60 * 1000) } });
      const taken = await hold(c1Token, { key: 'sec_stalls/E/8' });
      assert.strictEqual(taken.status, 200, taken.body.message);
      const late = await call(c2Token, 'POST', '/bookings/confirm', { orderId: init.body.data.orderId, paymentDetails: {} });
      assert.ok([400, 409].includes(late.status), `late confirm → ${late.status} ${late.body.message}`);
      assert.strictEqual((await prisma.order.findUnique({ where: { id: init.body.data.orderId } })).status, 'FAILED');
      await call(c1Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: ['sec_stalls/E/8'] });
    });

    await t.test('publishing refuses changes to booked seats and keeps stable seat IDs', async () => {
      const soldIds = (await prisma.seat.findMany({ where: { eventId, status: 'SOLD' }, select: { id: true }, orderBy: { id: 'asc' } })).map((s) => s.id);
      // Removing the section with the sold table → refused
      const removing = { ...layout, sections: layout.sections.filter((s) => s.id !== 'sec_vip') };
      await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: removing });
      const refused = await call(ownerToken, 'POST', `/venues/event/${eventId}/publish`);
      assert.strictEqual(refused.status, 409);
      assert.ok(refused.body.conflicts.length >= 6);
      // Re-pricing the sold table → refused
      const [premium, standard] = tiers.sort((a, b) => Number(b.price) - Number(a.price));
      const repriced = { ...layout, sections: layout.sections.map((s) => (s.id === 'sec_vip' ? { ...s, tierId: standard.id } : s)) };
      await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: repriced });
      assert.strictEqual((await call(ownerToken, 'POST', `/venues/event/${eventId}/publish`)).status, 409);
      // An ordinary edit (more stalls rows, a new section) publishes and keeps existing seat IDs
      const stallsBefore = await seatByKey('sec_stalls/B/4');
      const grown = {
        ...layout,
        sections: [
          ...layout.sections.map((s) => (s.id === 'sec_stalls' ? { ...s, rows: { ...s.rows, count: 11 } } : s)),
          { id: 'sec_box', name: 'Box', booking: 'seats', tierId: premium.id, shape: rect(500, 650, 120, 60), rows: { count: 3, seatsPerRow: 8, rowSpacing: 12, seatSpacing: 10 } },
        ],
      };
      await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: grown });
      const ok = await call(ownerToken, 'POST', `/venues/event/${eventId}/publish`);
      assert.strictEqual(ok.status, 200, ok.body.message);
      assert.strictEqual((await seatByKey('sec_stalls/B/4')).id, stallsBefore.id);
      assert.deepStrictEqual((await prisma.seat.findMany({ where: { eventId, status: 'SOLD' }, select: { id: true }, orderBy: { id: 'asc' } })).map((s) => s.id), soldIds);
      assert.strictEqual((await venue()).body.data.layout.version, 2);
      layout = grown;
    });

    await t.test('a hold racing a publish that removes its seat: never both succeed', async () => {
      for (let round = 0; round < 3; round++) {
        const key = `sec_box/B/${round + 1}`;
        const without = { ...layout, sections: layout.sections.map((s) => (s.id === 'sec_box' ? { ...s, rows: { ...s.rows, count: 1 } } : s)) };
        await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: without });
        const [h, p] = await Promise.all([hold(c2Token, { key }), call(ownerToken, 'POST', `/venues/event/${eventId}/publish`)]);
        const seat = await seatByKey(key);
        if (h.status === 200) {
          assert.strictEqual(p.status, 409, 'publish must refuse once the seat is held');
          assert.ok(seat, 'held seat still exists');
          await call(c2Token, 'POST', `/venues/event/${eventId}/holds/release`, { keys: [key] });
        } else {
          assert.strictEqual(p.status, 200, p.body.message);
          assert.strictEqual(seat, null);
        }
        // Restore the full Box section for the next round
        await call(ownerToken, 'PUT', `/venues/event/${eventId}/draft`, { data: layout });
        assert.strictEqual((await call(ownerToken, 'POST', `/venues/event/${eventId}/publish`)).status, 200);
      }
    });

    await t.test('super admin can manage; plan images are validated', async () => {
      assert.strictEqual((await call(adminToken, 'GET', `/venues/event/${eventId}/editor`)).status, 200);
      const good = new FormData();
      good.append('plan', new Blob([png(1600, 1000)], { type: 'image/png' }), 'plan.png');
      const up = await call(ownerToken, 'POST', `/venues/event/${eventId}/plan-image`, good);
      assert.strictEqual(up.status, 200, up.body.message);
      assert.deepStrictEqual([up.body.data.width, up.body.data.height], [1600, 1000]);
      const small = new FormData();
      small.append('plan', new Blob([png(400, 300)], { type: 'image/png' }), 'small.png');
      assert.strictEqual((await call(ownerToken, 'POST', `/venues/event/${eventId}/plan-image`, small)).status, 400);
      const fake = new FormData();
      fake.append('plan', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
      assert.strictEqual((await call(ownerToken, 'POST', `/venues/event/${eventId}/plan-image`, fake)).status, 400);
      if (up.body.data.url.startsWith('/uploads/')) {
        const fs = await import('node:fs');
        fs.rmSync(new URL(`.${up.body.data.url}`, import.meta.url), { force: true });
      }
    });

    await t.test('older events keep their existing seat map', async () => {
      const legacyEvent = await prisma.event.findFirst({ where: { seats: { some: { layoutKey: null } } } });
      const res = await call(null, 'GET', `/seats/event/${legacyEvent.id}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.seats.length > 0);
      assert.strictEqual((await call(null, 'GET', `/venues/event/${legacyEvent.id}`)).body.data.layout, null);
      const legacyAfter = await prisma.seat.findMany({ where: { layoutKey: null }, select: { id: true, status: true, tierId: true }, orderBy: { id: 'asc' } });
      assert.deepStrictEqual(legacyAfter, legacyBefore);
    });
  } finally {
    if (eventId) {
      const orders = await prisma.order.findMany({ where: { eventId }, select: { id: true } });
      await prisma.ticket.deleteMany({ where: { eventId } });
      await prisma.order.deleteMany({ where: { eventId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: eventId }, { targetId: { in: orders.map((o) => o.id) } }] } });
      await prisma.notification.deleteMany({ where: { message: { contains: `Venue Test Night ${stamp}` } } });
      await prisma.behaviorEvent.deleteMany({ where: { eventId } }).catch(() => {});
      await prisma.event.delete({ where: { id: eventId } });
    }
    await prisma.company.deleteMany({ where: { userId: { in: tempUsers } } });
    await prisma.behaviorEvent.deleteMany({ where: { userId: { in: tempUsers } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: tempUsers } } }).catch((e) => console.warn('user cleanup:', e.message));
    server.close();
    await prisma.$disconnect();
  }
});
