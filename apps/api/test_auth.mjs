import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { getLastSentEmail } from './src/services/emailService.js';

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Extracts the refresh cookie ("tl_refresh=...") from a response
const refreshCookieOf = (res) => {
  const header = res.headers.get('set-cookie') || '';
  const match = header.match(/tl_refresh=([^;]*)/);
  return match ? `tl_refresh=${match[1]}` : null;
};

test('MODULE 2 - Authentication, sessions & role-based access', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  let customerToken = '';
  let customerCookie = '';
  let adminToken = '';
  const testEmail = `newcustomer_${Date.now()}@example.com`;
  const organizerEmail = `neworganizer_${Date.now()}@example.com`;

  const randomHex = Math.random().toString(16).substring(2, 10).padEnd(40, '0');
  const uniqueWallet = `0x${randomHex}`;

  await t.test('1. Signup ignores a client-supplied role and issues no token', async () => {
    const res = await fetch(`${baseUrl}/signup`, json({
      name: 'New Test User',
      email: testEmail,
      password: 'Password123',
      phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
      role: 'SUPER_ADMIN',
      walletAddress: uniqueWallet,
    }));

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.email, testEmail.toLowerCase());
    assert.strictEqual(body.data.token, undefined);

    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    assert.strictEqual(dbUser.role, 'CUSTOMER');
    assert.strictEqual(dbUser.status, 'PENDING_VERIFICATION');
    assert.match(dbUser.phone, /^\+923\d{9}$/, 'Phone is normalized to +923XXXXXXXXX');

    const otp = await prisma.otpCode.findFirst({ where: { userId: dbUser.id, purpose: 'VERIFY_EMAIL' } });
    assert.match(otp.codeHash, /^[0-9a-f]{64}$/, 'Only a hash of the OTP is stored');
  });

  await t.test('1b. Nobody can sign up as GATE_STAFF or SUPER_ADMIN via accountType', async () => {
    const res = await fetch(`${baseUrl}/signup`, json({
      name: 'Sneaky', email: `sneaky_${Date.now()}@example.com`, password: 'Password123', accountType: 'super_admin',
    }));
    assert.strictEqual(res.status, 400);
  });

  await t.test('1c. Password and name rules are enforced', async () => {
    const weak = await fetch(`${baseUrl}/signup`, json({ name: 'Weak', email: `weak_${Date.now()}@example.com`, password: 'abcdefgh' }));
    assert.strictEqual(weak.status, 400);
    const shortName = await fetch(`${baseUrl}/signup`, json({ name: 'A', email: `short_${Date.now()}@example.com`, password: 'Password123' }));
    assert.strictEqual(shortName.status, 400);
  });

  await t.test('2. Duplicate email gets the brief wording', async () => {
    const res = await fetch(`${baseUrl}/signup`, json({ name: 'Duplicate Guy', email: testEmail, password: 'Password123', phone: '03112223344' }));
    const body = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.message, 'An account with this email already exists. Try logging in.');
  });

  await t.test('3. Unverified login is refused with needsVerification', async () => {
    const res = await fetch(`${baseUrl}/login`, json({ email: testEmail, password: 'Password123' }));
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.needsVerification, true);
    assert.strictEqual(body.data.token, undefined);
  });

  await t.test('4. Wrong OTP reports attempts left; correct OTP verifies and starts a session', async () => {
    const code = getLastSentEmail().otpCode;
    const wrong = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code: code === '000000' ? '111111' : '000000' }));
    const wrongBody = await wrong.json();
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual(wrongBody.message, 'Incorrect code. 4 attempts left.');

    const res = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code, purpose: 'VERIFY_EMAIL' }));
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.role, 'CUSTOMER');
    assert.strictEqual(body.data.user.status, 'ACTIVE');
    assert.ok(body.data.token);
    customerToken = body.data.token;
    customerCookie = refreshCookieOf(res);
    assert.ok(customerCookie, 'Refresh cookie is set');
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);

    const reuse = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code }));
    assert.strictEqual(reuse.status, 400, 'A used code cannot be reused');
  });

  await t.test('5. Five wrong attempts lock the code', async () => {
    const email = `locked_${Date.now()}@example.com`;
    await fetch(`${baseUrl}/signup`, json({ name: 'Locked User', email, password: 'Password123', phone: '03115556677' }));
    const code = getLastSentEmail().otpCode;
    const wrongCode = code === '000000' ? '111111' : '000000';

    let last;
    for (let i = 0; i < 5; i++) {
      last = await (await fetch(`${baseUrl}/verify-otp`, json({ email, code: wrongCode }))).json();
    }
    assert.strictEqual(last.message, 'This code has expired. Please request a new one.');

    const right = await fetch(`${baseUrl}/verify-otp`, json({ email, code }));
    assert.strictEqual(right.status, 400, 'Even the right code fails once locked');

    const resend = await fetch(`${baseUrl}/resend-otp`, json({ email, purpose: 'VERIFY_EMAIL' }));
    const resendBody = await resend.json();
    assert.strictEqual(resend.status, 429, 'Resend is blocked for 60 s');
    assert.match(resendBody.message, /^Please wait \d+ seconds before requesting a new code\.$/);
  });

  await t.test('6. Organizer signup lands with companyStatus NONE', async () => {
    await fetch(`${baseUrl}/signup`, json({ name: 'New Organizer', email: organizerEmail, password: 'Password123', accountType: 'organizer', phone: '03118889900' }));
    const res = await fetch(`${baseUrl}/verify-otp`, json({ email: organizerEmail, code: getLastSentEmail().otpCode }));
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.role, 'ORGANIZER');
    assert.strictEqual(body.data.user.companyStatus, 'NONE');
  });

  await t.test('7. Seeded Super Admin logs in', async () => {
    const res = await fetch(`${baseUrl}/login`, json({ email: 'admin@ticketledger.pk', password: 'Password@123' }));
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.role, 'SUPER_ADMIN');
    adminToken = body.data.token;
  });

  await t.test('8. Wrong password and unknown email get the same message', async () => {
    const wrongPw = await fetch(`${baseUrl}/login`, json({ email: 'admin@ticketledger.pk', password: 'WrongPassword1' }));
    const unknown = await fetch(`${baseUrl}/login`, json({ email: `nobody_${Date.now()}@example.com`, password: 'WrongPassword1' }));
    assert.strictEqual(wrongPw.status, 401);
    assert.strictEqual(unknown.status, 401);
    assert.strictEqual((await wrongPw.json()).message, 'Invalid email or password.');
    assert.strictEqual((await unknown.json()).message, 'Invalid email or password.');
  });

  await t.test('9. Suspended and banned accounts see the suspended message', async () => {
    for (const email of ['frozen@ticketledger.pk', 'blacklisted@ticketledger.pk']) {
      const res = await fetch(`${baseUrl}/login`, json({ email, password: 'Password@123' }));
      const body = await res.json();
      assert.strictEqual(res.status, 403);
      assert.strictEqual(body.code, 'ACCOUNT_SUSPENDED');
      assert.strictEqual(body.message, 'Your account has been suspended. Contact support.');
    }
  });

  await t.test('10. Forgot password answers the same for existing and unknown emails', async () => {
    const known = await (await fetch(`${baseUrl}/forgot-password`, json({ email: testEmail }))).json();
    const unknown = await (await fetch(`${baseUrl}/forgot-password`, json({ email: `nobody_${Date.now()}@example.com` }))).json();
    assert.strictEqual(known.message, "If an account exists for this email, we've sent a code.");
    assert.strictEqual(unknown.message, known.message);
  });

  await t.test('11. Refresh rotates the cookie; an old cookie stops working', async () => {
    const res = await fetch(`${baseUrl}/refresh`, { method: 'POST', headers: { Cookie: customerCookie } });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.token);
    const rotated = refreshCookieOf(res);
    assert.ok(rotated && rotated !== customerCookie);

    const replay = await fetch(`${baseUrl}/refresh`, { method: 'POST', headers: { Cookie: customerCookie } });
    assert.strictEqual(replay.status, 401);
    customerCookie = rotated;
    customerToken = body.data.token;
  });

  await t.test('12. Password reset changes the password and revokes all sessions', async () => {
    const code = getLastSentEmail().otpCode; // from test 10
    assert.strictEqual(getLastSentEmail().purpose, 'RESET_PASSWORD');

    const res = await fetch(`${baseUrl}/reset-password`, json({ email: testEmail, code, newPassword: 'NewPassword456' }));
    assert.strictEqual(res.status, 200);

    const refreshAfter = await fetch(`${baseUrl}/refresh`, { method: 'POST', headers: { Cookie: customerCookie } });
    assert.strictEqual(refreshAfter.status, 401, 'Old sessions are revoked');

    const oldPw = await fetch(`${baseUrl}/login`, json({ email: testEmail, password: 'Password123' }));
    assert.strictEqual(oldPw.status, 401);
    const newPw = await fetch(`${baseUrl}/login`, json({ email: testEmail, password: 'NewPassword456' }));
    const body = await newPw.json();
    assert.strictEqual(newPw.status, 200);
    customerToken = body.data.token;
    customerCookie = refreshCookieOf(newPw);
  });

  await t.test('13. /me returns the current user', async () => {
    const res = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${customerToken}` } });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.email, testEmail.toLowerCase());
  });

  await t.test('14. Banning a user blocks their access token and refresh cookie immediately', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    const ban = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${user.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'BANNED', reason: 'Test' }),
    });
    assert.strictEqual(ban.status, 200);

    const me = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${customerToken}` } });
    assert.strictEqual(me.status, 403);
    assert.strictEqual((await me.json()).code, 'ACCOUNT_SUSPENDED');

    const refresh = await fetch(`${baseUrl}/refresh`, { method: 'POST', headers: { Cookie: customerCookie } });
    assert.strictEqual(refresh.status, 401, 'Refresh token was revoked by the ban');
  });

  await t.test('15. Logout revokes the refresh cookie', async () => {
    const login = await fetch(`${baseUrl}/login`, json({ email: 'customer@ticketledger.pk', password: 'Password@123' }));
    const cookie = refreshCookieOf(login);
    const out = await fetch(`${baseUrl}/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual(out.status, 204);
    const refresh = await fetch(`${baseUrl}/refresh`, { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual(refresh.status, 401);
  });

  await t.test('16. Role protection', async () => {
    const login = await fetch(`${baseUrl}/login`, json({ email: 'customer@ticketledger.pk', password: 'Password@123' }));
    const token = (await login.json()).data.token;
    const blocked = await fetch(`${baseUrl}/role-test/admin`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(blocked.status, 403);

    const allowed = await fetch(`${baseUrl}/role-test/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual((await allowed.json()).message, 'Super Admin access granted');
  });

  // Clean up test users
  const emails = [testEmail, organizerEmail];
  await prisma.behaviorEvent.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: (await prisma.user.findMany({ where: { email: { in: emails } } })).map((u) => u.id) } } });
  await prisma.notification.deleteMany({ where: { user: { email: { in: emails } } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'locked_' } } });

  await new Promise((resolve) => server.close(resolve));
});
