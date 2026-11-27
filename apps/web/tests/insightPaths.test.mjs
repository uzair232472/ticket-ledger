// Organizers get /organizer/... addresses for the shared insight pages; super admins keep /admin/...
import test from 'node:test';
import assert from 'node:assert/strict';
import { insightPath } from '../src/lib/insightPaths.js';

test('insight page addresses by role', () => {
  assert.equal(insightPath('SUPER_ADMIN', 'intent'), '/admin/purchase-intent');
  assert.equal(insightPath('SUPER_ADMIN', 'demand'), '/admin/demand-forecast');
  assert.equal(insightPath('SUPER_ADMIN', 'abandoned'), '/admin/abandoned-intents');
  for (const role of ['ORGANIZER', 'GATE_STAFF', undefined]) {
    assert.equal(insightPath(role, 'intent'), '/organizer/purchase-intent');
    assert.equal(insightPath(role, 'demand'), '/organizer/demand-forecast');
    assert.equal(insightPath(role, 'abandoned'), '/organizer/abandoned-intents');
  }
});
