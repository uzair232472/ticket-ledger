/*
 * What a checkout costs. One function prices every order (single event and multi-event checkout), and the
 * customer sees exactly these lines before paying:
 *
 *   tickets (subtotal)
 *   − discount: an automatic group discount (event setting: N+ tickets → X% off) or a discount code, whichever
 *     is larger (they don't stack); a discount never takes the tickets below PKR 1
 *   + service fee (organization setting): a percent of the discounted tickets, or PKR per ticket
 *   + tax (organization setting): a percent of tickets after discount plus the service fee
 *   = total
 *
 * All amounts are rounded to paisa.
 */

export const MIN_PAYABLE = 1;
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** The automatic group discount for this many tickets (0 when the event has none or the group is too small). */
export function groupDiscount(event, subtotal, ticketCount) {
  const min = Number(event?.groupMinTickets || 0);
  const pct = Number(event?.groupDiscountPercent || 0);
  if (!min || !pct || ticketCount < min) return 0;
  return money(Math.min((subtotal * pct) / 100, subtotal - MIN_PAYABLE));
}

/**
 * Prices an order. `codeDiscount` is what a valid discount code would take off (0 if none).
 * Returns { subtotal, codeDiscount, groupDiscount, discount, useCode, serviceFee, taxPercent, tax, total }.
 */
export function priceOrder({ subtotal, ticketCount, codeDiscount = 0, event, company }) {
  const sub = money(subtotal);
  const group = groupDiscount(event, sub, ticketCount);
  const code = money(codeDiscount);
  const useCode = code > 0 && code >= group;
  const discount = useCode ? code : group;
  const afterDiscount = money(Math.max(MIN_PAYABLE, sub - discount));

  let serviceFee = 0;
  const feeValue = Number(company?.serviceFeeValue || 0);
  if (company?.serviceFeeType === 'PERCENT') serviceFee = money((afterDiscount * feeValue) / 100);
  else if (company?.serviceFeeType === 'PER_TICKET') serviceFee = money(feeValue * ticketCount);

  const taxPercent = Number(company?.taxPercent || 0);
  const tax = money(((afterDiscount + serviceFee) * taxPercent) / 100);
  return {
    subtotal: sub,
    codeDiscount: useCode ? code : 0,
    groupDiscount: useCode ? 0 : group,
    discount,
    useCode,
    serviceFee,
    taxPercent,
    tax,
    total: money(afterDiscount + serviceFee + tax),
  };
}

/** The checkout fee settings of an event's organization (for priceOrder). */
export const COMPANY_FEES = { serviceFeeType: true, serviceFeeValue: true, taxPercent: true, taxLabel: true };
