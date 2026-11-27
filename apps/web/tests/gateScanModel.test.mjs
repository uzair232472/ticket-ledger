// Offline scan record rules (src/lib/gateScanModel.js): ids, required fields, queue migration and its
// verification, upload validation, acknowledgements, error handling, recovery and retention.
//   node --test tests/
import assert from 'node:assert/strict';
import test from 'node:test';
import * as M from '../src/lib/gateScanModel.js';

const legacyItem = (n, extra = {}) => ({
  clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  eventId: 'event-1',
  code: `TL-AAAA-${String(n).padStart(4, '0')}`,
  gate: 'Gate A',
  gateId: 'gate-a',
  direction: 'ENTRY',
  scannedAt: new Date(Date.UTC(2026, 10, 18, 18, 0, n)).toISOString(),
  localResult: 'GREEN',
  localReason: 'Entry allowed',
  ...extra,
});
const record = (n, extra = {}) => ({ ...M.newScanRecord({ seq: n, deviceId: 'gate-dev', eventId: 'event-1', ticketId: `t${n}`, code: `TL-BBBB-${String(n).padStart(4, '0')}`, gate: 'Gate A', gateId: 'gate-a', direction: 'ENTRY', localResult: 'GREEN', localReason: 'Entry allowed', recordedBy: 'u1' }), ...extra });

test('scan ids are unique RFC 4122 v4 ids', () => {
  const ids = new Set(Array.from({ length: 20000 }, () => M.newScanId()));
  assert.equal(ids.size, 20000);
  for (const id of [...ids].slice(0, 50)) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a new record carries event, ticket, device, gate, direction, sequence, device time and result; starts PENDING', () => {
  const at = new Date('2026-11-18T19:00:00Z');
  const r = M.newScanRecord({ seq: 7, deviceId: 'gate-dev', eventId: 'e', ticketId: 't', code: '  TL-ABCD-EFGH ', gate: 'Gate A', gateId: 'g', direction: 'EXIT', localResult: 'GREEN', localReason: 'ok', recordedBy: 'u', appVersion: 'v1', at });
  assert.match(r.scanId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    [r.seq, r.deviceId, r.eventId, r.ticketId, r.code, r.gate, r.gateId, r.direction, r.deviceScannedAt, r.localResult, r.recordedBy, r.syncState, r.attempts, r.schema],
    [7, 'gate-dev', 'e', 't', 'TL-ABCD-EFGH', 'Gate A', 'g', 'EXIT', at.toISOString(), 'GREEN', 'u', 'PENDING', 0, M.SCAN_SCHEMA],
  );
  // Unknown values never become an admission
  const odd = M.newScanRecord({ seq: 1, deviceId: 'd', eventId: 'e', code: 'TL-ABCD-EFGH', direction: 'SIDEWAYS', localResult: 'MAYBE' });
  assert.deepEqual([odd.direction, odd.localResult], ['ENTRY', 'RED']);
  assert.equal(M.newScanRecord({ scanId: 'given', seq: 1 }).scanId, 'given', 'an id chosen before the online attempt is kept');
});

test('legacy queue items keep their id and original device time, and mirror back unchanged (rollback)', () => {
  const q = legacyItem(1);
  const r = M.fromLegacyItem(q, { seq: 3, deviceId: 'gate-dev', appVersion: 'v2' });
  assert.equal(r.scanId, q.clientId);
  assert.equal(r.deviceScannedAt, q.scannedAt);
  assert.equal(r.migratedFrom, 'queue-v1');
  assert.equal(r.syncState, 'PENDING');
  assert.deepEqual(M.toLegacyItem(r), q);
  // A malformed old timestamp is preserved as evidence rather than replaced
  assert.equal(M.fromLegacyItem(legacyItem(2, { scannedAt: 'not a date' }), { seq: 4 }).deviceScannedAt, 'not a date');
});

test('migration plan: only items not already stored (no duplicates), oldest first', () => {
  const items = [legacyItem(3), legacyItem(1), legacyItem(2), legacyItem(1), { code: 'no id' }, null];
  const plan = M.planMigration(items, [legacyItem(2).clientId]);
  assert.deepEqual(plan.map((q) => q.clientId), [legacyItem(1).clientId, legacyItem(3).clientId]);
  assert.deepEqual(M.planMigration([], []), []);
});

test('migration verification: every backed-up item must have an identical record', () => {
  const items = [legacyItem(1), legacyItem(2), legacyItem(3)];
  const records = items.map((q, i) => M.fromLegacyItem(q, { seq: i + 1, deviceId: 'd' }));
  assert.deepEqual(M.verifyMigration(items, records), { ok: true, missing: [], mismatched: [] });
  const tampered = records.map((r, i) => (i === 1 ? { ...r, code: 'TL-ZZZZ-ZZZZ' } : r));
  assert.deepEqual(M.verifyMigration(items, tampered).mismatched, [items[1].clientId]);
  const movedGate = records.map((r, i) => (i === 2 ? { ...r, gateId: 'other' } : r));
  assert.deepEqual(M.verifyMigration(items, movedGate).mismatched, [items[2].clientId]);
  const res = M.verifyMigration(items, [records[0], undefined, records[2]]);
  assert.deepEqual([res.ok, res.missing], [false, [items[1].clientId]]);
});

test('backup checksum is order-independent and detects any change', async () => {
  const items = [legacyItem(1), legacyItem(2)];
  const a = await M.checksum(items);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await M.checksum([items[1], { ...items[0] }]), a);
  assert.notEqual(await M.checksum([items[0], { ...items[1], localResult: 'RED' }]), a);
  assert.notEqual(await M.checksum([items[0]]), a);
});

test('records the server would refuse are caught before upload', () => {
  assert.equal(M.uploadProblem(record(1)), null);
  assert.match(M.uploadProblem(record(1, { code: 'abc' })), /too short/);
  assert.match(M.uploadProblem(record(1, { code: 'x'.repeat(401) })), /too long/);
  assert.match(M.uploadProblem(record(1, { deviceScannedAt: 'x'.repeat(41) })), /time/);
  assert.match(M.uploadProblem(record(1, { eventId: null })), /event/);
});

test('upload items use the scan id as clientId and stay inside the sync limits', () => {
  const r = record(5, { localReason: 'r'.repeat(300) });
  const u = M.toUploadItem(r);
  assert.equal(u.clientId, r.scanId);
  assert.equal(u.scannedAt, r.deviceScannedAt);
  assert.equal(u.localReason.length, 200);
  assert.equal(u.seq, 5);
  assert.equal(u.ticketId, 't5');
});

test('acknowledgements: acknowledged scans are SYNCED or CONFLICT, unacknowledged ones go back to PENDING; none dropped', () => {
  const batch = [1, 2, 3, 4].map((n) => ({ ...record(n), syncState: 'UPLOADING' }));
  const results = [
    { clientId: batch[2].scanId, result: 'YELLOW', reason: 'Duplicate admission while offline', conflict: true },
    { clientId: batch[0].scanId, result: 'GREEN', reason: 'Entry allowed', conflict: false },
    { clientId: 'someone-else', result: 'GREEN' },
    { clientId: batch[1].scanId, result: 'RED', reason: 'Ticket refunded / cancelled', conflict: false },
  ];
  const out = M.applyAcks(batch, results, new Date('2026-11-18T20:00:00Z'));
  assert.equal(out.length, batch.length);
  assert.deepEqual(out.map((r) => r.syncState), ['SYNCED', 'SYNCED', 'CONFLICT', 'PENDING']);
  assert.deepEqual(out[1].server, { status: 'ACCEPTED', result: 'RED', reason: 'Ticket refunded / cancelled', conflict: false }, 'no status (older server) means accepted');
  assert.equal(out[0].syncedAt, '2026-11-18T20:00:00.000Z');
  assert.match(out[3].lastError, /did not acknowledge/);
  assert.deepEqual(out.map((r) => r.scanId), batch.map((r) => r.scanId), 'original records preserved');
  assert.equal(out[2].localResult, 'GREEN', 'the device verdict is kept next to the server one');
});

test('failed requests: connection, server and credential problems retry; invalid requests are kept as FAILED', () => {
  const e = (status, message) => ({ response: status ? { status, data: { message } } : undefined });
  assert.deepEqual(M.classifySyncError(e()), { state: 'PENDING', retry: true, message: 'No connection to the server' });
  for (const s of [500, 502, 503, 408, 429]) assert.equal(M.classifySyncError(e(s)).state, 'PENDING', String(s));
  for (const s of [401, 403]) assert.equal(M.classifySyncError(e(s, 'Device credential')).state, 'PENDING', String(s));
  const bad = M.classifySyncError(e(400, 'Invalid request'));
  assert.deepEqual([bad.state, bad.message], ['FAILED', 'Invalid request']);
  assert.equal(M.classifySyncError(e(413)).state, 'FAILED');
});

test('interrupted uploads go back to PENDING; other states are untouched', () => {
  for (const s of M.STATES) {
    const r = M.recoverInterrupted({ ...record(1), syncState: s });
    assert.equal(r.syncState, s === 'UPLOADING' ? 'PENDING' : s);
    if (s === 'UPLOADING') assert.match(r.lastError, /interrupted/);
  }
});

test('retention: only SYNCED records older than 30 days are pruned; unprocessed and conflicts never', () => {
  const now = Date.parse('2026-12-31T00:00:00Z');
  const old = new Date(now - M.SYNCED_RETENTION_MS - 1000).toISOString();
  const recent = new Date(now - 1000).toISOString();
  assert.equal(M.shouldPrune({ syncState: 'SYNCED', syncedAt: old }, now), true);
  assert.equal(M.shouldPrune({ syncState: 'SYNCED', syncedAt: recent }, now), false);
  assert.equal(M.shouldPrune({ syncState: 'SYNCED', syncedAt: null }, now), false);
  for (const s of ['PENDING', 'UPLOADING', 'FAILED', 'CONFLICT']) assert.equal(M.shouldPrune({ syncState: s, syncedAt: old, createdAt: old }, now), false, s);
});

test('counts by state; FAILED counts as not uploaded', () => {
  const c = M.countStates(['PENDING', 'PENDING', 'UPLOADING', 'SYNCED', 'FAILED', 'CONFLICT'].map((s) => ({ syncState: s })));
  assert.deepEqual([c.PENDING, c.UPLOADING, c.SYNCED, c.FAILED, c.CONFLICT, c.unsynced], [2, 1, 1, 1, 1, 4]);
});

test('large queue: 5,000 old scans plan, convert and verify', async () => {
  const items = Array.from({ length: 5000 }, (_, i) => legacyItem(i + 1));
  const started = Date.now();
  const plan = M.planMigration(items.slice().reverse(), []);
  const records = plan.map((q, i) => M.fromLegacyItem(q, { seq: i + 1, deviceId: 'd' }));
  assert.equal(M.verifyMigration(plan, records).ok, true);
  assert.equal(await M.checksum(plan), await M.checksum(items));
  assert.deepEqual(records.slice(0, 3).map((r) => r.seq), [1, 2, 3]);
  assert.ok(records.every((r, i) => i === 0 || r.deviceScannedAt >= records[i - 1].deviceScannedAt), 'oldest first');
  assert.ok(Date.now() - started < 5000);
});

test('per-scan statuses: ALREADY_PROCESSED is synced, REJECTED is kept as FAILED, RETRY goes back to PENDING', () => {
  const batch = [1, 2, 3, 4].map((n) => ({ ...record(n), syncState: 'UPLOADING' }));
  const out = M.applyAcks(batch, [
    { clientId: batch[0].scanId, status: 'ALREADY_PROCESSED', result: 'GREEN', reason: 'Entry allowed', conflict: false },
    { clientId: batch[1].scanId, status: 'REJECTED', result: null, reason: 'This scan could not be read and was kept for review (code: too short)' },
    { clientId: batch[2].scanId, status: 'RETRY', result: null, reason: 'The server could not process this scan; it will be sent again.' },
    { clientId: batch[3].scanId, status: 'ACCEPTED', result: 'YELLOW', reason: 'Duplicate admission while offline', conflict: true },
  ]);
  assert.deepEqual(out.map((r) => r.syncState), ['SYNCED', 'FAILED', 'PENDING', 'CONFLICT']);
  assert.equal(out[0].server.status, 'ALREADY_PROCESSED');
  assert.match(out[1].lastError, /kept for review/);
  assert.match(out[2].lastError, /sent again/);
});

test('evidence hand-in: acknowledged scans become QUARANTINED (not counted as waiting); the rest stay', () => {
  const batch = [1, 2].map((n) => ({ ...record(n), syncState: 'UPLOADING' }));
  const out = M.applyEvidenceAcks(batch, [{ clientId: batch[0].scanId, status: 'QUARANTINED' }]);
  assert.deepEqual(out.map((r) => r.syncState), ['QUARANTINED', 'PENDING']);
  assert.equal(out[0].server.status, 'QUARANTINED');
  const c = M.countStates(out);
  assert.deepEqual([c.QUARANTINED, c.unsynced], [1, 1]);
  assert.equal(M.shouldPrune({ ...out[0], syncedAt: '2000-01-01T00:00:00Z' }), false, 'evidence is never pruned on the device');
});

test('backoff: grows from 30 s to a 10 min cap, with ±20 % jitter; none without failures', () => {
  assert.equal(M.backoffDelay(0), 0);
  const mid = (n) => M.backoffDelay(n, () => 0.5);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 12].map(mid), [30000, 60000, 120000, 240000, 480000, 600000, 600000]);
  assert.equal(M.backoffDelay(1, () => 0), 24000);
  assert.equal(M.backoffDelay(1, () => 1), 36000);
});

test('diagnostics: counts, stuck scans, oldest unprocessed and last scan; the pending list is unprocessed only', () => {
  const now = Date.parse('2026-11-18T20:00:00Z');
  const at = (min) => new Date(now - min * 60000).toISOString();
  const recs = [
    { ...record(1), syncState: 'SYNCED', createdAt: at(60) },
    { ...record(2), syncState: 'PENDING', createdAt: at(20) }, // stuck by age
    { ...record(3), syncState: 'FAILED', createdAt: at(2), attempts: 5 }, // stuck by attempts
    { ...record(4), syncState: 'PENDING', createdAt: at(1) },
    { ...record(5), syncState: 'CONFLICT', createdAt: at(0) },
  ];
  const d = M.scanDiagnostics(recs, now);
  assert.deepEqual([d.pending, d.failed, d.conflicts, d.stuck], [2, 1, 1, 2]);
  assert.equal(d.oldestPendingAt, at(20));
  assert.equal(d.lastScanAt, at(0));
  assert.deepEqual(d.manifest.map((m) => m.seq), [2, 3, 4]);
  assert.ok(d.manifest.every((m) => !('code' in m)), 'the pending list does not carry ticket codes');
  assert.deepEqual(M.scanDiagnostics([], now).stuck, 0);
});

test('after the server holds a scan its ticket code is removed from the device (last 4 kept); unprocessed keep it', () => {
  const batch = [1, 2, 3].map((n) => ({ ...record(n), syncState: 'UPLOADING' }));
  const out = M.applyAcks(batch, [
    { clientId: batch[0].scanId, status: 'ACCEPTED', result: 'GREEN' },
    { clientId: batch[1].scanId, status: 'REJECTED', reason: 'unreadable' },
  ]);
  assert.equal(out[0].code, null);
  assert.equal(out[0].codeHint, batch[0].code.slice(-4));
  assert.equal(out[1].code, batch[1].code, 'FAILED keeps it for "Retry failed"');
  assert.equal(out[2].code, batch[2].code, 'not acknowledged: still needed');
  assert.match(M.uploadProblem(out[0]), /no longer has its ticket code/);
  const q = M.applyEvidenceAcks([batch[2]], [{ clientId: batch[2].scanId, status: 'QUARANTINED' }]);
  assert.equal(q[0].code, null);
});

test('canonical text for signing covers id, sequence, event, code, direction, gate, device time and verdict', () => {
  const r = record(9, { direction: 'EXIT', localResult: 'YELLOW' });
  const parts = M.canonicalScan(r).split('|');
  assert.deepEqual(parts, ['TL-SCAN-1', r.scanId, '9', 'event-1', r.code, 'EXIT', 'gate-a', 'Gate A', r.deviceScannedAt, 'YELLOW']);
  assert.equal(M.toUploadItem({ ...r, sig: 'abc' }).sig, 'abc');
});
