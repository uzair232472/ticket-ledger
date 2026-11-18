// The scanner's IndexedDB scan store (src/lib/gateScanStore.js) against an in-memory IndexedDB: records survive a
// reload, the old queue is backed up, copied and verified (and only removed once the server acknowledged a scan),
// interrupted uploads recover, failures are kept, signing, retention and concurrent recording.
// Needs the dev dependency fake-indexeddb (npm i -D fake-indexeddb@6.0.0 -w apps/web); skipped without it.
//   node --test tests/
import assert from 'node:assert/strict';
import test from 'node:test';

let fake = null;
try {
  fake = await import('fake-indexeddb');
} catch {
  /* not installed */
}
const skip = fake ? false : 'fake-indexeddb is not installed (npm i -D fake-indexeddb@6.0.0 -w apps/web)';

if (fake) {
  globalThis.indexedDB = new fake.IDBFactory();
  globalThis.IDBKeyRange = fake.IDBKeyRange;
  globalThis.IDBRequest = fake.IDBRequest;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}

// A fresh copy of the store module = the scanner page reloaded (its open database handle and caches are gone)
let reloads = 0;
const loadStore = () => import(`../src/lib/gateScanStore.js?reload=${++reloads}`);
const M = await import('../src/lib/gateScanModel.js');

/** Writes items into the previous scanner version's queue (tl-gate v1), as an old build left them. */
async function seedLegacyQueue(items) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('tl-gate', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('packs');
      d.createObjectStore('used');
      d.createObjectStore('queue', { keyPath: 'clientId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const t = db.transaction('queue', 'readwrite');
    items.forEach((i) => t.objectStore('queue').put(i));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  db.close();
}
const { legacyAll } = fake ? await import('../src/lib/gateOffline.js') : {};

const EVENT = 'event-store-1';
const legacy = (n) => ({ clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, eventId: EVENT, code: `TL-OLD0-${String(n).padStart(4, '0')}`, gate: 'Gate A', direction: 'ENTRY', scannedAt: new Date(Date.UTC(2026, 10, 18, 17, 0, n)).toISOString(), localResult: 'GREEN', localReason: 'Entry allowed' });
const input = (n, extra = {}) => ({ eventId: EVENT, code: `TL-NEW0-${String(n).padStart(4, '0')}`, gate: 'Gate A', gateId: 'gate-a', direction: 'ENTRY', localResult: 'GREEN', localReason: 'Entry allowed', recordedBy: 'u1', ...extra });

test('migration: the old queue is backed up, copied and verified; nothing is deleted until the server acknowledges', { skip }, async () => {
  const old = [legacy(1), legacy(2), legacy(3)];
  await seedLegacyQueue(old);
  const S = await loadStore();
  const info = await S.initScanStore();
  assert.deepEqual([info.migration.imported, info.migration.verified], [3, true]);
  const dump = await S.exportScans(EVENT);
  assert.equal(dump.backups.length, 1);
  assert.equal(dump.backups[0].count, 3);
  assert.equal(dump.backups[0].checksum, await M.checksum(old));
  assert.deepEqual(dump.scans.map((r) => [r.scanId, r.migratedFrom, r.syncState]), old.map((q) => [q.clientId, 'queue-v1', 'PENDING']));
  assert.equal((await legacyAll()).length, 3, 'the old queue is untouched');
  // A second start does not copy them again
  const again = await (await loadStore()).initScanStore();
  assert.equal(again.migration.imported, 0);
  // Acknowledged scans leave the old queue; the others stay there (a rolled-back scanner still uploads them)
  const S2 = await loadStore();
  const batch = await S2.takeForUpload(EVENT, 2);
  await S2.applySyncResults(batch, batch.map((r) => ({ clientId: r.scanId, status: 'ACCEPTED', result: 'GREEN' })));
  assert.deepEqual((await legacyAll()).map((q) => q.clientId), [old[2].clientId]);
});

test('records survive a reload; every scan gets the next sequence number, also from two tabs at once', { skip }, async () => {
  const A = await loadStore();
  const B = await loadStore(); // a second tab
  const made = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? A : B).recordScan(input(i))));
  const seqs = made.map((r) => r.seq);
  assert.equal(new Set(seqs).size, 40, 'no sequence number used twice');
  const after = await (await loadStore()).listScans(EVENT, { limit: 500 });
  for (const r of made) assert.ok(after.some((x) => x.scanId === r.scanId), 'still there after a reload');
  assert.ok((await legacyAll()).some((q) => q.clientId === made[0].scanId), 'unprocessed scans are mirrored for rollback');
  const dupe = await A.recordScan({ ...input(99), scanId: made[0].scanId });
  assert.equal(dupe.seq, made[0].seq, 'the same scan id saved twice keeps the first record');
});

test('an upload cut off by a reload goes back to PENDING and is sent again', { skip }, async () => {
  const S = await loadStore();
  const claimed = await S.takeForUpload(EVENT, 5);
  assert.ok(claimed.length && claimed.every((r) => r.syncState === 'UPLOADING'));
  const fresh = await loadStore(); // page reloaded mid-upload
  const recovered = await fresh.withUploadLock(() => fresh.recoverInterrupted(EVENT));
  assert.equal(recovered, claimed.length);
  const rows = await fresh.listScans(EVENT, { limit: 500 });
  for (const c of claimed) {
    const r = rows.find((x) => x.scanId === c.scanId);
    assert.equal(r.syncState, 'PENDING');
    assert.match(r.lastError, /interrupted/);
  }
});

test('failed uploads are kept with the reason; "Retry failed" puts them back; unreadable records never block the queue', { skip }, async () => {
  const S = await loadStore();
  const bad = await S.recordScan(input(200, { code: 'ab' }));
  const batch = await S.takeForUpload(EVENT, 500);
  assert.ok(!batch.some((r) => r.scanId === bad.scanId), 'not sent');
  let rows = await S.listScans(EVENT, { limit: 500 });
  assert.equal(rows.find((r) => r.scanId === bad.scanId).syncState, 'FAILED');
  await S.releaseBatch(batch, { state: 'FAILED', message: 'The server refused the upload (400)' });
  rows = await S.listScans(EVENT, { limit: 500 });
  assert.ok(batch.every((b) => rows.find((r) => r.scanId === b.scanId).lastError === 'The server refused the upload (400)'));
  const n = await S.retryFailed(EVENT);
  assert.ok(n >= batch.length);
  assert.equal((await S.scanCounts(EVENT)).FAILED, 0);
});

test('records are signed when made; the stored signature verifies against the canonical text', { skip }, async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const sign = async (text) => Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(text))).toString('base64url');
  const S = await loadStore();
  const r = await S.recordScan(input(300), { sign });
  assert.ok(r.sig);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(r.sig, 'base64url'), new TextEncoder().encode(M.canonicalScan(r)));
  assert.equal(ok, true);
  const unsigned = await S.recordScan(input(301), { sign: async () => { throw new Error('no key'); } });
  assert.equal(unsigned.sig, undefined, 'a signing failure still saves the scan');
});

test('acknowledged scans lose their ticket code; only old SYNCED records are pruned', { skip }, async () => {
  const S = await loadStore();
  const batch = await S.takeForUpload(EVENT, 3);
  await S.applySyncResults(batch, batch.map((r, i) => ({ clientId: r.scanId, status: 'ACCEPTED', result: 'GREEN', conflict: i === 2 })));
  const rows = await S.listScans(EVENT, { limit: 500 });
  for (const b of batch) assert.equal(rows.find((r) => r.scanId === b.scanId).code, null);
  const later = Date.now() + M.SYNCED_RETENTION_MS + 86400000;
  const pruned = await S.pruneSynced(later);
  assert.ok(pruned >= 2);
  const left = await S.listScans(EVENT, { limit: 500 });
  assert.ok(left.some((r) => r.syncState === 'CONFLICT'), 'conflicts are never pruned');
  assert.ok(left.every((r) => r.syncState !== 'SYNCED' || Date.parse(r.syncedAt) > later - M.SYNCED_RETENTION_MS));
});

test('evidence hand-in: unprocessed scans become QUARANTINED and leave the old queue', { skip }, async () => {
  const S = await loadStore();
  const batch = await S.takeForEvidence(EVENT, 500);
  assert.ok(batch.length > 0);
  const out = await S.applyEvidenceResults(batch, batch.map((r) => ({ clientId: r.scanId, status: 'QUARANTINED' })));
  assert.equal(out.quarantined, batch.length);
  const c = await S.scanCounts(EVENT);
  assert.deepEqual([c.PENDING, c.FAILED, c.UPLOADING], [0, 0, 0]);
  const mirror = (await legacyAll()).map((q) => q.clientId);
  assert.ok(batch.every((b) => !mirror.includes(b.scanId)));
});
