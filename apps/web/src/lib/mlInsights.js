/**
 * Step 6: client for the read-only AI insight endpoints, plus the pure helpers the panels use (tested in
 * tests/mlInsights.test.mjs). Every insight is display-only: nothing here sends a decision anywhere. A failed
 * call returns null and the panel hides itself; the page around it keeps working.
 */

// Fixed wording for the reasons the API gives when an experimental value is not shown
const REASONS = {
  NO_MODEL_REGISTERED: 'No experimental model exists for this yet.',
  NO_MODEL_FOR_FEATURE: 'This feature has no model: it is a description of logged activity.',
  NO_SHADOW_PREDICTIONS_YET: 'The experimental model has not scored anything for this event yet.',
  ORGANIZER_VIEW_RULES_ONLY: 'Experimental model figures are shown to platform admins only.',
  SHADOW_CALL_FAILED: 'The last experimental prediction failed (the ML service was unavailable).',
  INPUTS_MISSING: 'Some inputs the model needs are missing for this event.',
  ML_SERVICE_UNAVAILABLE: 'The ML service is unavailable right now. The rules are unaffected.',
  TIMEOUT: 'The ML service did not answer in time. The rules are unaffected.',
  ARTIFACT_MISMATCH: 'The ML service has a different model file than the one registered, so it refused.',
  UNEXPECTED_RESPONSE: 'The ML service gave an unexpected answer, so it is not shown.',
  INPUTS_ERROR: 'The inputs for this event could not be read.',
};

export function reasonText(code) {
  if (!code) return null;
  const base = String(code).split(':')[0];
  return REASONS[base] || 'Not available.';
}

/**
 * What the experimental block can show: 'value' (aggregates to show), 'hidden' (organizer view),
 * 'unavailable' (with a reason) or 'none' (no block). Never anything else.
 */
export function experimentalState(exp) {
  if (!exp) return { kind: 'none', text: null };
  if (exp.hidden) return { kind: 'hidden', text: reasonText(exp.unavailable_reason || 'ORGANIZER_VIEW_RULES_ONLY') };
  if (exp.value && !exp.unavailable_reason) return { kind: 'value', text: null };
  if (exp.value && exp.unavailable_reason) return { kind: 'value', text: reasonText(exp.unavailable_reason) };
  return { kind: 'unavailable', text: reasonText(exp.unavailable_reason || 'NO_MODEL_REGISTERED') };
}

/** One sentence describing the model, always saying it decides nothing. */
export function modelLine(exp) {
  if (!exp || !exp.model) return 'Not used for any decision.';
  const parts = [exp.version && `version ${exp.version}`, exp.source, exp.status].filter(Boolean);
  return `Experimental ${exp.model} model${parts.length ? ` (${parts.join(', ')})` : ''}. Not used for any decision; not validated.`;
}

const STATUS_TEXT = {
  NO_OUTCOMES_YET: 'No real outcomes logged yet',
  NOT_ENOUGH_DATA: 'Not enough real outcomes to evaluate',
  MINIMUMS_REACHED_EVALUATE_OFFLINE: 'Enough outcomes logged: evaluate offline on genuine data',
  DESCRIPTIVE_ONLY: 'Description only (no model)',
  NO_DATA: 'No data yet',
};
/** Evaluation summary. Never a metric: the API sends counts against minimums only. */
export function evaluationText(ev) {
  if (!ev) return null;
  const head = STATUS_TEXT[ev.status] || ev.status;
  const short = (ev.short_of || []).map((s) => `${s.have.toLocaleString()} of ${s.need.toLocaleString()} ${s.measure.replace(/_/g, ' ')}`);
  return short.length ? `${head}: ${short.join(', ')}.` : `${head}.`;
}

export const pct = (x, digits = 0) => (x == null || Number.isNaN(Number(x)) ? '—' : `${(Number(x) * 100).toFixed(digits)}%`);
export const num = (x) => (x == null || Number.isNaN(Number(x)) ? '—' : Number(x).toLocaleString());

export const BAND_LABELS = { under_25: 'Under 25%', '25_to_50': '25–50%', '50_to_75': '50–75%', '75_and_over': '75% and over' };
export const bandRows = (bands) => Object.entries(BAND_LABELS).map(([k, label]) => ({ label, value: bands?.[k] ?? 0 }));

/**
 * Crowd chart series for one gate: rule (always), experimental model and actual (only when present).
 * Minutes from the start become labels like "-30" / "+15".
 */
export function crowdSeries(gate, { showModel = true } = {}) {
  const slots = gate?.slots || [];
  const labels = slots.map((s) => (s.minutes > 0 ? `+${s.minutes}` : String(s.minutes)));
  const pick = (k) => slots.map((s) => (s[k] == null ? 0 : Number(s[k])));
  const has = (k) => slots.some((s) => s[k] != null);
  const series = [];
  if (has('rule')) series.push({ key: 'rule', label: 'Rule estimate', values: pick('rule') });
  if (has('actual')) series.push({ key: 'actual', label: 'Actual scans', values: pick('actual') });
  if (showModel && has('model')) series.push({ key: 'model', label: 'Experimental model', values: pick('model') });
  return { labels, series };
}

/** Average price of edited tiers (the what-if price), or null when nothing was edited. */
export function whatIfPrice(original = [], edited = []) {
  if (!edited.length) return null;
  const changed = edited.some((t) => {
    const o = original.find((x) => x.id === t.id);
    return !o || Number(o.price) !== Number(t.price);
  });
  if (!changed) return null;
  return Math.round(edited.reduce((a, t) => a + Number(t.price), 0) / edited.length);
}

// ---------------------------------------------------------------------------------------------
// Recommendation rows: an impression counts when at least half of the row is visible for one second, once
// per list. Pure timer logic so it can be tested without a browser.
// ---------------------------------------------------------------------------------------------
export const RENDER_THRESHOLD = 0.5;
export const RENDER_DWELL_MS = 1000;

export function createRenderTracker({ onSeen, dwellMs = RENDER_DWELL_MS, threshold = RENDER_THRESHOLD, timers = globalThis }) {
  let timer = null;
  let done = false;
  return {
    /** Call with the visible share (0..1) whenever it changes. */
    update(ratio) {
      if (done) return;
      if (ratio >= threshold) {
        if (!timer) timer = timers.setTimeout(() => { timer = null; done = true; onSeen(); }, dwellMs);
      } else if (timer) {
        timers.clearTimeout(timer);
        timer = null;
      }
    },
    stop() { if (timer) timers.clearTimeout(timer); timer = null; },
    get seen() { return done; },
  };
}

// ---------------------------------------------------------------------------------------------
// Network (axios instance passed in, so the helpers above stay testable without the app)
// ---------------------------------------------------------------------------------------------
const TIMEOUT_MS = 4000;
let flagsPromise = null;

/** { insights, organizerInsights, recommendations } (all false when the call fails). */
export function fetchMlFlags(api) {
  if (!flagsPromise) {
    flagsPromise = api.get('/ml/flags', { timeout: TIMEOUT_MS })
      .then((r) => r.data?.data || { insights: false, organizerInsights: false, recommendations: false })
      .catch(() => { flagsPromise = null; return { insights: false, organizerInsights: false, recommendations: false }; });
  }
  return flagsPromise;
}

/** GET an insight; null on any failure or when insights are switched off. */
export async function fetchInsight(api, path, params) {
  try {
    const r = await api.get(path, { params, timeout: TIMEOUT_MS });
    const d = r.data?.data;
    if (!d || d.enabled === false) return null;
    if (d.decision_source && d.decision_source !== 'rules') return null; // defensive: only rule-decided answers are shown
    return d;
  } catch {
    return null;
  }
}
