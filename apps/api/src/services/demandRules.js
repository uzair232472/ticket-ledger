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
