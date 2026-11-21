#!/usr/bin/env node
/**
 * Preflight for scripts/test-server-suites.sh: run with the SAME environment the sandboxed server gets.
 * Exits 1 (and the suites do not run) unless every external side effect is off:
 *   e-mail     nodemailer's in-memory JSON transport (nothing is sent)
 *   minting    simulation mode (no chain call, no transaction)
 *   payments   no usable Stripe key, not live mode
 *   uploads    Cloudinary not configured (local files)
 *   database   a *_verify copy
 * Prints the checks, never a secret.
 */
const problems = [];
const ok = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) problems.push(label); };

const db = (() => { try { return new URL(process.env.DATABASE_URL).pathname.slice(1); } catch { return ''; } })();
ok(db.endsWith('_verify'), `database is a *_verify copy (${db || 'none'})`);
const { getTransporter } = await import('../src/services/emailService.js');
ok(getTransporter().options?.jsonTransport === true, 'e-mail goes to the in-memory JSON transport');
const { readChainConfig } = await import('../src/config/chain.js');
ok(readChainConfig().mode === 'simulation', `NFT minting mode is simulation (got ${readChainConfig().mode})`);
const { stripeConfig } = await import('../src/services/payments/config.js');
const s = stripeConfig();
ok(!s.usable && s.mode === 'test', `Stripe cannot be called (key ${s.keyKind}, mode ${s.mode})`);
ok(!process.env.CLOUDINARY_API_KEY && !process.env.CLOUDINARY_API_SECRET, 'Cloudinary is not configured (local file storage)');
ok(!process.env.ADMIN_NOTIFY_EMAILS, 'no admin notification e-mail list');
ok(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(process.env.ML_SERVICE_URL || ''), 'ML service is local');
if (problems.length) { console.error(`Preflight refused: ${problems.length} problem(s).`); process.exit(1); }
console.log('Preflight passed: no real e-mail, blockchain, payment or upload side effects.');
process.exit(0);
