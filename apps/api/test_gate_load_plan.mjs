import assert from 'node:assert/strict';
import test from 'node:test';

const { planGates, peakHourShare, waitMinutes } = await import('./src/services/gateLoadPlan.js');
const prisma = (await import('./src/config/prisma.js')).default;
test.after(() => prisma.$disconnect());

const rows = (n, per) => Array.from({ length: n }, (_, i) => ({ row: String.fromCharCode(65 + i), tickets: per }));
const GATES = [
  { id: 'A', name: 'Gate A', capacityPerHour: 2000, allowedTierIds: [] },
  { id: 'B', name: 'Gate B', capacityPerHour: 2000, allowedTierIds: [] },
  { id: 'C', name: 'Gate C (VIP)', capacityPerHour: 800, allowedTierIds: ['vip'] },
];
const GROUPS = [
  { key: 'n', tierId: 'gen', tierName: 'General', section: 'North', tickets: 6000, expected: 5100, rows: rows(20, 300) },
  { key: 's', tierId: 'gen', tierName: 'General', section: 'South', tickets: 3000, expected: 2550, rows: rows(10, 300) },
  { key: 'p', tierId: 'vip', tierName: 'VIP', section: 'Pavilion', tickets: 3000, expected: 2550, rows: rows(10, 300) },
];
const worst = (gs) => Math.max(...gs.map((g) => g.utilisation));

test('the plan never makes the fullest gate fuller, and balances an overloaded event', () => {
  const r = planGates(GROUPS, GATES, 0.5);
  assert.ok(worst(r.after) <= worst(r.before) + 1e-9);
  assert.ok(worst(r.before) > 1.1 && worst(r.after) < 1.07, `${worst(r.before)} -> ${worst(r.after)}`);
  // Everyone placed, nobody lost
  const sum = (gs) => gs.reduce((a, g) => a + g.expectedPeople, 0);
  assert.ok(Math.abs(sum(r.after) - 10200) < 2);
  // Still overloaded after balancing: says how much capacity is missing
  assert.ok(r.advice.some((a) => a.kind === 'ADD_CAPACITY'));
});

test('a ticket type is only ever sent to a gate that accepts it', () => {
  const r = planGates(GROUPS, GATES, 0.5);
  for (const a of r.assignment) {
    const g = GATES.find((x) => x.id === a.gateId);
    assert.ok(!g.allowedTierIds.length || g.allowedTierIds.includes(a.tierId), `${a.section} -> ${g.name}`);
  }
});

test('a split section is split by whole seat rows, in order, without gaps', () => {
  const r = planGates(GROUPS, GATES, 0.5);
  for (const key of ['n', 'p']) {
    const parts = r.assignment.filter((a) => a.key === key);
    const all = parts.flatMap((p) => p.rowList || []);
    if (parts.length > 1) assert.deepEqual(all, rows(key === 'n' ? 20 : 10, 0).map((x) => x.row));
  }
});

test('one gate for one ticket type: advises allowing the type at a quieter gate', () => {
  const gates = [{ id: 'A', name: 'Main', capacityPerHour: 3000, allowedTierIds: ['gen'] }, { id: 'V', name: 'VIP', capacityPerHour: 1000, allowedTierIds: ['vip'] }];
  const groups = [{ key: 'g', tierId: 'gen', tierName: 'General', section: 'Stand', tickets: 9000, expected: 8000 }, { key: 'v', tierId: 'vip', tierName: 'VIP', section: 'Box', tickets: 200, expected: 180 }];
  const r = planGates(groups, gates, 0.5);
  assert.equal(r.after.find((g) => g.name === 'Main').status, 'OVERLOADED');
  assert.ok(r.advice.some((a) => a.kind === 'ALLOW_TIER' && /Allow General at VIP/.test(a.text)));
});

test('no gate accepts a ticket type: reported, not placed', () => {
  const r = planGates([{ key: 'x', tierId: 'kids', tierName: 'Kids', section: 'K', tickets: 10, expected: 9 }], [GATES[2]], 0.5);
  assert.ok(r.advice.some((a) => a.kind === 'NO_GATE'));
  assert.equal(r.assignment.length, 0);
});

test('peak hour share and queue wait', () => {
  assert.equal(Math.round(peakHourShare(new Array(30).fill(1 / 30)) * 100), 40);
  assert.equal(waitMinutes(2400, 2000), 12);
  assert.equal(waitMinutes(1500, 2000), 0);
});
