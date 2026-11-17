import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { uploadFile } from '../utils/storage.js';
import { AccessError } from './orgAccess.js';
import { orgAudit } from './orgService.js';
import { notifyAdmins } from './notificationService.js';
import { decryptSecret, encryptSecret, last4, masked } from './financeCrypto.js';

/*
 * Organization profile, document library, payout & tax details and branches. Every function takes the actor's
 * organization context (`ctx` from loadOrgContext) and is scoped to ctx.companyId. Changes are written to the
 * organization's activity history (orgAudit).
 *
 * The verified identity (legal name, owner name, NTN/CNIC) is locked once TicketLedger approved the company;
 * the public profile (description, website, logo, address, contacts) can be changed at any time.
 */

const isApproved = (company) => company.status === 'APPROVED';
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const diff = (before, after) => {
  const changed = Object.keys(after).filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
  return { before: pick(before, changed), after: pick(after, changed), changed };
};

async function assertPassword(req, password) {
  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!password || !me || !(await bcrypt.compare(String(password), me.passwordHash))) throw new AccessError(401, 'Your password is incorrect.');
}

/** Owners of the organization (in-app notices about sensitive changes). */
async function notifyOwners(db, companyId, { type, title, message, link }) {
  const owners = await db.organizationMember.findMany({ where: { companyId, role: 'OWNER', status: 'ACTIVE' }, select: { userId: true } });
  if (owners.length) await db.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, type, title, message, link: link || null })) });
}

// ── Profile ────────────────────────────────────────────────────────────────────────────────────────────

export const IDENTITY_FIELDS = ['companyName', 'ownerName', 'ntnCnic'];
export const PROFILE_FIELDS = ['phone', 'email', 'city', 'description', 'website', 'logoUrl', 'address', 'supportEmail', 'supportPhone'];

function serializeProfile(c, { withIdentity }) {
  const out = {
    id: c.id,
    companyName: c.companyName,
    status: c.status,
    ownerName: c.ownerName,
    phone: c.phone,
    email: c.email,
    city: c.city,
    description: c.description,
    website: c.website,
    logoUrl: c.logoUrl,
    address: c.address,
    supportEmail: c.supportEmail,
    supportPhone: c.supportPhone,
    reviewedAt: c.reviewedAt,
    createdAt: c.createdAt,
    identityLocked: isApproved(c),
  };
  if (withIdentity) out.ntnCnic = c.ntnCnic;
  return out;
}

export async function getProfile(ctx) {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  if (!c) throw new AccessError(404, 'Organization not found.');
  return serializeProfile(c, { withIdentity: ctx.superAdmin || ctx.permissions.has('org.settings') });
}

export async function updateProfile(req, ctx, input, logoFile) {
  const c = await prisma.company.findUnique({ where: { id: ctx.companyId } });
  if (!c) throw new AccessError(404, 'Organization not found.');
  const wanted = pick(input, [...PROFILE_FIELDS, ...IDENTITY_FIELDS]);
  const identityChanges = IDENTITY_FIELDS.filter((k) => wanted[k] !== undefined && wanted[k] !== c[k]);
  // Super Admins may correct a verified identity; members ask TicketLedger to
  if (identityChanges.length && isApproved(c) && !ctx.superAdmin) {
    throw new AccessError(409, `Your ${identityChanges.map((k) => ({ companyName: 'legal name', ownerName: 'owner name', ntnCnic: 'NTN / CNIC' })[k]).join(', ')} was verified by TicketLedger and can't be changed here. Contact TicketLedger support to change it.`);
  }
  if (logoFile) wanted.logoUrl = (await uploadFile(logoFile, 'company_logos')).url;
  const { before, after, changed } = diff(c, wanted);
  if (!changed.length) return serializeProfile(c, { withIdentity: true });
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.company.update({ where: { id: c.id }, data: after });
    await orgAudit(tx, { req, ctx, action: 'ORG_PROFILE_UPDATED', targetType: 'Company', targetId: c.id, before, after });
    return u;
  });
  return serializeProfile(updated, { withIdentity: true });
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────────────

export const MAX_ACTIVE_DOCUMENTS = 50;
export const DOCUMENT_TYPES = ['VERIFICATION', 'NTN_CERTIFICATE', 'FBR_REGISTRATION', 'CNIC', 'BUSINESS_LICENSE', 'BANK_LETTER', 'CONTRACT', 'INSURANCE', 'VENUE_PERMIT', 'OTHER'];
export const DOCUMENT_TYPE_LABELS = {
  VERIFICATION: 'Verification document',
  NTN_CERTIFICATE: 'NTN certificate',
  FBR_REGISTRATION: 'FBR registration',
  CNIC: 'CNIC',
  BUSINESS_LICENSE: 'Business licence',
  BANK_LETTER: 'Bank letter',
  CONTRACT: 'Contract',
  INSURANCE: 'Insurance',
  VENUE_PERMIT: 'Venue permit / NOC',
  OTHER: 'Other',
};

async function withUploaders(docs) {
  const ids = [...new Set(docs.flatMap((d) => [d.uploadedById, d.archivedById]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const now = Date.now();
  return docs.map((d) => ({
    ...d,
    typeLabel: DOCUMENT_TYPE_LABELS[d.type],
    uploadedBy: d.uploadedById ? { id: d.uploadedById, name: name[d.uploadedById] || null } : null,
    archivedBy: d.archivedById ? { id: d.archivedById, name: name[d.archivedById] || null } : null,
    expired: Boolean(d.expiresAt && new Date(d.expiresAt).getTime() < now),
    expiresSoon: Boolean(d.expiresAt && new Date(d.expiresAt).getTime() >= now && new Date(d.expiresAt).getTime() < now + 30 * 86400000),
  }));
}

export async function listDocuments(ctx, { archived = false } = {}) {
  const docs = await prisma.companyDocument.findMany({
    where: { companyId: ctx.companyId, archivedAt: archived ? { not: null } : null },
    orderBy: [{ createdAt: 'desc' }],
  });
  return withUploaders(docs);
}

export async function uploadDocuments(req, ctx, files, { type = 'OTHER', title, expiresAt, notes }) {
  if (!files?.length) throw new AccessError(400, 'Choose at least one file to upload.');
  if (!DOCUMENT_TYPES.includes(type)) throw new AccessError(400, 'Unknown document type.');
  const active = await prisma.companyDocument.count({ where: { companyId: ctx.companyId, archivedAt: null } });
  if (active + files.length > MAX_ACTIVE_DOCUMENTS) throw new AccessError(409, `An organization can keep up to ${MAX_ACTIVE_DOCUMENTS} active documents. Archive some first.`);
  const uploaded = [];
  for (const file of files) uploaded.push({ file, url: (await uploadFile(file, 'company_docs')).url });
  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const [i, { file, url }] of uploaded.entries()) {
      const docTitle = (title && files.length > 1 ? `${title} (${i + 1})` : title) || file.originalname?.slice(0, 120) || DOCUMENT_TYPE_LABELS[type];
      const doc = await tx.companyDocument.create({
        data: { companyId: ctx.companyId, type, title: docTitle, url, mimeType: file.mimetype, sizeBytes: file.size, expiresAt: expiresAt || null, notes: notes || null, uploadedById: req.user.id },
      });
      await orgAudit(tx, { req, ctx, action: 'ORG_DOCUMENT_UPLOADED', targetType: 'CompanyDocument', targetId: doc.id, details: { title: doc.title, type, sizeBytes: file.size } });
      rows.push(doc);
    }
    return rows;
  });
  return withUploaders(created);
}
async function loadDocument(db, ctx, id) {
  const doc = await db.companyDocument.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!doc) throw new AccessError(404, 'Document not found.');
  return doc;
}

export async function updateDocument(req, ctx, id, input) {
  const doc = await loadDocument(prisma, ctx, id);
  if (input.type && !DOCUMENT_TYPES.includes(input.type)) throw new AccessError(400, 'Unknown document type.');
  const wanted = pick(input, ['title', 'type', 'expiresAt', 'notes']);
  const { before, after, changed } = diff(doc, wanted);
  if (!changed.length) return (await withUploaders([doc]))[0];
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.companyDocument.update({ where: { id }, data: after });
    await orgAudit(tx, { req, ctx, action: 'ORG_DOCUMENT_UPDATED', targetType: 'CompanyDocument', targetId: id, before, after, details: { title: u.title } });
    return u;
  });
  return (await withUploaders([updated]))[0];
}

/** Archive (hide, keep) or restore a document. Verification documents stay on the registration record too. */
export async function setDocumentArchived(req, ctx, id, archived) {
  const doc = await loadDocument(prisma, ctx, id);
  if (Boolean(doc.archivedAt) === archived) return (await withUploaders([doc]))[0];
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.companyDocument.update({ where: { id }, data: archived ? { archivedAt: new Date(), archivedById: req.user.id } : { archivedAt: null, archivedById: null } });
    await orgAudit(tx, { req, ctx, action: archived ? 'ORG_DOCUMENT_ARCHIVED' : 'ORG_DOCUMENT_RESTORED', targetType: 'CompanyDocument', targetId: id, details: { title: doc.title, type: doc.type } });
    return u;
  });
  return (await withUploaders([updated]))[0];
}

// ── Payout & tax details ───────────────────────────────────────────────────────────────────────────────

export const PAYOUT_METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA'];
export const PAYOUT_SCHEDULES = ['AFTER_EVENT', 'WEEKLY', 'MONTHLY'];
const FINANCE_PLAIN_FIELDS = ['payoutMethod', 'payoutSchedule', 'accountTitle', 'bankName', 'bankBranchCode', 'taxNtn', 'salesTaxNumber', 'taxFiler', 'billingEmail', 'billingAddress'];
// A change to any of these sends the details back to TicketLedger for checking (they decide where money goes)
const PAYOUT_DESTINATION_FIELDS = ['payoutMethod', 'accountTitle', 'bankName', 'bankBranchCode']; // and the IBAN / wallet number

/** PK IBAN: PK + 2 check digits + 4-letter bank code + 16 digits (24 characters), with a valid mod-97 checksum. */
export function validIban(value) {
  const iban = String(value || '').replace(/\s/g, '').toUpperCase();
  if (!/^PK\d{2}[A-Z]{4}\d{16}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const digit of numeric) rem = (rem * 10 + Number(digit)) % 97;
  return rem === 1;
}

function serializeFinance(f, { reveal = false } = {}) {
  if (!f) return { status: 'UNVERIFIED', configured: false };
  const out = {
    configured: true,
    payoutMethod: f.payoutMethod,
    payoutSchedule: f.payoutSchedule,
    accountTitle: f.accountTitle,
    bankName: f.bankName,
    bankBranchCode: f.bankBranchCode,
    iban: masked(f.ibanLast4),
    walletNumber: masked(f.walletLast4),
    taxNtn: f.taxNtn,
    salesTaxNumber: f.salesTaxNumber,
    taxFiler: f.taxFiler,
    billingEmail: f.billingEmail,
    billingAddress: f.billingAddress,
    status: f.status,
    reviewNote: f.reviewNote,
    reviewedAt: f.reviewedAt,
    updatedAt: f.updatedAt,
  };
  if (reveal) {
    out.iban = decryptSecret(f.ibanEncrypted);
    out.walletNumber = decryptSecret(f.walletEncrypted);
  }
  return out;
}

export async function getFinance(req, ctx, { reveal = false } = {}) {
  const f = await prisma.companyFinancialProfile.findUnique({ where: { companyId: ctx.companyId } });
  if (reveal) {
    if (!ctx.superAdmin && !ctx.permissions.has('finance.manage')) throw new AccessError(403, "You don't have permission to see full account numbers (finance.manage).");
    await orgAudit(prisma, { req, ctx, action: 'ORG_FINANCE_REVEALED', targetType: 'CompanyFinancialProfile', targetId: f?.id || null });
  }
  return serializeFinance(f, { reveal });
}

/**
 * Saves payout & tax details. Needs the actor's password. Account / wallet numbers are only replaced when a new
 * value is sent (the masked value is never sent back). Changing where money goes puts the details back to
 * PENDING for TicketLedger to check, and tells the owners and the admins.
 */
export async function updateFinance(req, ctx, input) {
  await assertPassword(req, input.password);
  const current = await prisma.companyFinancialProfile.findUnique({ where: { companyId: ctx.companyId } });
  const data = pick(input, FINANCE_PLAIN_FIELDS);
  const method = data.payoutMethod || current?.payoutMethod || 'BANK_TRANSFER';

  let iban;
  let wallet;
  if (input.iban) {
    iban = String(input.iban).replace(/\s/g, '').toUpperCase();
    if (!validIban(iban)) throw new AccessError(400, 'Enter a valid Pakistani IBAN (24 characters, starting with PK).');
  }
  if (input.walletNumber) {
    wallet = String(input.walletNumber).replace(/\D/g, '');
    if (wallet.length === 12 && wallet.startsWith('92')) wallet = `0${wallet.slice(2)}`;
    if (!/^03\d{9}$/.test(wallet)) throw new AccessError(400, 'Enter the wallet number as 03XXXXXXXXX.');
  }

  // The destination for the chosen method must be complete
  const hasIban = iban || current?.ibanEncrypted;
  const hasWallet = wallet || current?.walletEncrypted;
  const title = data.accountTitle ?? current?.accountTitle;
  if (!title) throw new AccessError(400, 'Enter the account title (the name the account is registered to).');
  if (method === 'BANK_TRANSFER' && (!hasIban || !(data.bankName ?? current?.bankName))) throw new AccessError(400, 'Bank transfers need the bank name and IBAN.');
  if (method !== 'BANK_TRANSFER' && !hasWallet) throw new AccessError(400, `${method === 'JAZZCASH' ? 'JazzCash' : 'EasyPaisa'} payouts need the wallet number.`);

  if (iban) Object.assign(data, { ibanEncrypted: encryptSecret(iban), ibanLast4: last4(iban) });
  if (wallet) Object.assign(data, { walletEncrypted: encryptSecret(wallet), walletLast4: last4(wallet) });

  const destinationChanged = !current
    || Boolean(iban && decryptSecret(current.ibanEncrypted) !== iban)
    || Boolean(wallet && decryptSecret(current.walletEncrypted) !== wallet)
    || PAYOUT_DESTINATION_FIELDS.some((k) => data[k] !== undefined && String(data[k] ?? '') !== String(current[k] ?? ''));
  if (destinationChanged) Object.assign(data, { status: 'PENDING', reviewNote: null, reviewedById: null, reviewedAt: null });
  data.updatedById = req.user.id;

  // What changed, for the activity history (account numbers only as their last 4 digits)
  const shown = (f) => f && { ...pick(f, FINANCE_PLAIN_FIELDS), iban: masked(f.ibanLast4), walletNumber: masked(f.walletLast4), status: f.status };
  const saved = await prisma.$transaction(async (tx) => {
    const f = current
      ? await tx.companyFinancialProfile.update({ where: { companyId: ctx.companyId }, data })
      : await tx.companyFinancialProfile.create({ data: { companyId: ctx.companyId, ...data } });
    const { before, after } = diff(shown(current) || {}, shown(f));
    await orgAudit(tx, { req, ctx, action: 'ORG_FINANCE_UPDATED', targetType: 'CompanyFinancialProfile', targetId: f.id, before, after, details: { destinationChanged } });
    if (destinationChanged) {
      const company = await tx.company.findUnique({ where: { id: ctx.companyId }, select: { companyName: true } });
      await notifyOwners(tx, ctx.companyId, {
        type: 'ORG_FINANCE_CHANGED',
        title: 'Payout details changed',
        message: `${req.user.name || req.user.email} changed where ${company.companyName}'s payouts go (now ${f.payoutMethod === 'BANK_TRANSFER' ? `${f.bankName} ${masked(f.ibanLast4)}` : `${f.payoutMethod} ${masked(f.walletLast4)}`}). If this wasn't expected, check the organization's activity history.`,
        link: '/organizer/organization?tab=finance',
      });
      await notifyAdmins({
        type: 'ADMIN_FINANCE_REVIEW_REQUEST',
        title: `Payout details to check: ${company.companyName}`,
        message: `${company.companyName} ${current ? 'changed' : 'added'} its payout details. Check and verify them before the next payout.`,
        link: '/admin/companies',
      }, tx);
    }
    return f;
  });
  return serializeFinance(saved);
}

/** Super Admin: verify or reject an organization's payout details. */
export async function reviewFinance(req, companyId, { status, note }) {
  if (!['VERIFIED', 'REJECTED'].includes(status)) throw new AccessError(400, 'Choose VERIFIED or REJECTED.');
  if (status === 'REJECTED' && !note) throw new AccessError(400, 'Say why the payout details were rejected.');
  const f = await prisma.companyFinancialProfile.findUnique({ where: { companyId }, include: { company: { select: { companyName: true } } } });
  if (!f) throw new AccessError(404, 'This organization has no payout details yet.');
  const ctx = { companyId, role: 'SUPER_ADMIN' };
  const saved = await prisma.$transaction(async (tx) => {
    const u = await tx.companyFinancialProfile.update({ where: { companyId }, data: { status, reviewNote: note || null, reviewedById: req.user.id, reviewedAt: new Date() } });
    await orgAudit(tx, { req, ctx, action: `ORG_FINANCE_${status}`, targetType: 'CompanyFinancialProfile', targetId: f.id, before: { status: f.status }, after: { status }, details: { note: note || null } });
    await notifyOwners(tx, companyId, {
      type: 'ORG_FINANCE_REVIEWED',
      title: status === 'VERIFIED' ? 'Payout details verified' : 'Payout details rejected',
      message: status === 'VERIFIED' ? `TicketLedger verified ${f.company.companyName}'s payout details.` : `TicketLedger could not verify ${f.company.companyName}'s payout details: ${note}`,
      link: '/organizer/organization?tab=finance',
    });
    return u;
  });
  return serializeFinance(saved);
}

/** Super Admin list of payout details waiting for a check. */
export async function pendingFinanceReviews() {
  const rows = await prisma.companyFinancialProfile.findMany({ where: { status: 'PENDING' }, include: { company: { select: { id: true, companyName: true, city: true } } }, orderBy: { updatedAt: 'asc' } });
  return rows.map((f) => ({ company: f.company, ...serializeFinance(f, { reveal: true }) }));
}

// ── Branches ───────────────────────────────────────────────────────────────────────────────────────────

async function serializeBranches(branches) {
  const managerIds = [...new Set(branches.map((b) => b.managerUserId).filter(Boolean))];
  const managers = managerIds.length ? await prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true, email: true } }) : [];
  const byId = Object.fromEntries(managers.map((m) => [m.id, m]));
  return branches.map(({ events, _count, ...b }) => ({ ...b, manager: b.managerUserId ? byId[b.managerUserId] || null : null, eventCount: _count?.events ?? events?.length ?? 0, events: events || undefined }));
}

export async function listBranches(ctx, { includeInactive = true } = {}) {
  const branches = await prisma.companyBranch.findMany({
    where: { companyId: ctx.companyId, ...(includeInactive ? {} : { status: 'ACTIVE' }) },
    include: { events: { select: { id: true, name: true, date: true, status: true }, orderBy: { date: 'asc' } } },
    orderBy: [{ isHeadOffice: 'desc' }, { name: 'asc' }],
  });
  return serializeBranches(branches);
}

async function loadBranch(db, ctx, id) {
  const b = await db.companyBranch.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!b) throw new AccessError(404, 'Branch not found.');
  return b;
}

/** The manager must be an active member of this organization. */
async function validManager(db, ctx, userId) {
  if (!userId) return null;
  const m = await db.organizationMember.findFirst({ where: { companyId: ctx.companyId, userId, status: 'ACTIVE' }, select: { userId: true } });
  if (!m) throw new AccessError(400, 'The branch manager must be an active member of the organization.');
  return userId;
}

const BRANCH_FIELDS = ['name', 'address', 'city', 'phone', 'email', 'managerUserId', 'isHeadOffice', 'status'];

export async function createBranch(req, ctx, input) {
  const data = pick(input, BRANCH_FIELDS);
  data.managerUserId = await validManager(prisma, ctx, data.managerUserId);
  try {
    const branch = await prisma.$transaction(async (tx) => {
      if (data.isHeadOffice) await tx.companyBranch.updateMany({ where: { companyId: ctx.companyId, isHeadOffice: true }, data: { isHeadOffice: false } });
      const b = await tx.companyBranch.create({ data: { ...data, companyId: ctx.companyId, createdById: req.user.id } });
      await orgAudit(tx, { req, ctx, action: 'ORG_BRANCH_CREATED', targetType: 'CompanyBranch', targetId: b.id, after: pick(b, BRANCH_FIELDS) });
      return b;
    });
    return (await serializeBranches([{ ...branch, events: [] }]))[0];
  } catch (e) {
    if (e.code === 'P2002') throw new AccessError(409, 'A branch with this name already exists.');
    throw e;
  }
}

export async function updateBranch(req, ctx, id, input) {
  const b = await loadBranch(prisma, ctx, id);
  const wanted = pick(input, BRANCH_FIELDS);
  if (wanted.managerUserId !== undefined) wanted.managerUserId = await validManager(prisma, ctx, wanted.managerUserId);
  if (b.isHeadOffice && wanted.isHeadOffice === false) throw new AccessError(409, 'Make another branch the head office instead.');
  if (b.isHeadOffice && wanted.status === 'INACTIVE') throw new AccessError(409, "The head office can't be deactivated. Make another branch the head office first.");
  if (wanted.isHeadOffice && (wanted.status ?? b.status) === 'INACTIVE') throw new AccessError(409, 'An inactive branch cannot be the head office.');
  const { before, after, changed } = diff(b, wanted);
  if (!changed.length) return (await listBranches(ctx)).find((x) => x.id === id);
  try {
    await prisma.$transaction(async (tx) => {
      if (after.isHeadOffice) await tx.companyBranch.updateMany({ where: { companyId: ctx.companyId, isHeadOffice: true, id: { not: id } }, data: { isHeadOffice: false } });
      await tx.companyBranch.update({ where: { id }, data: after });
      await orgAudit(tx, { req, ctx, action: 'ORG_BRANCH_UPDATED', targetType: 'CompanyBranch', targetId: id, before, after, details: { name: b.name } });
    });
  } catch (e) {
    if (e.code === 'P2002') throw new AccessError(409, 'A branch with this name already exists.');
    throw e;
  }
  return (await listBranches(ctx)).find((x) => x.id === id);
}

/** Deletes a branch with no events; one with events must be deactivated instead (they keep their history). */
export async function deleteBranch(req, ctx, id) {
  const b = await loadBranch(prisma, ctx, id);
  if (b.isHeadOffice) throw new AccessError(409, "The head office can't be deleted. Make another branch the head office first.");
  const events = await prisma.event.count({ where: { branchId: id } });
  if (events) throw new AccessError(409, `This branch runs ${events} event${events === 1 ? '' : 's'}. Move them to another branch or deactivate the branch instead.`);
  await prisma.$transaction(async (tx) => {
    await tx.companyBranch.delete({ where: { id } });
    await orgAudit(tx, { req, ctx, action: 'ORG_BRANCH_DELETED', targetType: 'CompanyBranch', targetId: id, before: pick(b, BRANCH_FIELDS) });
  });
  return { deleted: true };
}

/** Assign (or clear, with branchId null) the branch running an event. Only active branches take new events. */
export async function setEventBranch(req, ctx, eventId, branchId) {
  const event = await prisma.event.findFirst({ where: { id: eventId, companyId: ctx.companyId }, select: { id: true, name: true, branchId: true } });
  if (!event) throw new AccessError(404, 'Event not found in your organization.');
  if (ctx.eventScoped && !ctx.eventIds.includes(eventId)) throw new AccessError(403, 'You can only change events you are assigned to.');
  if (branchId) {
    const b = await loadBranch(prisma, ctx, branchId);
    if (b.status !== 'ACTIVE') throw new AccessError(409, 'This branch is inactive. Reactivate it first.');
  }
  if ((event.branchId || null) === (branchId || null)) return { eventId, branchId: branchId || null };
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { branchId: branchId || null } });
    await orgAudit(tx, { req, ctx, action: 'ORG_EVENT_BRANCH_CHANGED', targetType: 'Event', targetId: eventId, before: { branchId: event.branchId }, after: { branchId: branchId || null }, details: { eventName: event.name } });
  });
  return { eventId, branchId: branchId || null };
}
