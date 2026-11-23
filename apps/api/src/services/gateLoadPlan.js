/**
 * Gate load plan (before and during an event). RULES, no model: it tells gate managers which gate will be
 * busiest, by how much it is over capacity, and which seating sections to send to which gate so that no gate
 * is overloaded. It never changes admission: a ticket is admitted at any gate its ticket type allows.
 *
 * Inputs (all recorded, nothing invented):
 *   - live tickets per ticket type and seating section (who is coming, and where they sit),
 *   - the expected show rate (attendanceBaseline.showRate: past check-ins, else a fixed rule),
 *   - the arrival curve of past events (crowd.arrivalHistory: share of entries per 5 minutes around the start),
 *   - each active entry gate: capacity per hour and the ticket types it accepts (empty = all).
 *
 * Without a plan, people holding a ticket type that several gates accept spread evenly over those gates
 * ("as things are"). The balanced plan gives every section ONE gate, largest sections first, always to the
 * eligible gate that ends up least full (a greedy makespan rule), so signs, tickets and messages can say
 * "Section B: use Gate C". On the event day the live view adds real entries per gate in the last 15 minutes.
 */
import prisma from '../config/prisma.js';
import { showRate } from './ml/attendanceBaseline.js';
import { arrivalHistory, SLOTS } from './ml/crowd.js';
import { startOf } from './ml/features.js';

const MIN = 60_000;
const LIVE_TICKETS = ['ACTIVE', 'SCANNED'];
export const BUSY = 0.85; // above 85% of capacity at the peak hour: busy
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

/** Largest share of arrivals in any 60 minutes (12 consecutive 5-minute slots) of the arrival curve. */
export function peakHourShare(curve) {
  let best = 0;
  for (let i = 0; i + 12 <= curve.length; i += 1) best = Math.max(best, curve.slice(i, i + 12).reduce((a, b) => a + b, 0));
  return best;
}

/** Minutes the last person in the peak hour waits when arrivals exceed capacity (queue builds for one hour). */
export const waitMinutes = (peakPerHour, capacityPerHour) => (peakPerHour > capacityPerHour ? round(((peakPerHour - capacityPerHour) / capacityPerHour) * 60) : 0);

const status = (u) => (u > 1 ? 'OVERLOADED' : u >= BUSY ? 'BUSY' : 'OK');

/** Max flow (Edmonds-Karp) on a small dense graph of real capacities. Returns the flow matrix. */
function maxFlow(cap, s, t) {
  const n = cap.length;
  const flow = cap.map((r) => r.map(() => 0));
  for (;;) {
    const prev = new Array(n).fill(-1);
    prev[s] = s;
    const q = [s];
    while (q.length && prev[t] === -1) {
      const u = q.shift();
      for (let v = 0; v < n; v += 1) if (prev[v] === -1 && cap[u][v] - flow[u][v] > 1e-9) { prev[v] = u; q.push(v); }
    }
    if (prev[t] === -1) return flow;
    let push = Infinity;
    for (let v = t; v !== s; v = prev[v]) push = Math.min(push, cap[prev[v]][v] - flow[prev[v]][v]);
    for (let v = t; v !== s; v = prev[v]) { flow[prev[v]][v] += push; flow[v][prev[v]] -= push; }
  }
}

/** Natural order of seat rows (A, B, …, Z, AA; 1, 2, 10). */
const rowOrder = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const rowRange = (rows) => (rows.length === 1 ? `row ${rows[0]}` : `rows ${rows[0]}–${rows.at(-1)}`);

/**
 * Pure core (tested without a database).
 * groups: [{ key, tierId, tierName, section, tickets, expected, rows?: [{ row, tickets }] }]
 * gates: [{ id, name, capacityPerHour, allowedTierIds }]; peakShare: share of attendees arriving in the busiest hour.
 *
 * Balanced plan: the split of every section over the gates its ticket type may use that makes the fullest gate
 * as empty as possible (binary search on the utilisation + max flow). A section that has to be split is split
 * by seat rows, so the plan can be printed and announced: "Section North rows A–M: Gate A".
 */
export function planGates(groups, gates, peakShare) {
  const eligible = (g) => gates.filter((x) => !x.allowedTierIds?.length || x.allowedTierIds.includes(g.tierId));
  const blank = () => Object.fromEntries(gates.map((x) => [x.id, 0]));

  // As things are: each section spreads evenly over the gates its ticket type may use
  const natural = blank();
  const noGate = groups.filter((g) => !eligible(g).length);
  const placeable = groups.filter((g) => eligible(g).length && g.expected > 0);
  for (const g of placeable) { const el = eligible(g); for (const x of el) natural[x.id] += g.expected / el.length; }

  // Balanced: smallest possible "fullest gate", found by binary search with a max-flow feasibility check
  const G = placeable.length;
  const K = gates.length;
  const S = 0;
  const T = 1 + G + K;
  const total = placeable.reduce((a, g) => a + g.expected, 0);
  const network = (u) => {
    const cap = Array.from({ length: T + 1 }, () => new Array(T + 1).fill(0));
    placeable.forEach((g, i) => {
      cap[S][1 + i] = g.expected;
      for (const x of eligible(g)) cap[1 + i][1 + G + gates.indexOf(x)] = total + 1;
    });
    gates.forEach((x, j) => { cap[1 + G + j][T] = (u * x.capacityPerHour) / Math.max(peakShare, 1e-9); });
    return cap;
  };
  const moved = (flow) => flow[S].reduce((a, f) => a + Math.max(0, f), 0);
  let lo = 0;
  let hi = Math.max(1, ...gates.map(() => (total * peakShare) / Math.min(...gates.map((x) => x.capacityPerHour))));
  let best = null;
  if (G) {
    for (let it = 0; it < 40; it += 1) {
      const mid = (lo + hi) / 2;
      const f = maxFlow(network(mid), S, T);
      if (moved(f) >= total - 1e-6) { hi = mid; best = f; } else lo = mid;
    }
    if (!best) best = maxFlow(network(hi), S, T);
  }

  const balanced = blank();
  const assignment = [];
  placeable.forEach((g, i) => {
    const shares = gates.map((x, j) => ({ gate: x, people: best ? Math.max(0, best[1 + i][1 + G + j]) : 0 })).filter((p) => p.people > 0.5);
    for (const p of shares) balanced[p.gate.id] += p.people;
    const choices = eligible(g).length;
    if (shares.length <= 1) {
      const gate = shares[0]?.gate || eligible(g)[0];
      assignment.push({ ...g, gateId: gate.id, gateName: gate.name, rowsText: 'all rows', rowList: null, share: 1, people: g.expected, alternatives: choices });
      return;
    }
    // Split by seat rows in order, each gate taking about its share of the section's tickets
    const rows = (g.rows?.length ? [...g.rows] : [{ row: 'all', tickets: g.tickets }]).sort((a, b) => rowOrder(a.row, b.row));
    let r = 0;
    shares.forEach((p, k) => {
      const want = (p.people / g.expected) * g.tickets;
      const take = [];
      let got = 0;
      while (r < rows.length && (k === shares.length - 1 || got + rows[r].tickets / 2 <= want || !take.length)) { take.push(rows[r]); got += rows[r].tickets; r += 1; }
      if (!take.length) return;
      assignment.push({ ...g, gateId: p.gate.id, gateName: p.gate.name, rowsText: rowRange(take.map((x) => x.row)), rowList: take.map((x) => x.row), share: got / g.tickets, people: p.people, alternatives: choices });
    });
  });

  const describe = (load) => gates.map((x) => {
    const peak = load[x.id] * peakShare;
    const u = x.capacityPerHour ? peak / x.capacityPerHour : 0;
    return {
      gateId: x.id, name: x.name, capacityPerHour: x.capacityPerHour, expectedPeople: round(load[x.id]),
      peakPerHour: round(peak), utilisation: round(u, 3), status: status(u), waitMinutes: waitMinutes(peak, x.capacityPerHour),
    };
  });
  const before = describe(natural);
  const after = describe(balanced);

  // Sections that have a choice of gate: these are the ones the plan sends somewhere specific
  const moves = assignment.filter((a) => a.alternatives > 1);

  // What balancing cannot fix: the whole set of gates is too small, or one ticket type has only one gate
  const advice = [];
  for (const g of after.filter((x) => x.status === 'OVERLOADED')) {
    const stuck = assignment.filter((a) => a.gateId === g.gateId && a.alternatives === 1);
    const spare = after.filter((x) => x.utilisation < BUSY && x.gateId !== g.gateId).sort((p, q) => p.utilisation - q.utilisation)[0];
    const tiers = [...new Set(stuck.map((a) => a.tierName))];
    if (tiers.length && spare) advice.push({ gate: g.name, kind: 'ALLOW_TIER', text: `${g.name} is the only gate for ${tiers.join(', ')}. Allow ${tiers.join(', ')} at ${spare.name} (${Math.round(spare.utilisation * 100)}% full at peak) in Gates & re-entry, then refresh the plan.` });
    const extra = Math.ceil(g.peakPerHour - g.capacityPerHour);
    advice.push({ gate: g.name, kind: 'ADD_CAPACITY', text: `${g.name} still needs about ${extra.toLocaleString('en-US')} more entries per hour at its peak: open extra lanes or add scanning staff, then raise its capacity per hour.` });
  }
  for (const g of noGate) advice.push({ gate: null, kind: 'NO_GATE', text: `No active entry gate accepts ${g.tierName}: ${Math.round(g.expected)} expected people have no gate.` });

  return { before, after, assignment, moves, advice };
}

/** The plan for one event, plus the live picture when the event is under way. */
export async function gateLoadPlan(event, { now = new Date() } = {}) {
  const ev = await prisma.event.findUnique({
    where: { id: event.id },
    select: {
      id: true, name: true, type: true, city: true, date: true, time: true, startsAt: true,
      tiers: { select: { id: true, name: true } },
      gates: { where: { active: true, type: { not: 'EXIT' } }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, capacityPerHour: true, allowedTierIds: true } },
    },
  });
  const start = startOf(ev);
  const tierName = Object.fromEntries(ev.tiers.map((t) => [t.id, t.name]));
  const missingCapacity = ev.gates.filter((g) => !(g.capacityPerHour > 0)).map((g) => g.name);
  const base = {
    eventId: ev.id, eventStart: start, decision_source: 'rules',
    gates: ev.gates.map((g) => ({ id: g.id, name: g.name, capacityPerHour: g.capacityPerHour, allowedTiers: g.allowedTierIds.map((id) => tierName[id] || id) })),
  };
  if (!ev.gates.length) return { ...base, ready: false, reason: 'NO_ENTRY_GATES', message: 'Add at least one active entry gate in Gates & re-entry.' };
  if (missingCapacity.length) return { ...base, ready: false, reason: 'GATE_CAPACITY_MISSING', message: `Set a capacity per hour on ${missingCapacity.join(', ')} (Gates & re-entry). The plan never guesses a capacity.` };

  const tickets = await prisma.ticket.findMany({
    where: { eventId: ev.id, status: { in: LIVE_TICKETS } },
    select: { status: true, seat: { select: { tierId: true, section: true, row: true } } },
  });
  const [show, history] = await Promise.all([showRate({ type: ev.type, city: ev.city }, now), arrivalHistory(now)]);
  const curve = history(ev.type);
  const peakShare = peakHourShare(curve.curve);
  const rate = show.rate / 100;

  const map = new Map();
  for (const t of tickets) {
    const key = `${t.seat.tierId}|${t.seat.section}`;
    if (!map.has(key)) map.set(key, { key, tierId: t.seat.tierId, tierName: tierName[t.seat.tierId] || 'Ticket type', section: t.seat.section, tickets: 0, scanned: 0, byRow: {} });
    const g = map.get(key);
    g.tickets += 1;
    g.byRow[t.seat.row] = (g.byRow[t.seat.row] || 0) + 1;
    if (t.status === 'SCANNED') g.scanned += 1;
  }
  const groups = [...map.values()].map(({ byRow, ...g }) => ({ ...g, expected: g.tickets * rate, rows: Object.entries(byRow).map(([row, n]) => ({ row, tickets: n })) }));
  const plan = planGates(groups, ev.gates, peakShare);

  // Live: real entries per gate in the last 15 minutes, as an hourly rate, from 90 minutes before the start
  let live = null;
  const liveFrom = new Date(start.getTime() + SLOTS[0] * MIN);
  if (now >= liveFrom && now <= new Date(start.getTime() + 4 * 60 * MIN)) {
    const since = new Date(now.getTime() - 15 * MIN);
    const rows = await prisma.checkIn.groupBy({
      by: ['gateId'], _count: { _all: true },
      where: { eventId: ev.id, direction: 'ENTRY', result: 'GREEN', reentry: false, reversedAt: null, scannedAt: { gte: since, lte: now } },
    });
    const perGate = ev.gates.map((g) => {
      const n = rows.find((r) => r.gateId === g.id)?._count._all || 0;
      const perHour = n * 4;
      const u = perHour / g.capacityPerHour;
      return { gateId: g.id, name: g.name, entriesLast15: n, perHour, utilisation: round(u, 3), status: status(u) };
    });
    const divert = [];
    for (const g of perGate.filter((x) => x.status === 'OVERLOADED')) {
      const gate = ev.gates.find((x) => x.id === g.gateId);
      // Divert to the emptiest gate that accepts everything this gate accepts (so nobody is refused there)
      const to = perGate
        .filter((x) => x.gateId !== g.gateId && x.utilisation < BUSY)
        .filter((x) => { const t = ev.gates.find((y) => y.id === x.gateId); return !t.allowedTierIds.length || (gate.allowedTierIds.length && gate.allowedTierIds.every((id) => t.allowedTierIds.includes(id))); })
        .sort((p, q) => p.utilisation - q.utilisation)[0];
      const excess = Math.ceil(g.perHour - gate.capacityPerHour);
      divert.push(to
        ? { from: g.name, to: to.name, perHour: excess, text: `${g.name} is at ${Math.round(g.utilisation * 100)}%: direct about ${excess} people an hour to ${to.name} (${Math.round(to.utilisation * 100)}%).` }
        : { from: g.name, to: null, perHour: excess, text: `${g.name} is at ${Math.round(g.utilisation * 100)}% and no quieter gate accepts all its ticket types: open extra lanes at ${g.name}.` });
    }
    const scanned = tickets.filter((t) => t.status === 'SCANNED').length;
    live = { since, gates: perGate, divert, admitted: scanned, stillExpected: Math.max(0, Math.round(tickets.length * rate - scanned)) };
  }

  const ticketsBy = (gateId) => Math.round(plan.assignment.filter((a) => a.gateId === gateId).reduce((a, x) => a + (x.tickets - x.scanned) * x.share, 0));
  return {
    ...base,
    ready: true,
    tickets: tickets.length,
    expectedPeople: round(tickets.length * rate),
    showRate: { percent: show.rate, basis: show.basis, note: show.factors?.[0] || null },
    arrival: { peakHourShare: round(peakShare, 3), basis: curve.basis, pastEvents: curve.events, note: curve.events ? `Arrival curve from ${curve.events} past event(s) (${curve.basis === 'all' ? 'all types' : 'this type'}).` : 'No past events with gate scans yet: arrivals assumed even over the 90 minutes before to 60 minutes after the start.' },
    asThingsAre: plan.before,
    balanced: plan.after,
    sections: plan.assignment.map((a) => ({ tierId: a.tierId, tierName: a.tierName, section: a.section, rows: a.rowsText, rowList: a.rowList, tickets: Math.round(a.tickets * a.share), expected: round(a.people), gateId: a.gateId, gateName: a.gateName, choices: a.alternatives })),
    moves: plan.moves.map((m) => ({ tierName: m.tierName, section: m.section, rows: m.rowsText, expected: round(m.people), gateName: m.gateName })),
    advice: plan.advice,
    toNotify: ev.gates.map((g) => ({ gateId: g.id, name: g.name, ticketHolders: ticketsBy(g.id) })),
    live,
  };
}

/**
 * Tells every ticket holder who is not inside yet which gate to use (in-app + email). One message per person
 * per event per gate plan; people with tickets in several sections get each gate once.
 */
export async function notifyGatePlan(event, requesterUser, { dispatch, now = new Date() }) {
  const plan = await gateLoadPlan(event, { now });
  if (!plan.ready) throw Object.assign(new Error(plan.message), { status: 409 });
  // Gate per section, or per row when the plan splits a section by rows
  const gateOf = new Map();
  for (const sec of plan.sections) {
    if (!sec.rowList) gateOf.set(`${sec.tierId}|${sec.section}|*`, sec.gateName);
    else for (const row of sec.rowList) gateOf.set(`${sec.tierId}|${sec.section}|${row}`, sec.gateName);
  }
  const tickets = await prisma.ticket.findMany({
    where: { eventId: event.id, status: 'ACTIVE' },
    select: { userId: true, seat: { select: { tierId: true, section: true, row: true } } },
  });
  const byUser = new Map();
  for (const t of tickets) {
    const k = `${t.seat.tierId}|${t.seat.section}`;
    const g = gateOf.get(`${k}|${t.seat.row}`) || gateOf.get(`${k}|*`);
    if (!g) continue;
    if (!byUser.has(t.userId)) byUser.set(t.userId, new Map());
    const m = byUser.get(t.userId);
    m.set(g, [...(m.get(g) || []), t.seat.section]);
  }
  const startText = plan.eventStart.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' });
  let sent = 0;
  let failed = 0;
  for (const [userId, gates] of byUser) {
    const parts = [...gates].map(([gate, sections]) => `${[...new Set(sections)].join(', ')}: ${gate}`);
    try {
      await dispatch({
        userId, type: 'GATE_ADVICE',
        title: `Your entry gate for ${event.name}`,
        message: `To get in faster on ${startText}, please use ${parts.length === 1 ? [...gates.keys()][0] : 'these gates'} (${parts.join('; ')}). Your ticket works at any gate that accepts its ticket type.`,
        data: { eventId: event.id, gates: Object.fromEntries([...gates].map(([g, s]) => [g, [...new Set(s)]])) },
        link: '/my-tickets',
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  await prisma.auditLog.create({
    data: {
      userId: requesterUser.id, companyId: event.companyId ?? null, action: 'GATE_PLAN_NOTIFIED', targetType: 'Event', targetId: event.id,
      details: { sent, failed, gates: plan.toNotify },
    },
  });
  return { sent, failed, people: byUser.size };
}
