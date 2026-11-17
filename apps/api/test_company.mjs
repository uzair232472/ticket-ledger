import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';

test('MODULE 4 - Company Registration & Super Admin Approval Tests', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const getToken = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@123' }),
    });
    const body = await res.json();
    return body.data.token;
  };

  const adminToken = await getToken('admin@ticketledger.pk');
  const approvedOrgToken = await getToken('organizer@ticketledger.pk');
  // A throwaway pending organizer of its own, so runs don't depend on (or change) the seed data
  const run = Date.now();
  const pendingUser = await prisma.user.create({ data: { name: 'Test Pending Organizer', email: `pending_org_${run}@example.com`, passwordHash: await bcrypt.hash('Password@123', 10), role: 'ORGANIZER', status: 'ACTIVE', emailVerifiedAt: new Date(), isVerified: true } });
  const pendingCompany = await prisma.company.create({ data: { userId: pendingUser.id, companyName: `Karachi Kings Sports & Festivals ${run}`, ownerName: 'Fahad Salman', phone: '+923001234566', email: `info_${run}@example.com`, city: 'Karachi', ntnCnic: '42101-9876543-1', documentUrl: '/uploads/company_docs/cnic.pdf', documentUrls: ['/uploads/company_docs/cnic.pdf'], status: 'PENDING' } });
  await prisma.user.update({ where: { id: pendingUser.id }, data: { companyId: pendingCompany.id } });
  await prisma.organizationMember.create({ data: { companyId: pendingCompany.id, userId: pendingUser.id, role: 'OWNER' } });
  t.after(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ companyId: pendingCompany.id }, { targetId: pendingCompany.id }, { userId: pendingUser.id }] } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: pendingUser.id }, { message: { contains: String(run) } }, { title: { contains: String(run) } }] } });
    await prisma.organizationMember.deleteMany({ where: { companyId: pendingCompany.id } });
    await prisma.user.update({ where: { id: pendingUser.id }, data: { companyId: null } });
    await prisma.company.delete({ where: { id: pendingCompany.id } });
    await prisma.user.delete({ where: { id: pendingUser.id } });
    await prisma.$disconnect();
  });
  const pendingOrgToken = await getToken(pendingUser.email);
  const customerToken = await getToken('customer@ticketledger.pk');

  let pendingCompanyId = '';

  await t.test('1. Pending organizer retrieves their company status', async () => {
    const res = await fetch(`${baseUrl}/companies/my-company`, {
      headers: { Authorization: `Bearer ${pendingOrgToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.company.status, 'PENDING');
    assert.strictEqual(body.data.company.companyName, pendingCompany.companyName);
    pendingCompanyId = body.data.company.id;
  });

  await t.test('2. Unapproved organizer blocked from event creation guard', async () => {
    const res = await fetch(`${baseUrl}/companies/guard-check`, {
      headers: { Authorization: `Bearer ${pendingOrgToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.code, 'COMPANY_NOT_APPROVED');
  });

  await t.test('3. Approved organizer passes event creation guard', async () => {
    const res = await fetch(`${baseUrl}/companies/guard-check`, {
      headers: { Authorization: `Bearer ${approvedOrgToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.match(body.message, /fully APPROVED/i);
  });

  await t.test('4. Super Admin lists all companies and status counts', async () => {
    const res = await fetch(`${baseUrl}/companies/admin/all`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(body.data.companies.length >= 2);
    assert.ok(body.data.counts.pending >= 1);
    assert.ok(body.data.counts.approved >= 1);
  });

  await t.test('5. Non-admin blocked from admin company routes', async () => {
    const res = await fetch(`${baseUrl}/companies/admin/all`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test('6. Super Admin cannot reject without providing a reason', async () => {
    const res = await fetch(`${baseUrl}/companies/admin/${pendingCompanyId}/status`, {
      method: 'PATCH',
      headers: { 
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'REJECTED' }),
    });
    assert.strictEqual(res.status, 400);
  });

  await t.test('7. Super Admin rejects pending company with reason', async () => {
    const res = await fetch(`${baseUrl}/companies/admin/${pendingCompanyId}/status`, {
      method: 'PATCH',
      headers: { 
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        status: 'REJECTED', 
        rejectionReason: 'CNIC copy is blurry. Please upload clear front/back scan.' 
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.company.status, 'REJECTED');
    assert.strictEqual(body.data.company.rejectionReason, 'CNIC copy is blurry. Please upload clear front/back scan.');
  });

  await t.test('8. Rejected organizer resubmits corrected registration', async () => {
    const res = await fetch(`${baseUrl}/companies/register`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${pendingOrgToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companyName: `${pendingCompany.companyName} (Updated)`,
        ownerName: 'Fahad Salman',
        phone: '+923001234566',
        email: pendingCompany.email,
        city: 'Karachi',
        ntnCnic: '42101-9876543-1',
        documentUrl: '/uploads/company_docs/clear_cnic_scan.pdf',
      }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.data.company.status, 'PENDING');
    assert.strictEqual(body.data.company.rejectionReason, null);
  });

  await t.test('9. Super Admin approves company registration', async () => {
    const res = await fetch(`${baseUrl}/companies/admin/${pendingCompanyId}/status`, {
      method: 'PATCH',
      headers: { 
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.company.status, 'APPROVED');
  });

  await t.test('10. Newly approved organizer now passes event creation guard', async () => {
    const res = await fetch(`${baseUrl}/companies/guard-check`, {
      headers: { Authorization: `Bearer ${pendingOrgToken}` },
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.match(body.message, /fully APPROVED/i);
  });

  await new Promise((resolve) => server.close(resolve));
});
