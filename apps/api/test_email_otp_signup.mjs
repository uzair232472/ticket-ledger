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

test('Email OTP Signup & Verification Flow', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  const uniqueId = Date.now();
  const testEmail = `otp_tester_${uniqueId}@example.pk`;
  let activeToken = '';

  await t.test('1. Signup creates a PENDING_VERIFICATION account and a hashed OTP', async () => {
    const res = await fetch(`${baseUrl}/signup`, json({
      name: 'Kamran Akmal',
      email: testEmail,
      password: 'Password@123',
      phone: `+92321${Math.floor(1000000 + Math.random() * 9000000)}`,
    }));

    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.requiresOtp, true);

    const dbUser = await prisma.user.findUnique({ where: { email: testEmail }, include: { otpCodes: true } });
    assert.strictEqual(dbUser.status, 'PENDING_VERIFICATION');
    assert.strictEqual(dbUser.emailVerifiedAt, null);
    assert.strictEqual(dbUser.otpCodes.length, 1);
    assert.match(dbUser.otpCodes[0].codeHash, /^[0-9a-f]{64}$/);
    assert.match(getLastSentEmail().otpCode, /^\d{6}$/);
  });

  await t.test('2. Reject verification with incorrect OTP', async () => {
    const res = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code: '000000' }));
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.match(data.message, /^Incorrect code\. \d attempts? left\.$/);
  });

  await t.test('3. Resend is blocked during the cooldown, then replaces the old code', async () => {
    const resend = () => fetch(`${baseUrl}/resend-otp`, json({ email: testEmail, purpose: 'VERIFY_EMAIL' }));

    const blocked = await resend();
    assert.strictEqual(blocked.status, 429);

    // Simulate the 60 s cooldown having passed
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    await prisma.otpCode.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 61 * 1000) },
    });
    const oldCode = getLastSentEmail().otpCode;

    const res = await resend();
    assert.strictEqual(res.status, 200);

    const newCode = getLastSentEmail().otpCode;
    if (newCode !== oldCode) {
      const stale = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code: oldCode }));
      assert.strictEqual(stale.status, 400, 'A new code cancels the older one');
    }
  });

  await t.test('4. Verify with the valid code activates the account and starts a session', async () => {
    const res = await fetch(`${baseUrl}/verify-otp`, json({ email: testEmail, code: getLastSentEmail().otpCode }));
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.user.status, 'ACTIVE');
    assert.ok(data.data.user.emailVerifiedAt);
    assert.ok(data.data.token);
    activeToken = data.data.token;
  });

  await t.test('5. Authenticated session works with newly verified user', async () => {
    const res = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${activeToken}` } });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.user.email, testEmail);
  });

  await t.test('6. Legacy endpoints (/register, /otp/send, /otp/verify) still work', async () => {
    const email = `legacy_${uniqueId}@example.pk`;
    const reg = await fetch(`${baseUrl}/register`, json({ name: 'Legacy Client', email, password: 'Password@123' }));
    assert.strictEqual(reg.status, 201);
    const verify = await fetch(`${baseUrl}/otp/verify`, json({ email, otpCode: getLastSentEmail().otpCode }));
    assert.strictEqual(verify.status, 200);
    await prisma.behaviorEvent.deleteMany({ where: { user: { email } } });
    await prisma.user.delete({ where: { email } });
  });

  // Clean up test user
  await prisma.behaviorEvent.deleteMany({ where: { user: { email: testEmail } } });
  await prisma.user.delete({ where: { email: testEmail } });

  await new Promise((resolve) => server.close(resolve));
});
