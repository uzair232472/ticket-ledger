import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { getLastSentEmail } from './src/services/emailService.js';

test('Pending signup: correct email after OTP, keep phone, server-driven OTP timing', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const api = `http://127.0.0.1:${server.address().port}/api/auth`;
  const run = Date.now();

  const wrongEmail = `typo_${run}@exmaple.com`;
  const rightEmail = `fixed_${run}@example.com`;
  const phone = `+92345${String(run).slice(-7)}`;
  let pendingCookie = '';

  const call = async (method, path, { body, cookie } = {}) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/tl_pending_signup=([^;]*)/);
    return { status: res.status, body: await res.json().catch(() => null), pendingCookie: match ? `tl_pending_signup=${match[1]}` : null, setCookie };
  };
  const backdateCodes = async (email) => {
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.otpCode.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61 * 1000) } });
  };

  let codeForWrongEmail = '';
  let firstExpiry = '';

  await t.test('1. Signup with a phone and a mistyped email starts a pending signup session', async () => {
    const res = await call('POST', '/signup', { body: { name: 'Ayesha Typo', email: wrongEmail, phone, password: 'Password123', accountType: 'organizer' } });
    assert.strictEqual(res.status, 201);
    assert.ok(res.pendingCookie, 'Pending signup cookie is set');
    assert.match(res.setCookie, /HttpOnly/i);
    pendingCookie = res.pendingCookie;
    codeForWrongEmail = getLastSentEmail().otpCode;

    const expiresInMs = Date.parse(res.body.data.otpExpiresAt) - Date.parse(res.body.data.serverTime);
    assert.ok(expiresInMs > 9.9 * 60 * 1000 && expiresInMs <= 10 * 60 * 1000, 'Server reports a 10-minute expiry');
    firstExpiry = res.body.data.otpExpiresAt;
  });

  await t.test('2. Returning from the OTP screen restores the fields (never the password)', async () => {
    const res = await call('GET', '/pending-signup', { cookie: pendingCookie });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      { name: res.body.data.name, email: res.body.data.email, phone: res.body.data.phone, accountType: res.body.data.accountType },
      { name: 'Ayesha Typo', email: wrongEmail, phone, accountType: 'organizer' }
    );
    assert.strictEqual(res.body.data.password, undefined);
    assert.strictEqual(res.body.data.passwordHash, undefined);
  });

  await t.test('3. Reopening the OTP screen does not restart the expiry', async () => {
    const again = await call('GET', '/pending-signup', { cookie: pendingCookie });
    assert.strictEqual(again.body.data.otpExpiresAt, firstExpiry);
  });

  await t.test('4. The pending signup is only reachable through a valid server-signed session', async () => {
    assert.strictEqual((await call('GET', '/pending-signup')).status, 401);
    const user = await prisma.user.findUnique({ where: { email: wrongEmail } });
    const forged = jwt.sign({ userId: user.id, typ: 'pending_signup' }, 'not-the-server-secret');
    assert.strictEqual((await call('GET', '/pending-signup', { cookie: `tl_pending_signup=${forged}` })).status, 401);
    // Knowing the email, phone or id is not enough to change the signup
    const patch = await call('PATCH', '/pending-signup', { body: { name: 'Hijack', email: `hijack_${run}@example.com`, phone, userId: user.id } });
    assert.strictEqual(patch.status, 401);
  });

  await t.test('5. Changing the email right away respects the resend cooldown', async () => {
    const res = await call('PATCH', '/pending-signup', { cookie: pendingCookie, body: { name: 'Ayesha Typo', email: rightEmail, phone, accountType: 'organizer' } });
    assert.strictEqual(res.status, 429);
    assert.match(res.body.message, /^Please wait \d+ seconds before requesting a new code\.$/);
    const user = await prisma.user.findUnique({ where: { email: wrongEmail } });
    assert.ok(user, 'Nothing changed while rate limited');
  });

  await t.test('6. Correcting the email keeps the phone, updates the same account and sends a new code', async () => {
    await backdateCodes(wrongEmail);
    const before = await prisma.user.findUnique({ where: { email: wrongEmail } });

    // Resubmitting the signup form (with the original phone) updates the pending record
    const res = await call('POST', '/signup', { cookie: pendingCookie, body: { name: 'Ayesha Fixed', email: rightEmail, phone, password: 'Password123', accountType: 'organizer' } });
    assert.strictEqual(res.status, 200, res.body?.message);
    assert.strictEqual(res.body.data.emailChanged, true);
    pendingCookie = res.pendingCookie || pendingCookie;

    const accounts = await prisma.user.findMany({ where: { OR: [{ phone }, { email: { in: [wrongEmail, rightEmail] } }] } });
    assert.strictEqual(accounts.length, 1, 'Only one account exists');
    assert.strictEqual(accounts[0].id, before.id, 'The same record was updated');
    assert.strictEqual(accounts[0].email, rightEmail);
    assert.strictEqual(accounts[0].phone, phone);
    assert.strictEqual(accounts[0].name, 'Ayesha Fixed');
    assert.strictEqual(accounts[0].status, 'PENDING_VERIFICATION');
    assert.strictEqual(accounts[0].emailVerifiedAt, null);

    const sent = getLastSentEmail();
    assert.strictEqual(sent.to, rightEmail);
    assert.ok(Date.parse(res.body.data.otpExpiresAt) > Date.parse(firstExpiry), 'Countdown resets for the new code');
  });

  await t.test('7. The old code no longer works; the new code verifies the corrected email', async () => {
    const newCode = getLastSentEmail().otpCode;
    if (codeForWrongEmail !== newCode) {
      const old = await call('POST', '/verify-otp', { body: { email: rightEmail, code: codeForWrongEmail } });
      assert.strictEqual(old.status, 400, 'Old code fails for the corrected email');
    }
    const oldAddress = await call('POST', '/verify-otp', { body: { email: wrongEmail, code: codeForWrongEmail } });
    assert.strictEqual(oldAddress.status, 400, 'Old address no longer has an account');

    const res = await call('POST', '/verify-otp', { body: { email: rightEmail, code: newCode } });
    assert.strictEqual(res.status, 200, res.body?.message);
    assert.strictEqual(res.body.data.user.status, 'ACTIVE');
    assert.strictEqual(res.body.data.user.phone, phone);
    assert.match(res.setCookie, /tl_pending_signup=;/, 'Pending session is cleared after verification');

    const pendingAfter = await call('GET', '/pending-signup', { cookie: pendingCookie });
    assert.strictEqual(pendingAfter.status, 401, 'A verified account can no longer be edited through the old session');
  });

  await t.test("8. Other accounts' phone numbers stay protected", async () => {
    // A brand-new signup cannot reuse the now-verified account's phone
    const fresh = await call('POST', '/signup', { body: { name: 'Copy Cat', email: `copycat_${run}@example.com`, phone, password: 'Password123' } });
    assert.strictEqual(fresh.status, 409);
    assert.strictEqual(fresh.body.message, 'An account with this phone number already exists.');

    // A pending signup cannot take another account's phone either
    const other = await call('POST', '/signup', { body: { name: 'Other Person', email: `other_${run}@example.com`, phone: `+92346${String(run).slice(-7)}`, password: 'Password123' } });
    assert.strictEqual(other.status, 201);
    const steal = await call('PATCH', '/pending-signup', { cookie: other.pendingCookie, body: { name: 'Other Person', email: `other_${run}@example.com`, phone, accountType: 'customer' } });
    assert.strictEqual(steal.status, 409);
    assert.strictEqual(steal.body.message, 'An account with this phone number already exists.');

    // ...or another account's email
    const stealEmail = await call('PATCH', '/pending-signup', { cookie: other.pendingCookie, body: { name: 'Other Person', email: 'customer@ticketledger.pk', accountType: 'customer' } });
    assert.strictEqual(stealEmail.status, 409);
  });

  await t.test('9. Expiry is enforced on the server; a resend after the cooldown resets the timer', async () => {
    const email = `other_${run}@example.com`;
    const user = await prisma.user.findUnique({ where: { email } });
    const code = getLastSentEmail().otpCode;
    await prisma.otpCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    const expired = await call('POST', '/verify-otp', { body: { email, code } });
    assert.strictEqual(expired.status, 400);
    assert.strictEqual(expired.body.message, 'This code has expired. Please request a new one.');

    const login = await call('POST', '/login', { body: { email, password: 'Password123' } });
    const cookie = login.pendingCookie;
    const timing = await call('GET', '/pending-signup', { cookie });
    // Logging in while unverified issued a fresh code, so the timer restarted only because a new code exists
    assert.ok(Date.parse(timing.body.data.otpExpiresAt) > Date.parse(timing.body.data.serverTime));

    await prisma.otpCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const atZero = await call('GET', '/pending-signup', { cookie });
    assert.ok(Date.parse(atZero.body.data.otpExpiresAt) <= Date.parse(atZero.body.data.serverTime), 'Reported as expired');
    assert.ok(Date.parse(atZero.body.data.resendAvailableAt) <= Date.parse(atZero.body.data.serverTime), 'Resend allowed');

    const resend = await call('POST', '/resend-otp', { body: { email, purpose: 'VERIFY_EMAIL' } });
    assert.strictEqual(resend.status, 200);
    const after = await call('GET', '/pending-signup', { cookie });
    const left = Date.parse(after.body.data.otpExpiresAt) - Date.parse(after.body.data.serverTime);
    assert.ok(left > 9.9 * 60 * 1000, 'Countdown reset after a successful resend');

    const blocked = await call('POST', '/resend-otp', { body: { email, purpose: 'VERIFY_EMAIL' } });
    assert.strictEqual(blocked.status, 429, 'Resend cooldown still applies');
    const unchanged = await call('GET', '/pending-signup', { cookie });
    assert.strictEqual(unchanged.body.data.otpExpiresAt, after.body.data.otpExpiresAt, 'A refused resend does not reset the countdown');
  });

  // Clean up
  const emails = [rightEmail, wrongEmail, `other_${run}@example.com`, `copycat_${run}@example.com`];
  await prisma.behaviorEvent.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  await new Promise((resolve) => server.close(resolve));
});
