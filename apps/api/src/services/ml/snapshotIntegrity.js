/**
 * Is a prediction's snapshot exact? Database triggers log every change to an event's model inputs (event
 * details, tier prices and quantities, gates) in the same transaction as the change (MlInputChange). Since
 * migration 20261123120000_ml_input_changes_commit_time they run at COMMIT, so a change is logged at the
 * moment it becomes visible, even when its transaction was long.
 *
 * The prediction logger reads the inputs FIRST, then, in one REPEATABLE READ transaction, calls
 * checkSnapshots() and writes the rows (shadow.js). A snapshot is exact only if:
 *   1. the commit-time change log is installed (otherwise nothing can be guaranteed);
 *   2. the predicted event's inputs did not change since the prediction's reference moment (`windowStart`:
 *      the request time, the start of a visit, the sales-open time);
 *   3. nothing behind the typical price (`referenceAt`) changed since then: its events' prices or details,
 *      or the organizer company / account that decides whether an event is real (the old values are not
 *      recorded, so a point-in-time typical price cannot be rebuilt; the row is left out).
 * Why this is safe under concurrency: a change that the reads could see was committed before the reads, so
 * its log row (same transaction, written at commit) is visible to the later check; a change committed after
 * the check cannot have affected values read before it. CHANGE_MARGIN_MS absorbs clock differences.
 *
 * If the check cannot run, every snapshot is marked not exact.
 */
export const CHANGE_MARGIN_MS = 2 * 60_000;
export const INTEGRITY_VERSION = 2;
const ML_TRIGGERS = ['ml_event_input_change', 'ml_tier_input_insert_delete', 'ml_tier_input_update', 'ml_gate_input_insert_delete', 'ml_gate_input_update'];
const REFERENCE_SOURCES = ['TicketTier', 'Event'];

/** Are all the change-log triggers deferred to commit time? */
export async function commitTimeLogInstalled(db) {
  const rows = await db.$queryRaw`SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = ANY(${ML_TRIGGERS}) AND NOT tgisinternal`;
  return rows.length === ML_TRIGGERS.length && rows.every((r) => r.tgdeferrable && r.tginitdeferred);
}

/**
 * items: [{ eventId, windowStart: Date, referenceAt?: Date|null }]; reference(at) -> { eventIds: Set, companyIds,
 * ownerIds } behind the typical price at `at`. Returns [{ exact, reason?, ... }] in the same order.
 */
export async function checkSnapshots(db, items, { reference = null } = {}) {
  const checkedAt = new Date();
  const base = { version: INTEGRITY_VERSION, checked_at: checkedAt.toISOString() };
  const fail = (reason) => items.map(() => ({ ...base, exact: false, reason, changes: 0, sources: [] }));
  if (!items.length) return [];
  let rows;
  try {
    if (!(await commitTimeLogInstalled(db))) return fail('commit-time change log not installed (migration 20261123120000_ml_input_changes_commit_time)');
    const starts = items.flatMap((it) => [it.windowStart, it.referenceAt]).filter(Boolean).map((d) => d.getTime());
    if (!starts.length) return fail('no reference moment to check against');
    rows = await db.mlInputChange.findMany({
      where: { changedAt: { gt: new Date(Math.min(...starts) - CHANGE_MARGIN_MS) } },
      select: { eventId: true, source: true, changedAt: true },
    });
  } catch (e) {
    return fail(`integrity check unavailable: ${e.message.split('\n')[0].slice(0, 120)}`);
  }
  const out = [];
  for (const it of items) {
    if (!it.eventId || !it.windowStart) { out.push({ ...base, exact: false, reason: 'no event or reference moment to check against', changes: 0, sources: [] }); continue; }
    const own = rows.filter((r) => r.eventId === it.eventId && r.changedAt.getTime() > it.windowStart.getTime() - CHANGE_MARGIN_MS);
    let ref = [];
    let accounts = 0;
    if (it.referenceAt) {
      if (!reference) { out.push({ ...base, exact: false, reason: 'typical-price inputs could not be checked', changes: 0, sources: [] }); continue; }
      const r = await reference(it.referenceAt);
      const since = new Date(it.referenceAt.getTime() - CHANGE_MARGIN_MS);
      ref = rows.filter((x) => r.eventIds.has(x.eventId) && REFERENCE_SOURCES.includes(x.source) && x.changedAt > since);
      // Whether an event counts as real depends on its organizer's company and account: any update since
      // the reference moment (not logged with old values) means the classification then cannot be proven
      try {
        const [companies, owners] = await Promise.all([
          r.companyIds.length ? db.company.count({ where: { id: { in: r.companyIds }, updatedAt: { gt: since } } }) : 0,
          r.ownerIds.length ? db.user.count({ where: { id: { in: r.ownerIds }, updatedAt: { gt: since } } }) : 0,
        ]);
        accounts = companies + owners;
      } catch (e) {
        out.push({ ...base, exact: false, reason: `typical-price organizers could not be checked: ${e.message.split(String.fromCharCode(10))[0].slice(0, 80)}`, changes: 0, sources: [] });
        continue;
      }
    }
    const reasons = [];
    if (own.length) reasons.push(`inputs changed after the prediction moment (${[...new Set(own.map((h) => h.source))].join(', ')})`);
    if (ref.length) reasons.push(`typical-price inputs changed after the prediction moment (${new Set(ref.map((h) => h.eventId)).size} event(s))`);
    if (accounts) reasons.push(`typical-price inputs changed after the prediction moment (${accounts} organizer company/account update(s))`);
    out.push({
      ...base, exact: reasons.length === 0, ...(reasons.length ? { reason: reasons.join('; ') } : {}),
      window_start: it.windowStart.toISOString(), reference_at: it.referenceAt ? it.referenceAt.toISOString() : null,
      changes: own.length, reference_changes: ref.length, reference_account_changes: accounts, sources: [...new Set(own.map((h) => h.source))],
    });
  }
  return out;
}

/** Latest logged input change anywhere (for cache invalidation), or null. */
export async function latestInputChange(db) {
  try {
    const r = await db.mlInputChange.findFirst({ orderBy: { changedAt: 'desc' }, select: { changedAt: true } });
    return r?.changedAt ?? null;
  } catch {
    return null;
  }
}
