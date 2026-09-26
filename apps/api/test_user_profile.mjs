import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import app from './src/app.js';

test('MODULE 3 - User Profile, Wallet Connection & Account History Tests', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  // Login accounts to acquire tokens
  const getToken = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@123' }),
    });
    const body = await res.json();
    return body.data.token;
  };

  const customerToken = await getToken('customer@ticketledger.pk');
  const organizerToken = await getToken('organizer@ticketledger.pk');
  const staffToken = await getToken('staff@ticketledger.pk');
  const adminToken = await getToken('admin@ticketledger.pk');

  await t.test('1. Get Customer Profile with stats', async () => {
    const res = await fetch(`${baseUrl}/users/profile`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.profile.role, 'CUSTOMER');
    assert.ok('ticketCount' in body.data.stats);
  });

  await t.test('2. Get Organizer Profile with company stats', async () => {
    const res = await fetch(`${baseUrl}/users/profile`, {
      headers: { Authorization: `Bearer ${organizerToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.profile.role, 'ORGANIZER');
    assert.ok('companyStatus' in body.data.stats);
  });

  await t.test('3. Get Gate Staff Profile with scan stats', async () => {
    const res = await fetch(`${baseUrl}/users/profile`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.profile.role, 'GATE_STAFF');
    assert.ok('totalScans' in body.data.stats);
  });

  await t.test('4. Get Super Admin Profile with platform stats', async () => {
    const res = await fetch(`${baseUrl}/users/profile`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.profile.role, 'SUPER_ADMIN');
    assert.ok(body.data.stats.totalUsers >= 4);
  });

  await t.test('5. Update basic profile fields (name, city, phone)', async () => {
    const res = await fetch(`${baseUrl}/users/profile`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Ali Raza Updated',
        city: 'Islamabad',
        phone: '+923009988776',
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.user.name, 'Ali Raza Updated');
    assert.strictEqual(body.data.user.city, 'Islamabad');
  });

  const testWallet = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

  await t.test('6. Connect and save MetaMask wallet address', async () => {
    const res = await fetch(`${baseUrl}/users/wallet`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: testWallet }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.walletAddress, testWallet.toLowerCase());
  });

  await t.test('7. Reject duplicate wallet linking by another user', async () => {
    const res = await fetch(`${baseUrl}/users/wallet`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${organizerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: testWallet }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400);
    assert.match(body.message, /already linked/i);
  });

  await t.test('8. Reject malformed wallet address', async () => {
    const res = await fetch(`${baseUrl}/users/wallet`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${organizerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: '0xinvalidEthereumAddress' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('9. Disconnect wallet address successfully', async () => {
    const res = await fetch(`${baseUrl}/users/wallet`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: null }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.walletAddress, null);
  });

  await t.test('10. Update notification preferences', async () => {
    const res = await fetch(`${baseUrl}/users/notifications`, {
      method: 'PUT',
      headers: { 
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailNotifications: true,
        pushNotifications: false,
        smsNotifications: true,
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.pushNotifications, false);
    assert.strictEqual(body.data.smsNotifications, true);
  });

  await t.test('11. Retrieve account history with audit logs', async () => {
    const res = await fetch(`${baseUrl}/users/history`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.data.history));
    assert.ok(body.data.history.length > 0, 'Audit logs should exist for profile and wallet changes');
    const actions = body.data.history.map(h => h.action);
    assert.ok(actions.includes('PROFILE_UPDATED'));
    assert.ok(actions.includes('WALLET_CONNECTED'));
  });

  await new Promise((resolve) => server.close(resolve));
});
