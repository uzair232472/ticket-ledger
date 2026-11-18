/**
 * Durable record of every scan decided on this device (IndexedDB `tl-gate-scans`). Rules: gateScanModel.js.
 *
 *   scans    one record per scan (keyPath scanId; indexes eventId, [eventId, syncState], seq (unique))
 *   meta     'seq' (this device's last sequence number), 'migration:last' (result of the queue migration)
 *   backups  snapshots of the old queue taken before its scans were copied here
 *
 * Writes use strict durability where the browser supports it (flushed to disk before success), so a record that
 * exists when the verdict is shown survives a crash or a device restart.
 *
 * Migration from the old queue (tl-gate / queue, version 1) runs every time the store opens: legacy items not yet
 * here are snapshotted into `backups` and copied into `scans` in ONE transaction, then read back and compared with
 * the snapshot (checksum + every field). Nothing is deleted by the migration. A legacy item is removed only after
 * the server acknowledged its scan. While a scan is unprocessed its legacy mirror stays, so an older scanner build
 * (rollback) still uploads it.
 */
import * as M from './gateScanModel';
import { deviceId as getDeviceId, legacyAll, legacyDelete, legacyPut } from './gateOffline';

const DB_NAME = 'tl-gate-scans';
const DB_VERSION = 1;
const APP_VERSION = import.meta.env?.VITE_APP_VERSION || 'web-dev';
const STRICT = { durability: 'strict' };

let dbPromise = null;
function openScanDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const scans = db.createObjectStore('scans', { keyPath: 'scanId' });
        scans.createIndex('eventId', 'eventId');
        scans.createIndex('eventState', ['eventId', 'syncState']);
        scans.createIndex('seq', 'seq', { unique: true });
        db.createObjectStore('meta');
        db.createObjectStore('backups', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The scan database is blocked by another tab. Close other scanner tabs.'));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

const asPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Runs fn(stores, t) in one transaction; resolves with fn's value once the transaction has committed. */
async function inTx(names, mode, fn) {
  const db = await openScanDb();
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = db.transaction(names, mode, mode === 'readwrite' ? STRICT : undefined);
    } catch {
      t = db.transaction(names, mode); // browsers without the durability option
    }
    const stores = Object.fromEntries([names].flat().map((n) => [n, t.objectStore(n)]));
    let value;
    Promise.resolve(fn(stores, t)).then((v) => { value = v; }, (err) => { try { t.abort(); } catch { /* already done */ } reject(err); });
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

/** The last sequence number used: the counter, or the highest recorded one if the counter was ever lost. */
async function lastSeq(scans, meta) {
  const counter = (await asPromise(meta.get('seq'))) || 0;
  const top = await asPromise(scans.index('seq').openCursor(null, 'prev'));
  return Math.max(counter, top?.value?.seq || 0);
}

const allInState = (scans, eventId, state) => asPromise(scans.index('eventState').getAll(IDBKeyRange.only([eventId, state])));
const bySeq = (a, b) => a.seq - b.seq;
const mirror = (records) => Promise.all(records.map((r) => legacyPut(M.toLegacyItem(r)).catch((err) => console.warn('[gate] legacy mirror write failed', err))));

// One upload at a time across tabs (Web Locks), and within this tab
let uploadingHere = false;
export async function withUploadLock(fn) {
  if (uploadingHere) return { skipped: true };
  uploadingHere = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request('tl-gate-upload', { ifAvailable: true }, async (lock) => (lock ? fn() : { skipped: true }));
    }
    return await fn();
  } finally {
    uploadingHere = false;
  }
}

// ---------- Opening: migration and housekeeping ----------

/** Copies the old queue's scans here (see the header). Returns { imported, verified, problems, backupId }. */
export async function migrateLegacyQueue() {
  const legacy = await legacyAll();
  if (!legacy.length) return { imported: 0, verified: true };
  const existing = await inTx('scans', 'readonly', ({ scans }) => asPromise(scans.getAllKeys()));
  const todo = M.planMigration(legacy, existing);
  if (!todo.length) return { imported: 0, verified: true };

  const deviceId = getDeviceId();
  const sum = await M.checksum(todo);
  const backupId = `queue-v1-${new Date().toISOString()}-${M.newScanId().slice(0, 8)}`;
  await inTx(['scans', 'meta', 'backups'], 'readwrite', async ({ scans, meta, backups }) => {
    backups.put({ id: backupId, createdAt: new Date().toISOString(), source: 'tl-gate/queue', count: todo.length, checksum: sum, items: todo });
    let seq = await lastSeq(scans, meta);
    for (const item of todo) {
      seq += 1;
      scans.add(M.fromLegacyItem(item, { seq, deviceId, appVersion: APP_VERSION }));
    }
    meta.put(seq, 'seq');
  });

  // Read back what was written and compare it with the snapshot before anything relies on it
  const { backup, records } = await inTx(['scans', 'backups'], 'readonly', async ({ scans, backups }) => ({
    backup: await asPromise(backups.get(backupId)),
    records: await Promise.all(todo.map((q) => asPromise(scans.get(q.clientId)))),
  }));
  const check = M.verifyMigration(todo, records);
  const backupOk = Boolean(backup) && backup.count === todo.length && (await M.checksum(backup.items)) === sum;
  const out = { imported: todo.length, verified: check.ok && backupOk, problems: { ...check, backupOk }, backupId, at: new Date().toISOString() };
  await inTx('meta', 'readwrite', ({ meta }) => meta.put(out, 'migration:last'));
  if (!out.verified) console.error('[gate] offline queue migration could not be verified; the old queue is left untouched', out);
  return out;
}

/** Removes SYNCED records older than the retention period (never anything unprocessed or in conflict). */
export async function pruneSynced(now = Date.now()) {
  return inTx('scans', 'readwrite', async ({ scans }) => {
    const all = await asPromise(scans.getAll());
    const old = all.filter((r) => M.shouldPrune(r, now));
    old.forEach((r) => scans.delete(r.scanId));
    return old.length;
  });
}

let ready = null;
/** Opens the store once per page: migration, then housekeeping. Asks the browser to keep the storage. */
export function initScanStore() {
  if (!ready) {
    ready = (async () => {
      const persisted = await (navigator.storage?.persist?.() ?? Promise.resolve(false)).catch(() => false);
      // A migration problem must not stop new scans from being recorded: the old queue stays untouched and the
      // scanner shows a warning
      const migration = await migrateLegacyQueue().catch((err) => {
        console.error('[gate] offline queue migration failed; the old queue is left untouched', err);
        return { imported: 0, verified: false, error: err.message || String(err) };
      });
      const pruned = await pruneSynced().catch(() => 0);
      return { persisted, migration, pruned };
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// ---------- Recording ----------

/**
 * Saves a scan before its verdict is shown. Returns the record. Throws if the device could not store it (the
 * scanner must then not admit on that verdict).
 */
export async function recordScan(input) {
  await initScanStore();
  const deviceId = getDeviceId();
  const record = await inTx(['scans', 'meta'], 'readwrite', async ({ scans, meta }) => {
    if (input.scanId) {
      const dup = await asPromise(scans.get(input.scanId));
      if (dup) return dup; // the same scan saved twice (retry): keep the first record
    }
    const seq = (await lastSeq(scans, meta)) + 1;
    meta.put(seq, 'seq');
    const r = M.newScanRecord({ ...input, seq, deviceId, appVersion: APP_VERSION });
    scans.add(r);
    return r;
  });
  if (record.syncState === 'PENDING') await mirror([record]);
  return record;
}

// ---------- Reading ----------

export async function listScans(eventId, { limit = 100 } = {}) {
  await initScanStore();
  const all = await inTx('scans', 'readonly', ({ scans }) => asPromise(scans.index('eventId').getAll(IDBKeyRange.only(eventId))));
  return all.sort((a, b) => b.seq - a.seq).slice(0, limit);
}

export async function scanCounts(eventId) {
  await initScanStore();
  const all = await inTx('scans', 'readonly', ({ scans }) => asPromise(scans.index('eventId').getAll(IDBKeyRange.only(eventId))));
  return M.countStates(all);
}

/** Everything this device holds for the event (or all events), for a supervisor or support: a JSON file. */
export async function exportScans(eventId) {
  await initScanStore();
  const { scans, backups, migration, seq } = await inTx(['scans', 'backups', 'meta'], 'readonly', async (s) => ({
    scans: await asPromise(eventId ? s.scans.index('eventId').getAll(IDBKeyRange.only(eventId)) : s.scans.getAll()),
    backups: await asPromise(s.backups.getAll()),
    migration: await asPromise(s.meta.get('migration:last')),
    seq: await asPromise(s.meta.get('seq')),
  }));
  return { exportedAt: new Date().toISOString(), deviceId: getDeviceId(), appVersion: APP_VERSION, eventId: eventId || null, lastSeq: seq || 0, counts: M.countStates(scans), migration: migration || null, scans: scans.sort(bySeq), backups };
}

// ---------- Uploading (call these while holding withUploadLock) ----------

/** Records left UPLOADING by a closed page or a lost connection go back to PENDING. */
export async function recoverInterrupted(eventId) {
  return inTx('scans', 'readwrite', async ({ scans }) => {
    const stuck = await allInState(scans, eventId, 'UPLOADING');
    stuck.forEach((r) => scans.put(M.recoverInterrupted(r)));
    return stuck.length;
  });
}

/**
 * Claims the next batch of PENDING scans (oldest sequence first) as UPLOADING. A record that can't be uploaded as
 * it is becomes FAILED with the reason instead of blocking the queue.
 */
export async function takeForUpload(eventId, limit = M.BATCH_SIZE) {
  return inTx('scans', 'readwrite', async ({ scans }) => {
    const pending = (await allInState(scans, eventId, 'PENDING')).sort(bySeq);
    const batch = [];
    const now = new Date().toISOString();
    for (const r of pending) {
      if (batch.length >= limit) break;
      const problem = M.uploadProblem(r);
      if (problem) {
        scans.put({ ...r, syncState: 'FAILED', lastError: problem, lastAttemptAt: now });
        continue;
      }
      const claimed = { ...r, syncState: 'UPLOADING', attempts: (r.attempts || 0) + 1, lastAttemptAt: now };
      scans.put(claimed);
      batch.push(claimed);
    }
    return batch;
  });
}

/** Stores the server's per-scan acknowledgements; acknowledged scans leave the old queue mirror. */
export async function applySyncResults(batch, results) {
  const updated = M.applyAcks(batch, results);
  await inTx('scans', 'readwrite', ({ scans }) => updated.forEach((r) => scans.put(r)));
  const done = updated.filter((r) => r.syncState === 'SYNCED' || r.syncState === 'CONFLICT');
  await legacyDelete(done.map((r) => r.scanId)).catch((err) => console.warn('[gate] legacy mirror cleanup failed', err));
  return { synced: done.length, conflicts: updated.filter((r) => r.syncState === 'CONFLICT').length, rejected: updated.filter((r) => r.syncState === 'FAILED').length, unacknowledged: updated.filter((r) => r.syncState === 'PENDING').length };
}

/** The upload request failed: the batch goes back to PENDING (retry) or FAILED, with the reason. */
export async function releaseBatch(batch, { state, message }) {
  await inTx('scans', 'readwrite', ({ scans }) => batch.forEach((r) => scans.put({ ...r, syncState: state, lastError: message })));
}

/**
 * A revoked device (or staff who lost the event): claims every scan the server hasn't processed (PENDING, FAILED,
 * interrupted) to hand in as evidence.
 */
export async function takeForEvidence(eventId, limit = M.BATCH_SIZE) {
  return inTx('scans', 'readwrite', async ({ scans }) => {
    const open = (await Promise.all(['PENDING', 'FAILED', 'UPLOADING'].map((st) => allInState(scans, eventId, st)))).flat().sort(bySeq).slice(0, limit);
    const now = new Date().toISOString();
    return open.map((r) => {
      const claimed = { ...r, syncState: 'UPLOADING', attempts: (r.attempts || 0) + 1, lastAttemptAt: now };
      scans.put(claimed);
      return claimed;
    });
  });
}

/** Stores the evidence acknowledgements; quarantined scans leave the old queue mirror (the server holds them). */
export async function applyEvidenceResults(batch, results) {
  const updated = M.applyEvidenceAcks(batch, results);
  await inTx('scans', 'readwrite', ({ scans }) => updated.forEach((r) => scans.put(r)));
  const done = updated.filter((r) => r.syncState === 'QUARANTINED');
  await legacyDelete(done.map((r) => r.scanId)).catch((err) => console.warn('[gate] legacy mirror cleanup failed', err));
  return { quarantined: done.length, unacknowledged: updated.length - done.length };
}

/** "Retry failed": FAILED scans of the event go back to PENDING. */
export async function retryFailed(eventId) {
  return inTx('scans', 'readwrite', async ({ scans }) => {
    const failed = await allInState(scans, eventId, 'FAILED');
    failed.forEach((r) => scans.put({ ...r, syncState: 'PENDING', lastError: null }));
    return failed.length;
  });
}

/** Diagnostics for the event's scans on this device (see gateScanModel.scanDiagnostics). */
export async function scanDiagnostics(eventId) {
  await initScanStore();
  const all = await inTx('scans', 'readonly', ({ scans }) => asPromise(scans.index('eventId').getAll(IDBKeyRange.only(eventId))));
  return M.scanDiagnostics(all);
}

export { APP_VERSION };
