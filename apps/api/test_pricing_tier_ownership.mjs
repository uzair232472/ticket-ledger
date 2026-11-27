/**
 * Pricing: an organizer can only change the prices of their OWN event's tiers. Before the fix, PUT
 * /events/:id/pricing and POST /events/:id/publish updated any tier id in the body, so organizer A could change
 * organizer B's prices through A's own event. In-process app, database copy only (name must end in _verify).
 *
 *   DATABASE_URL=postgresql://.../ticketledger_x_verify node --test test_pricing_tier_ownership.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_verify')) {
  console.error(`Refusing to run against "${dbName}": this test writes data and only runs on a *_verify copy.`);
  process.exit(2);
}
const app = (await import('./src/app.js')).default;
const prisma = (await import('./src/config/prisma.js')).default;

test('pricing changes only the tiers of the event in the URL', async (t) => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  t.after(async () => { server.close(); await prisma.$disconnect(); });
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const run = `${Date.now()}`;
  const PASSWORD = 'Password@123';
  const hash = await bcrypt.hash(PASSWORD, 10);
  const call = async (method, path, token, body) => {
    const r = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  async function organizer(name) {
    const u = await prisma.user.create({ data: { name, email: `tierown_${name}_${run}@example.com`, passwordHash: hash, role: 'ORGANIZER', status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
    const c = await prisma.company.create({ data: { userId: u.id, companyName: `Tier ${name} ${run}`, ownerName: name, phone: '0300', email: u.email, city: 'Lahore', ntnCnic: '1', documentUrl: 'x', status: 'APPROVED' } });
    const e = await prisma.event.create({
      data: { companyId: c.id, name: `Tier ${name} ${run}`, description: 'fixture', type: 'MUSIC_CONCERT', status: 'DRAFT', city: 'Lahore', venue: 'Hall', date: new Date(Date.now() + 30 * 86_400_000), time: '19:00',
        tiers: { create: [{ name: 'General', price: 1000, totalQuantity: 10, availableQuantity: 10 }] } },
      include: { tiers: true },
    });
    const login = await call('POST', '/auth/login', null, { email: u.email, password: PASSWORD });
    assert.equal(login.status, 200, login.body?.message);
    return { token: login.body.data.token, event: e, tier: e.tiers[0] };
  }
  const a = await organizer('a');
  const b = await organizer('b');

  // Another organizer's tier through one's own event: refused, nothing changed (also not one's own tier in the same request)
  for (const [path, method] of [[`/events/${a.event.id}/pricing`, 'PUT'], [`/events/${a.event.id}/publish`, 'POST']]) {
    const r = await call(method, path, a.token, { tiers: [{ id: a.tier.id, price: 1500 }, { id: b.tier.id, price: 1 }] });
    assert.equal(r.status, 400, `${method} ${path}: ${r.body?.message}`);
    assert.equal(r.body.code, 'TIER_NOT_IN_EVENT');
    assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: b.tier.id } })).price), 1000, "the other organizer's price is unchanged");
    assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: a.tier.id } })).price), 1000, 'no partial write');
  }
  // Another organizer's event directly: not allowed
  assert.equal((await call('PUT', `/events/${b.event.id}/pricing`, a.token, { tiers: [{ id: b.tier.id, price: 1 }] })).status, 403);
  // One's own tiers: changed
  const ok = await call('PUT', `/events/${a.event.id}/pricing`, a.token, { tiers: [{ id: a.tier.id, price: 1500 }] });
  assert.equal(ok.status, 200, ok.body?.message);
  assert.equal(Number((await prisma.ticketTier.findUnique({ where: { id: a.tier.id } })).price), 1500);
});
