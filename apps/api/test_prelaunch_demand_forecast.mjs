import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 17 - Pre-Launch Demand Forecast & Pricing Adjustment Tests', async (t) => {
  let adminToken = null;
  let targetEvent = null;
  let originalTiers = [];

  // 1. Authenticate Roles
  await t.test('1. Authenticate Super Admin', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@ticketledger.pk', password: 'Password@123' }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    adminToken = data.data.token;
  });

  // 2. Fetch an existing event
  await t.test('2. Retrieve an event for pre-launch analysis', async () => {
    const res = await fetch(`${BASE_URL}/events`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.events.length > 0);
    targetEvent = data.data.events[0];
    originalTiers = targetEvent.tiers || [];
    assert.ok(originalTiers.length > 0, 'Event must have at least one ticket tier');
  });

  // 3. Fetch Pre-Launch Demand Forecast before publishing
  await t.test('3. Fetch pre-launch demand forecast metrics before publishing', async () => {
    const res = await fetch(`${BASE_URL}/events/${targetEvent.id}/prelaunch-forecast`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    const f = data.data;
    assert.equal(f.eventId, targetEvent.id);

    // 1. Predicted first 48-hour sales
    assert.ok(typeof f.predicted_48h_sales === 'number');
    assert.ok(f.predicted_48h_sales > 0);

    // 2. Expected revenue
    assert.ok(typeof f.expected_revenue_pkr === 'number');
    assert.ok(f.expected_revenue_pkr > 0);

    // 3. Demand level
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'VIRAL'].includes(f.demand_level));

    // 4. Suggested publish time
    assert.ok(f.suggested_publish_time);
    assert.ok(f.suggested_publish_time.includes('at'));
    assert.ok(f.suggested_window_reason);

    // 5. Pricing warning
    assert.ok(f.pricing_warning);
    assert.ok(f.pricing_warning.level);
    assert.ok(f.pricing_warning.title);
    assert.ok(f.pricing_warning.message);
    assert.ok(f.pricing_warning.recommendation);
  });

  // 4. Pricing warning reacts to simulated price changes
  await t.test('4. Pricing warning triggers HIGH_PRICE_WARNING for excessive prices', async () => {
    const res = await fetch(`${BASE_URL}/events/${targetEvent.id}/prelaunch-forecast?simulatedPrice=12000`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.data.pricing_warning.level, 'HIGH_PRICE_WARNING');
    assert.ok(data.data.pricing_warning.message.includes('above historical averages'));
  });

  await t.test('5. Pricing warning triggers UNDERPRICED_WARNING when demand is high and price is low', async () => {
    const res = await fetch(`${BASE_URL}/events/${targetEvent.id}/prelaunch-forecast?simulatedPrice=1200`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.data.pricing_warning.level);
    assert.ok(data.data.pricing_warning.message);
  });

  // 5. Organizer adjusts price before publishing
  await t.test('6. Organizer adjusts ticket tier prices before publishing', async () => {
    const adjustedTiers = originalTiers.map((t, idx) => ({
      id: t.id,
      price: 2500 + idx * 1500,
    }));

    const res = await fetch(`${BASE_URL}/events/${targetEvent.id}/pricing`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ tiers: adjustedTiers }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.event.tiers[0].price, '2500');
  });

  // 6. Save adjusted prices and publish event
  await t.test('7. Save prices and publish event transitions status to PUBLISHED', async () => {
    const finalTiers = originalTiers.map((t, idx) => ({
      id: t.id,
      price: 3000 + idx * 2000,
    }));

    const res = await fetch(`${BASE_URL}/events/${targetEvent.id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ tiers: finalTiers }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.data.event.status, 'PUBLISHED');
    assert.match(data.message, /PUBLISHED/);
  });
});
