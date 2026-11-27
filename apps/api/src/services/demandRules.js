/**
 * Pre-launch demand estimate: a fixed RULE, not a forecast model (Step 6).
 *
 * This is the rule branch of the ML service's legacy POST /forecast/demand (apps/ml-service/main.py,
 * execute_demand_forecast when no model is loaded), evaluated inside the API so the organizer page shows the
 * same rule whether or not the ML service is up. Before Step 6 a down service gave a different answer
 * (tier HIGH, other text) and, in development with ML_ALLOW_SYNTHETIC=1, the page showed a synthetic model's
 * number as the forecast. Model output now appears only in the labelled experimental panel (/api/ml/insights).
 *
 * The rule assumes 78% of capacity sells in the first 48 hours, for every event. It does not use this event's
 * data, so the text says so. It never changes prices or publishes anything.
 */
export const DEMAND_RULE_SHARE = 0.78;
export const DEMAND_RULE_NOTICE = 'Rule-based estimate (no trained model): assumes 78% of capacity sells in the first 48 hours for every event. It is not based on this event\'s own data.';

// Python round(x, 3) on these ratios (no exact .0005 halves occur for share * capacity / capacity)
const round3 = (x) => Math.round(x * 1000) / 1000;

export function ruleDemandForecast({ city = 'Lahore', marketingTier = 'MEDIUM', venueCapacity = 25000, avgTicketPrice = 2500.0, ticketPrices } = {}) {
  const capacity = Math.trunc(Number(venueCapacity));
  const price = Number(ticketPrices || avgTicketPrice || 2500.0);
  const sales = capacity > 0 ? Math.trunc(capacity * DEMAND_RULE_SHARE) : 0;
  const ratio = capacity > 0 ? round3(sales / capacity) : 0;

  let tier;
  let rec;
  if (ratio >= 0.70 || marketingTier === 'HIGH') {
    tier = 'VERY_HIGH';
    rec = `Rule of thumb: with the fixed 78% assumption this shows as strong demand in ${city}. Consider tiering premium sections, and check real sales after launch.`;
  } else if (ratio >= 0.55) {
    tier = 'HIGH';
    rec = `Rule of thumb: healthy uptake assumed in ${city}. Consider promoting mid-tier seating packages.`;
  } else if (ratio >= 0.40) {
    tier = 'MODERATE';
    rec = 'Rule of thumb: moderate uptake assumed. Early-bird incentives could help early sales.';
  } else {
    tier = 'LOW';
    rec = 'Rule of thumb: low uptake assumed. Consider your base prices and local promotion.';
  }

  return {
    projected_48h_sales: sales,
    projected_revenue_pkr: sales * price,
    sellout_probability: ratio,
    demand_tier: tier,
    demand_level: 'HIGH',
    pricing_recommendation: rec,
    prediction_source: 'rules',
    validated: false,
    notice: DEMAND_RULE_NOTICE,
  };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------------------------
// Pre-launch page rule (v2). Replaces the fixed 78% on the Demand forecast page.
//
// Still a RULE, not a model: every step is a fixed, published factor, and the page lists each one ("why this
// number"). Unlike the fixed 78% it reads THIS event: its real capacity (no 15,000 floor), its tier prices
// against the category benchmark, the day of the week and how far away the event is. The legacy
// ruleDemandForecast above stays as it is: it mirrors the ML service's /forecast/demand rule branch.
// ---------------------------------------------------------------------------------------------
export const PRELAUNCH_RULE_VERSION = 'prelaunch-rule-v2';

/** Typical average ticket price per category (PKR): fixed rule-of-thumb values. */
export const CATEGORY_BENCHMARK = {
  CRICKET_MATCH: 3000, FOOTBALL_MATCH: 2000, HOCKEY_MATCH: 1500, KABADDI: 1500, BOXING: 3500,
  MUSIC_CONCERT: 4000, MUSIC_FESTIVAL: 5000, QAWWALI: 2500, THEATRE: 2500, CONFERENCE: 5000,
  GENERAL_ADMISSION: 2000, OTHER: 2500,
};
/** Share of capacity assumed to sell in the first 48 hours at the benchmark price (rule of thumb). */
export const CATEGORY_BASE_SHARE = {
  CRICKET_MATCH: 0.6, FOOTBALL_MATCH: 0.4, HOCKEY_MATCH: 0.35, KABADDI: 0.35, BOXING: 0.45,
  MUSIC_CONCERT: 0.55, MUSIC_FESTIVAL: 0.45, QAWWALI: 0.4, THEATRE: 0.35, CONFERENCE: 0.3,
  GENERAL_ADMISSION: 0.35, OTHER: 0.35,
};
const PRICE_STEPS = [ // [highest price ratio, factor, wording]
  [0.7, 1.2, 'well below the category benchmark'],
  [1.0, 1.05, 'at or below the category benchmark'],
  [1.35, 0.9, 'a little above the category benchmark'],
  [2.0, 0.7, 'well above the category benchmark'],
  [Infinity, 0.5, 'far above the category benchmark'],
];
export const DEMAND_LEVELS = [[0.6, 'VERY_HIGH'], [0.45, 'HIGH'], [0.3, 'MODERATE'], [0, 'LOW']];

const benchmarkOf = (type) => CATEGORY_BENCHMARK[type] ?? CATEGORY_BENCHMARK.OTHER;
const baseShareOf = (type) => CATEGORY_BASE_SHARE[type] ?? CATEGORY_BASE_SHARE.OTHER;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const DAY_MS = 24 * 3600_000;

/** Weighted average price: what one ticket earns on average if every tier sells the same share. */
export const weightedAvgPrice = (tiers) => {
  const qty = tiers.reduce((a, t) => a + Number(t.totalQuantity || 0), 0);
  if (qty > 0) return tiers.reduce((a, t) => a + Number(t.price) * Number(t.totalQuantity || 0), 0) / qty;
  return tiers.length ? tiers.reduce((a, t) => a + Number(t.price), 0) / tiers.length : 0;
};

/**
 * Applies what-if prices to the event's tiers without saving anything.
 * `prices`: { [tierId]: price }. `scalePrice` (legacy simulatedPrice): scales every tier to that plain average.
 */
export function tiersWithPrices(tiers, { prices = null, scalePrice = null } = {}) {
  if (prices && Object.keys(prices).length) {
    return tiers.map((t) => (Number(prices[t.id]) > 0 ? { ...t, price: Number(prices[t.id]) } : t));
  }
  if (Number(scalePrice) > 0 && tiers.length) {
    const plain = tiers.reduce((a, t) => a + Number(t.price), 0) / tiers.length;
    if (plain > 0) return tiers.map((t) => ({ ...t, price: Math.round((Number(t.price) * Number(scalePrice)) / plain) }));
  }
  return tiers;
}

/** Event start: startsAt, else the date (+ time). */
const startOfEvent = (e) => {
  if (e.startsAt) return new Date(e.startsAt);
  const d = new Date(e.date);
  const [h, m] = String(e.time || '00:00').split(':').map(Number);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), (h || 0) - 5, m || 0)); // PKT = UTC+5
};

/**
 * The page's estimate for one event. `tiers` may carry what-if prices (tiersWithPrices). `now` decides the
 * lead time for an event not yet on sale; an event already on sale uses its sales-open date.
 */
export function prelaunchEstimate(event, { tiers = event.tiers, now = new Date() } = {}) {
  const tierQty = tiers.reduce((a, t) => a + Number(t.totalQuantity || 0), 0);
  const capacity = event.capacityLimit ? Math.min(event.capacityLimit, tierQty || event.capacityLimit) : tierQty;
  const avgPrice = weightedAvgPrice(tiers);
  const benchmark = benchmarkOf(event.type);
  const factors = [];

  const base = baseShareOf(event.type);
  factors.push({ key: 'category', label: `Category ${String(event.type).replace(/_/g, ' ').toLowerCase()}`, effect: base, text: `Starts from ${Math.round(base * 100)}% of capacity in 48 hours (rule of thumb for this category).` });

  const ratio = benchmark > 0 ? avgPrice / benchmark : 1;
  const [, priceFactor, priceWords] = PRICE_STEPS.find(([max]) => ratio <= max);
  factors.push({ key: 'price', label: 'Price', effect: priceFactor, text: `Average price PKR ${Math.round(avgPrice).toLocaleString('en-US')} is ${priceWords} (PKR ${benchmark.toLocaleString('en-US')}).` });

  const start = startOfEvent(event);
  const weekday = DAYS[new Date(start.getTime() + 5 * 3600_000).getUTCDay()];
  const weekend = ['Friday', 'Saturday', 'Sunday'].includes(weekday);
  factors.push({ key: 'day', label: 'Day', effect: weekend ? 1.1 : 0.9, text: `${weekday} event: ${weekend ? 'weekend events usually sell faster' : 'weekday events usually sell slower'}.` });

  const liveEvent = ['PUBLISHED', 'PAUSED', 'COMPLETED'].includes(event.status);
  const known = event.salesOpenAt || event.publishAt || (liveEvent && event.approvedAt) || null;
  // Not on sale yet: sales would open now. Live with no recorded sales-open date: lead time unknown (neutral).
  const from = known || (liveEvent ? null : now);
  const leadDays = from ? Math.round((start.getTime() - new Date(from).getTime()) / DAY_MS) : null;
  let leadFactor = 1;
  let leadText = `${leadDays} days between sales opening and the event: a normal window.`;
  if (leadDays == null) leadText = 'Sales-open date not recorded for this event: lead time not counted (× 1).';
  else if (leadDays < 7) { leadFactor = 0.8; leadText = `Only ${Math.max(0, leadDays)} days between sales opening and the event: little time to build interest.`; }
  else if (leadDays > 60) { leadFactor = 0.85; leadText = `${leadDays} days between sales opening and the event: buyers often wait when the event is far away.`; }
  if (start.getTime() < now.getTime()) leadText += ' Note: this event date has already passed.';
  factors.push({ key: 'lead', label: 'Lead time', effect: leadFactor, text: leadText });

  const share = clamp(base * priceFactor * (weekend ? 1.1 : 0.9) * leadFactor, 0.05, 0.95);
  const sales = Math.floor(capacity * share);
  // Revenue: every tier sells the same share of its own quantity (cheap tiers do not count like VIP tiers)
  const revenue = tierQty > 0
    ? Math.round(tiers.reduce((a, t) => a + Math.floor(Number(t.totalQuantity || 0) * share) * Number(t.price), 0))
    : Math.round(sales * avgPrice);
  const level = DEMAND_LEVELS.find(([min]) => share >= min)[1];

  return {
    rule_version: PRELAUNCH_RULE_VERSION,
    capacity, avg_price: Math.round(avgPrice), benchmark_price: benchmark, price_ratio: Math.round(ratio * 100) / 100,
    projected_48h_sales: sales, projected_revenue_pkr: revenue, sellout_probability: round3(share),
    demand_level: level, demand_tier: level, factors, weekday, weekend, lead_days: leadDays,
    // The whole calculation in one line, as the page shows it
    formula: `${Math.round(base * 100)}% × ${priceFactor} × ${weekend ? 1.1 : 0.9} × ${leadFactor} = ${Math.round(share * 100)}% of ${capacity} tickets = ${sales} tickets`,
    prediction_source: 'rules', validated: false,
    notice: 'Rule-based estimate (no trained model): a category starting share, adjusted for this event\'s prices, day and lead time. Every factor is listed below.',
  };
}

/** Price note against the category benchmark (weighted average price). */
export function priceNote({ avgPrice, benchmark, share }) {
  if (avgPrice > benchmark * 1.35) {
    const pctOver = Math.round(((avgPrice - benchmark) / benchmark) * 100);
    return {
      level: 'HIGH_PRICE_WARNING', severity: 'amber', title: 'Above the category benchmark',
      message: `Average ticket price of PKR ${Math.round(avgPrice).toLocaleString('en-US')} is ${pctOver}% above the fixed rule-of-thumb benchmark for this category (PKR ${benchmark.toLocaleString('en-US')}). Prices well above it may slow early sales. This is a fixed rule, not a forecast.`,
      recommendation: 'You may want to review the lowest tier price. Any change is your decision; nothing is changed automatically.',
    };
  }
  if (avgPrice < benchmark * 0.7 && share >= 0.45) {
    return {
      level: 'UNDERPRICED_WARNING', severity: 'cyan', title: 'Below the category benchmark',
      message: `Your average ticket price of PKR ${Math.round(avgPrice).toLocaleString('en-US')} is well below the fixed rule-of-thumb benchmark for this category (PKR ${benchmark.toLocaleString('en-US')}).`,
      recommendation: 'There may be room to raise premium tiers. Check real sales after launch; nothing is changed automatically.',
    };
  }
  return {
    level: 'OPTIMAL_PRICE', severity: 'emerald', title: 'Within the category benchmark',
    message: `Average ticket price of PKR ${Math.round(avgPrice).toLocaleString('en-US')} is within the fixed rule-of-thumb range for this category (benchmark PKR ${benchmark.toLocaleString('en-US')}).`,
    recommendation: 'No price note from the rules.',
  };
}

/** Suggested publish window (rule of thumb); for an event already on sale it says so instead. */
export function publishSuggestion(event, { now = new Date() } = {}) {
  const live = ['PUBLISHED', 'PAUSED', 'COMPLETED'].includes(event.status);
  if (live) {
    const when = event.publishAt || event.salesOpenAt || event.approvedAt;
    return {
      already_published: true,
      time: 'Already on sale',
      reason: when ? `Sales opened on ${new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}. Compare the estimate with real sales below.` : 'This event is already on sale. Compare the estimate with real sales below.',
    };
  }
  const daysLeft = Math.round((startOfEvent(event).getTime() - now.getTime()) / DAY_MS);
  if (daysLeft < 14) return { already_published: false, time: 'As soon as possible', reason: `The event is ${Math.max(0, daysLeft)} days away: every day on sale counts more than the hour you publish.` };
  const t = String(event.type);
  if (t.includes('CRICKET') || t.includes('FOOTBALL') || t.includes('HOCKEY') || t.includes('KABADDI') || t.includes('BOXING')) {
    return { already_published: false, time: 'Thursday at 6:30 PM PKT', reason: 'Rule of thumb for sports events (not based on TicketLedger data): evening releases a few days before the weekend.' };
  }
  if (t.includes('MUSIC') || t.includes('QAWWALI')) {
    return { already_published: false, time: 'Friday at 7:00 PM PKT', reason: 'Rule of thumb for concerts (not based on TicketLedger data): Friday evenings, as weekend plans are made.' };
  }
  return { already_published: false, time: 'Wednesday at 5:00 PM PKT', reason: 'Rule of thumb (not based on TicketLedger data): a mid-week evening release gives a few days of attention before the weekend.' };
}

/**
 * The inputs the pre-launch page feeds the rule (unchanged from the page's earlier inline code): capacity is the
 * tiers' total with a floor of 15,000 unless simulated; the price is the plain average of tier prices (2,500
 * with no tiers) unless simulated; marketing tier HIGH unless simulated.
 */
export function prelaunchRuleInputs(event, { simulatedPrice, simulatedCapacity, simulatedMarketingTier } = {}) {
  const totalTierQty = event.tiers.reduce((acc, t) => acc + t.totalQuantity, 0);
  const capacity = simulatedCapacity ? Number(simulatedCapacity) : Math.max(totalTierQty, 15000);
  const actualAvgPrice = event.tiers.length > 0 ? event.tiers.reduce((acc, t) => acc + Number(t.price), 0) / event.tiers.length : 2500;
  const avgPrice = simulatedPrice ? Number(simulatedPrice) : actualAvgPrice;
  const dayIndex = new Date(event.date).getDay();
  return {
    capacity, avgPrice, actualAvgPrice,
    params: {
      eventType: event.type, city: event.city, marketingTier: simulatedMarketingTier || 'HIGH', venueCapacity: capacity,
      avgTicketPrice: avgPrice, ticketPrices: avgPrice, isWeekend: [0, 5, 6].includes(dayIndex) ? 1 : 0, dayOfWeek: DAYS[dayIndex] || 'Saturday', publishHour: 18,
    },
  };
}
