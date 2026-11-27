/**
 * End to end: feature rows built from the local database by the API, scored by the real ML service with
 * the real v0 artifacts. Proves the two sides agree. Skips when the service is not running.
 *
 *   (apps/ml-service) ML_SERVICE_TOKEN=e2e-token ML_ENV=production python -m uvicorn main:app --port 8011
 *   ML_E2E_URL=http://127.0.0.1:8011 ML_E2E_TOKEN=e2e-token node --test test_ml_shadow_e2e.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = process.env.ML_E2E_URL || 'http://127.0.0.1:8011';
process.env.ML_SERVICE_URL = URL_;
process.env.ML_SERVICE_TOKEN = process.env.ML_E2E_TOKEN || 'e2e-token';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../ml-service/models/v0/registry.json'), 'utf8'));
const sha = (name) => registry.models.find((m) => m.name === name).sha256;

const up = await fetch(`${URL_}/health`).then((r) => r.ok).catch(() => false);
const { mlPost } = await import('./src/services/mlService.js');
const { fraudFeatures, demandFeatures, MissingInput } = await import('./src/services/ml/features.js');
const prisma = (await import('./src/config/prisma.js')).default;
test.after(() => prisma.$disconnect());

test('fraud: real checkout inputs -> real shadow model', { skip: !up && 'ML service not running' }, async () => {
  const seat = await prisma.seat.findFirst({ where: { event: { tiers: { some: {} } } }, select: { id: true, eventId: true } });
  const user = await prisma.user.findFirst({ select: { id: true } });
  const human = { checkoutDurationSeconds: 42, clicksPerMinute: 25, rapidSeatAttempts: 1, timeOnSeatmapSeconds: 30, deviceSwitches: 0 };
  const bot = { checkoutDurationSeconds: 0.8, clicksPerMinute: 320, rapidSeatAttempts: 12, timeOnSeatmapSeconds: 0.5, deviceSwitches: 4 };
  const rows = await Promise.all([human, bot].map((telemetry) =>
    fraudFeatures({ userId: user.id, eventId: seat.eventId, seatIds: [seat.id], telemetry, paymentMethod: 'JAZZCASH', at: new Date() })));
  const r = await mlPost('/v2/shadow/fraud', { sha256: sha('fraud'), rows }, { timeoutMs: 10_000 });
  assert.equal(r.role, 'SHADOW');
  assert.equal(r.may_serve_decisions, false);
  const [h, b] = r.predictions;
  assert.ok(h.probability >= 0 && h.probability <= 1 && b.probability >= 0 && b.probability <= 1);
  assert.ok(b.probability > h.probability, `bot ${b.probability} should score above human ${h.probability}`);
});

test('demand: every event in the database -> real shadow model', { skip: !up && 'ML service not running' }, async () => {
  const events = await prisma.event.findMany({ where: { tiers: { some: {} } }, select: { id: true } });
  const rows = [];
  for (const e of events) {
    try { rows.push(await demandFeatures({ eventId: e.id, at: new Date() })); } catch (err) { if (!(err instanceof MissingInput)) throw err; }
  }
  assert.ok(rows.length > 0);
  const r = await mlPost('/v2/shadow/demand', { sha256: sha('demand'), rows }, { timeoutMs: 10_000 });
  r.predictions.forEach((p, i) => {
    assert.ok(p.low <= p.sales_48h && p.sales_48h <= p.high, JSON.stringify(p));
    assert.ok(p.high <= rows[i].venue_capacity + 1e-6);
  });
});

test('the service refuses calls without the token', { skip: !up && 'ML service not running' }, async () => {
  const res = await fetch(`${URL_}/v2/models`);
  assert.equal(res.status, 401);
});
