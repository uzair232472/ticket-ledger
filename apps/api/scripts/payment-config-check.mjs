#!/usr/bin/env node
/**
 * Payment configuration check (read-only; prints modes and problems, never a secret value).
 *   node scripts/payment-config-check.mjs [--json]
 * Exit 1 when the server would refuse to start (e.g. STRIPE_MODE=live with a test key).
 */
import 'dotenv/config';
import { methodAvailability, paymentStartupProblems, stripeConfig } from '../src/services/payments/config.js';

const stripe = stripeConfig();
const methods = methodAvailability();
const startup = paymentStartupProblems();
const report = {
  stripe: { mode: stripe.mode, key: stripe.keyKind, webhookConfigured: stripe.webhookConfigured, cardPaymentsAvailable: stripe.usable, livePaymentsPossible: stripe.usable && stripe.mode === 'live' && !startup.fatal.length, problems: stripe.problems },
  methods,
  startup,
  genuinePurchases: 'only orders with server-verified Stripe evidence in live mode (paymentEvidence.js)',
};
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Stripe: mode ${stripe.mode}, key ${stripe.keyKind}, webhook ${stripe.webhookConfigured ? 'configured' : 'NOT configured'}, card payments available: ${stripe.usable}, live payments possible: ${report.stripe.livePaymentsPossible}`);
  for (const p of stripe.problems) console.log(`  problem: ${p}`);
  for (const [m, a] of Object.entries(methods)) console.log(`${m}: ${a.available ? `available${a.test ? ' (test checkout, no money)' : ''}` : `unavailable (${a.reason})`}`);
  for (const f of startup.fatal) console.log(`  STARTUP REFUSED: ${f}`);
  console.log(`Genuine purchases: ${report.genuinePurchases}`);
}
process.exitCode = startup.fatal.length ? 1 : 0;
