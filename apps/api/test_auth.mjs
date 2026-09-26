import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';

test('MODULE 2 - Comprehensive Authentication & Role-Based Access Tests', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;

  let customerToken = '';
  let adminToken = '';
  const testEmail = `newcustomer_${Date.now()}@example.com`;

  const randomHex = Math.random().toString(16).substring(2, 10).padEnd(40, '0');
  const uniqueWallet = `0x${randomHex}`;

  await t.test('1. Register a new customer successfully', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Test User',
        email: testEmail,
        password: 'Password@123',
        phone: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: 'CUSTOMER',
        walletAddress: uniqueWallet,
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.email, testEmail.toLowerCase());
    assert.strictEqual(body.data.user.role, 'CUSTOMER');
    assert.strictEqual(body.data.user.status, 'ACTIVE');
    assert.ok(body.data.token, 'Token should be returned on registration');
    customerToken = body.data.token;
  });

  await t.test('2. Reject duplicate email registration', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Guy',
        email: testEmail,
        password: 'Password@123',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.success, false);
    assert.match(body.message, /already exists/i);
  });

  await t.test('3. Login seeded Admin account successfully', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@ticketledger.pk',
        password: 'Password@123',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.user.role, 'SUPER_ADMIN');
    assert.ok(body.data.token);
    adminToken = body.data.token;
  });

  await t.test('4. Reject invalid credentials', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@ticketledger.pk',
        password: 'WrongPassword!',
      }),
    });

    assert.strictEqual(res.status, 401);
  });

  await t.test('5. Reject login for FROZEN account', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'frozen@ticketledger.pk',
        password: 'Password@123',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.match(body.message, /frozen/i);
  });

  await t.test('6. Reject login for BLACKLISTED account', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'blacklisted@ticketledger.pk',
        password: 'Password@123',
      }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.match(body.message, /blacklisted/i);
  });

  await t.test('7. Mock OTP generation and verification flow', async () => {
    // Send OTP
    const sendRes = await fetch(`${baseUrl}/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@ticketledger.pk' }),
    });
    const sendBody = await sendRes.json();
    assert.strictEqual(sendRes.status, 200);
    assert.strictEqual(sendBody.data.mockOtp, '123456');

    // Verify valid OTP
    const verifyRes = await fetch(`${baseUrl}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@ticketledger.pk', otpCode: '123456' }),
    });
    const verifyBody = await verifyRes.json();
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyBody.data.user.isVerified, true);
    assert.ok(verifyBody.data.token);
  });

  await t.test('8. Current user profile /me endpoint with JWT', async () => {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.email, testEmail.toLowerCase());
  });

  await t.test('9. Role protection: Customer blocked from admin route', async () => {
    const res = await fetch(`${baseUrl}/role-test/admin`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    assert.strictEqual(res.status, 403);
  });

  await t.test('10. Role protection: Super Admin allowed on admin route', async () => {
    const res = await fetch(`${baseUrl}/role-test/admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.message, 'Super Admin access granted');
  });

  await new Promise((resolve) => server.close(resolve));
});
