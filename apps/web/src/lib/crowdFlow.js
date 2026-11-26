/**
 * Crowd-flow chart data, from the crowd insight (GET /ml/insights/events/:id/crowd) that the 3D view uses too.
 * Pure functions (tested in tests/crowdFlow.test.mjs). Rules:
 *   - per 5-minute slot, never cumulative;
 *   - capacity per slot = the gate's capacity per hour / 12;
 *   - a value that does not exist is null (a gap in the chart), never 0;
 *   - actual scans only where they were recorded; the AI only when this viewer may see it.
 */

// Categorical order (validated: dataviz palette, light surface). A gate keeps its colour whatever is selected.
export const GATE_COLORS = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'];
export const MAX_GATES_TOGETHER = GATE_COLORS.length;
// Single-gate view: one colour per kind of number
export const KIND_COLORS = { rule: '#257de0', model: '#f47230', actual: '#00b894', capacity: '#666666' };
export const SOURCES = { rule: 'Rule estimate', model: 'AI model (shadow)', actual: 'Actually scanned' };

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
export const slotLabel = (m) => (m === 0 ? 'start' : m < 0 ? `${m} min` : `+${m} min`);
export const slotText = (m) => (m === 0 ? 'at the start' : m < 0 ? `${-m} min before the start` : `${m} min after the start`);

/** Gates in a stable order (by name) with their colour, capacity per 5-minute slot and slots. */
export function gatesOf(data) {
  const gates = [...(data?.rules?.gates || [])].sort((a, b) => String(a.gate).localeCompare(String(b.gate), undefined, { numeric: true }));
  return gates.map((g, i) => ({
    id: g.gate_id, name: g.gate, color: GATE_COLORS[i % GATE_COLORS.length], index: i,
    capacityPerHour: num(g.capacity_per_hour), capacityPerSlot: num(g.capacity_per_hour) === null ? null : num(g.capacity_per_hour) / 12,
    slots: g.slots || [],
  }));
}

export const minutesOf = (data) => (gatesOf(data)[0]?.slots || []).map((s) => s.minutes);

/** Which sources have any value (the AI only when the viewer may see it). */
export function availableSources(data) {
  const gates = gatesOf(data);
  const any = (k) => gates.some((g) => g.slots.some((s) => num(s[k]) !== null));
  const aiVisible = Boolean(data && !data.experimental?.hidden);
  return { rule: any('rule'), model: aiVisible && any('model'), actual: any('actual') };
}

/**
 * Series for the chart.
 *   gateId null -> all gates: one line per gate for `source`, plus each gate's capacity (dashed, same colour);
 *   gateId set  -> one gate: rule, AI (with its 80% range and overload chance), actual, capacity.
 * Returns { minutes, series: [{ key, name, color, values, dashed?, band?: [lo[], hi[]], kind }], pOver: number[]|null }.
 */
export function chartSeries(data, { gateId = null, source = 'rule' } = {}) {
  const gates = gatesOf(data);
  const minutes = minutesOf(data);
  const avail = availableSources(data);
  const at = (g, k) => minutes.map((m) => num(g.slots.find((s) => s.minutes === m)?.[k]));
  const capLine = (g) => minutes.map(() => g.capacityPerSlot);
  if (!gateId) {
    const shown = gates.slice(0, MAX_GATES_TOGETHER);
    const key = avail[source] ? source : 'rule';
    const series = [];
    for (const g of shown) {
      series.push({ key: `${g.id}:${key}`, name: g.name, color: g.color, values: at(g, key), kind: key, gate: g.id });
      if (g.capacityPerSlot !== null) series.push({ key: `${g.id}:capacity`, name: `${g.name} capacity`, color: g.color, values: capLine(g), dashed: true, kind: 'capacity', gate: g.id, quiet: true });
    }
    return { minutes, series, pOver: null, source: key, truncated: gates.length > shown.length };
  }
  const g = gates.find((x) => x.id === gateId);
  if (!g) return { minutes, series: [], pOver: null, source };
  const series = [];
  if (avail.rule) series.push({ key: 'rule', name: SOURCES.rule, color: KIND_COLORS.rule, values: at(g, 'rule'), kind: 'rule' });
  if (avail.model) {
    const lo = at(g, 'model_low'), hi = at(g, 'model_high');
    series.push({ key: 'model', name: SOURCES.model, color: KIND_COLORS.model, values: at(g, 'model'), kind: 'model', band: lo.some((v) => v !== null) ? [lo, hi] : null });
  }
  if (avail.actual) series.push({ key: 'actual', name: SOURCES.actual, color: KIND_COLORS.actual, values: at(g, 'actual'), kind: 'actual' });
  if (g.capacityPerSlot !== null) series.push({ key: 'capacity', name: 'Capacity per 5 min', color: KIND_COLORS.capacity, values: capLine(g), dashed: true, kind: 'capacity' });
  const pOver = avail.model ? at(g, 'model_p_over') : null;
  return { minutes, series, pOver: pOver && pOver.some((v) => v !== null) ? pOver : null, source, gate: g };
}

/** The slot with the most expected arrivals over all gates (the default selection). */
export function busiestSlot(data, source = 'rule') {
  const gates = gatesOf(data);
  const minutes = minutesOf(data);
  if (!minutes.length) return null;
  const total = minutes.map((m) => gates.reduce((a, g) => a + (num(g.slots.find((s) => s.minutes === m)?.[source]) ?? 0), 0));
  return minutes[total.indexOf(Math.max(...total))];
}

/** Plain-language note on the rule's numbers: why every gate shows the same load, and where its timing comes from. */
export function ruleNote(data) {
  const basis = data?.rules?.curve_basis;
  const timing = !basis ? null
    : basis === 'default' ? 'There are no past gate scans yet, so it spreads arrivals evenly over time (the same number in every slot).'
      : basis === 'all' ? 'Its timing (when people arrive) is learned from past events of all types.'
        : `Its timing (when people arrive) is learned from past ${basis.replace(/^t:/, '').replace(/_/g, ' ').toLowerCase()} events.`;
  return ['The rule shares people out by gate capacity, so every gate shows the same load (% of its capacity) in a slot.', timing].filter(Boolean).join(' ');
}
