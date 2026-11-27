/**
 * What counts as REAL data for the ML features and training exports. One definition, used by the live
 * feature builders (e.g. the country's typical price) and by the training exporter, so test, seed and
 * internal records are left out the same way everywhere.
 *
 *   Accounts: CUSTOMER role only; test domains (example.*, *.test, proxyfarm.com, ...) and internal domains
 *             (ticketledger.pk) are not real; ML_EXPORT_TEST_DOMAINS / ML_EXPORT_INTERNAL_DOMAINS add or
 *             replace domains, ML_EXPORT_EXCLUDE_USERS / ML_EXPORT_EXCLUDE_EVENTS exclude ids.
 *   Events:   not real when run by a test or internal organizer account, or excluded by id.
 *   Payments: see paymentEvidence.js - only server-verified live transactions.
 */
export const DEFAULT_TEST_DOMAINS = ['example.com', 'example.org', 'example.net', 'example.test', 'test', 'invalid', 'localhost', 'local',
  'proxyfarm.com', 'mailinator.com'];
export const DEFAULT_INTERNAL_DOMAINS = ['ticketledger.pk'];
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * When genuine use of the platform began (ML_GENUINE_FROM, an ISO date-time; null = not set). When it is not set,
 * the exporter uses the first live, server-verified payment. Set it explicitly when staff make live test
 * purchases before real customers arrive: everything before it (accounts, events, payments) is internal test.
 */
export function genuineFromOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()) || (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(value))) {
    throw new Error(`ML_GENUINE_FROM is not a valid ISO date-time: "${value}"`);
  }
  return d;
}

export function dataPolicy(opts = {}, env = process.env) {
  return {
    genuineFrom: genuineFromOf(opts.genuineFrom !== undefined ? opts.genuineFrom : env.ML_GENUINE_FROM),
    testDomains: [...DEFAULT_TEST_DOMAINS, ...(opts.testDomains ?? list(env.ML_EXPORT_TEST_DOMAINS))].map((d) => d.toLowerCase()),
    internalDomains: (opts.internalDomains ?? (env.ML_EXPORT_INTERNAL_DOMAINS !== undefined ? list(env.ML_EXPORT_INTERNAL_DOMAINS) : DEFAULT_INTERNAL_DOMAINS)).map((d) => d.toLowerCase()),
    excludeUserIds: new Set(opts.excludeUserIds ?? list(env.ML_EXPORT_EXCLUDE_USERS)),
    excludeEventIds: new Set(opts.excludeEventIds ?? list(env.ML_EXPORT_EXCLUDE_EVENTS)),
  };
}

const domainOf = (email) => String(email || '').split('@').pop().toLowerCase();
const matches = (domain, l) => l.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Why an account is not a real customer (null = real). */
export function accountExclusion(user, policy) {
  if (!user) return 'account missing';
  if (policy.excludeUserIds.has(user.id)) return 'excluded account';
  const d = domainOf(user.email);
  if (matches(d, policy.testDomains)) return 'test e-mail domain';
  if (matches(d, policy.internalDomains)) return 'internal e-mail domain';
  if (user.role !== 'CUSTOMER') return 'not a customer account';
  return null;
}

/** Why an event's organizer makes it a test / internal event (null = a real organizer). Ignores cancellation. */
export function organizerExclusion(event, owner, policy) {
  if (!event) return 'event missing';
  if (policy.excludeEventIds.has(event.id)) return 'excluded event';
  if (!owner) return 'organizer missing';
  const d = domainOf(owner.email);
  if (matches(d, policy.testDomains)) return 'test organizer';
  if (matches(d, policy.internalDomains)) return 'internal organizer';
  return null;
}

/** Why an event is not usable for training (null = usable). */
export function eventExclusion(event, owner, policy) {
  if (event?.cancelledAt) return 'cancelled event';
  return organizerExclusion(event, owner, policy);
}
