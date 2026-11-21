/**
 * Is a prediction's snapshot exact? Database triggers log every change to an event's model inputs (event
 * details, tier prices and quantities, gates) in the same transaction as the change (MlInputChange).
 *
 * The prediction logger calls checkSnapshots() AFTER the inputs were read and right before the row is
 * written. A change to that event since the prediction's reference moment (`windowStart`: the request time,
 * the start of a visit, the sales-open time) means the values read may not be the ones that held at that
 * moment, so the snapshot is marked exact: false and training leaves it out. A change committed after the
 * check cannot have affected values already read. CHANGE_MARGIN_MS covers a change whose transaction
 * started shortly before the window but committed inside it.
 *
 * If the check cannot run (e.g. the migration is not applied), every snapshot is marked not exact.
 */
export const CHANGE_MARGIN_MS = 2 * 60_000;

/** items: [{ eventId, windowStart: Date }] -> [{ exact, reason?, changes, sources }] in the same order. */
export async function checkSnapshots(db, items) {
  const relevant = items.filter((it) => it.eventId && it.windowStart);
  const checkedAt = new Date();
  if (!relevant.length) return items.map(() => ({ exact: false, reason: 'no event or reference moment to check against', checked_at: checkedAt.toISOString(), changes: 0, sources: [] }));
  const since = new Date(Math.min(...relevant.map((it) => it.windowStart.getTime())) - CHANGE_MARGIN_MS);
  let rows;
  try {
    rows = await db.mlInputChange.findMany({
      where: { eventId: { in: [...new Set(relevant.map((it) => it.eventId))] }, changedAt: { gt: since } },
      select: { eventId: true, source: true, changedAt: true },
    });
  } catch (e) {
    return items.map(() => ({ exact: false, reason: `integrity check unavailable: ${e.message.split('\n')[0].slice(0, 120)}`, checked_at: checkedAt.toISOString(), changes: 0, sources: [] }));
  }
  return items.map((it) => {
    if (!it.eventId || !it.windowStart) return { exact: false, reason: 'no event or reference moment to check against', checked_at: checkedAt.toISOString(), changes: 0, sources: [] };
    const from = it.windowStart.getTime() - CHANGE_MARGIN_MS;
    const hits = rows.filter((r) => r.eventId === it.eventId && r.changedAt.getTime() > from);
    return {
      exact: hits.length === 0,
      ...(hits.length ? { reason: `inputs changed after the prediction moment (${[...new Set(hits.map((h) => h.source))].join(', ')})` } : {}),
      checked_at: checkedAt.toISOString(),
      window_start: it.windowStart.toISOString(),
      changes: hits.length,
      sources: [...new Set(hits.map((h) => h.source))],
    };
  });
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
