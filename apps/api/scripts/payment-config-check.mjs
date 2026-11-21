#!/usr/bin/env node
/**
 * Payment configuration check (read-only; prints modes and problems, never a secret value).
 *   node scripts/payment-config-check.mjs [--json]
 * Exit 1 when the configuration is inconsistent (e.g. STRIPE_MODE=live with a test key).
 */
import 'dotenv/config';
import { stripeConfig } from '../src/services/stripeWebhookService.js';

const placeholder = (v) => !v || /mock|test|sandbox|demo|change|your|xxx/i.test(v);
const stripe = stripeConfig();
const report = {
  stripe: { ...stripe, livePaymentsPossible: stripe.mode === 'live' && stripe.keyMode === 'live' && stripe.problems.length === 0 },
  jazzcash: { integration: 'simulated in paymentService.js (no provider call)', credentials: placeholder(process.env.JAZZCASH_MERCHANT_ID) ? 'placeholder or missing' : 'set (unused by the code)', canProduceEvidence: false },
  easypaisa: { integration: 'simulated in paymentService.js (no provider call)', credentials: placeholder(process.env.EASYPAISA_STORE_ID) ? 'placeholder or missing' : 'set (unused by the code)', canProduceEvidence: false },
  mock: { integration: 'test checkout', canProduceEvidence: false },
  genuinePurchases: 'only orders with server-verified Stripe evidence in live mode (paymentEvidence.js)',
};
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Stripe: mode ${stripe.mode}, key ${stripe.keyMode}, webhook ${stripe.webhookConfigured ? 'configured' : 'NOT configured'}, live payments possible: ${report.stripe.livePaymentsPossible}`);
  for (const p of stripe.problems) console.log(`  problem: ${p}`);
  console.log(`JazzCash: ${report.jazzcash.integration}; credentials ${report.jazzcash.credentials}`);
  console.log(`EasyPaisa: ${report.easypaisa.integration}; credentials ${report.easypaisa.credentials}`);
  console.log(`Genuine purchases: ${report.genuinePurchases}`);
}
process.exitCode = stripe.problems.some((p) => p.startsWith('STRIPE_MODE')) ? 1 : 0;
