import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';
import prisma from './src/config/prisma.js';

test('Email OTP Signup & Verification Flow', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  const uniqueId = Date.now();
  const testEmail = `otp_tester_${uniqueId}@example.pk`;
  let activeToken = '';

  await t.test('1. User signs up and triggers email OTP generation', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kamran Akmal',
        email: testEmail,
        password: 'Password@123',
        phone: `+92321${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: 'CUSTOMER',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.requiresOtp, true);
    assert.ok(data.data.otpSent);

    // Verify database record has isVerified: false and otpCode populated
    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    assert.strictEqual(dbUser.isVerified, false);
    assert.strictEqual(typeof dbUser.otpCode, 'string');
    assert.strictEqual(dbUser.otpCode.length, 6);
  });

  await t.test('2. Reject verification with incorrect OTP', async () => {
    const res = await fetch(`${baseUrl}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        otpCode: '000000',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
    assert.match(data.message, /invalid/i);
  });

  await t.test('3. Resend OTP code generates fresh code', async () => {
    const res = await fetch(`${baseUrl}/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);

    const dbUser = await prisma.user.findUnique({ where: { email: testEmail } });
    assert.ok(dbUser.otpCode);
  });

  await t.test('4. Verify with valid OTP code and issue JWT login session', async () => {
    const dbUserBefore = await prisma.user.findUnique({ where: { email: testEmail } });
    const validOtp = dbUserBefore.otpCode;

    const res = await fetch(`${baseUrl}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        otpCode: validOtp,
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.user.isVerified, true);
    assert.ok(data.data.token);
    activeToken = data.data.token;

    // Verify DB cleared otpCode and marked verified
    const dbUserAfter = await prisma.user.findUnique({ where: { email: testEmail } });
    assert.strictEqual(dbUserAfter.isVerified, true);
    assert.strictEqual(dbUserAfter.otpCode, null);
    assert.strictEqual(dbUserAfter.otpExpiresAt, null);
  });

  await t.test('5. Authenticated session works with newly verified user', async () => {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${activeToken}` },
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.user.email, testEmail);
    assert.strictEqual(data.data.user.isVerified, true);
  });

  // Clean up test user
  await prisma.behaviorEvent.deleteMany({ where: { user: { email: testEmail } } });
  await prisma.user.delete({ where: { email: testEmail } });

  await new Promise((resolve) => server.close(resolve));
});
