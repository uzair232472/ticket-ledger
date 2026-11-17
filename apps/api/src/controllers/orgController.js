import { z } from 'zod';
import { AccessError, ROLES, ROLE_LABELS, effectivePermissions } from '../services/orgAccess.js';
import * as org from '../services/orgService.js';
import * as profile from '../services/orgProfileService.js';
import * as discounts from '../services/discountService.js';
import * as recovery from '../services/recoveryService.js';
import * as checkout from '../services/checkoutSettingsService.js';
import * as payouts from '../services/payoutService.js';

const role = z.enum(ROLES);
const perms = z.array(z.string().max(40)).max(40);
const ids = z.array(z.string().min(1).max(64)).max(200);

const fail = (res, error, fallback) => {
  if (error instanceof AccessError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid request' });
  if (error?.code === 'P2002') return res.status(409).json({ success: false, message: 'This person already belongs to an organization.' });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};
const handle = (fallback, fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (error) {
    return fail(res, error, fallback);
  }
};

/** GET /api/org/me: my organization, role, permissions and event scope (null when I have none). */
export const me = handle('Could not load your organization.', async (req, res) => {
  const ctx = req.org;
  if (!ctx) return res.json({ success: true, data: { organization: null } });
  res.json({
    success: true,
    data: {
      organization: { id: ctx.companyId, name: ctx.company.companyName, status: ctx.company.status },
      memberId: ctx.memberId || null,
      role: ctx.role,
      roleLabel: ROLE_LABELS[ctx.role] || 'TicketLedger admin',
      permissions: [...ctx.permissions],
      eventScoped: ctx.eventScoped,
      eventIds: ctx.eventIds,
    },
  });
});

export const roles = handle('Could not load roles.', async (req, res) => res.json({ success: true, data: org.roleCatalog() }));

export const listMembers = handle('Could not load members.', async (req, res) => {
  const status = z.enum(['ACTIVE', 'DEACTIVATED', 'REMOVED']).optional().parse(req.query.status);
  res.json({ success: true, data: { members: await org.listMembers(req.org, { status }) } });
});
export const getMember = handle('Could not load this member.', async (req, res) => res.json({ success: true, data: { member: await org.getMember(req.org, req.params.id) } }));

export const updateMember = handle('Could not update this member.', async (req, res) => {
  const body = z.object({ role: role.optional(), grantedPermissions: perms.optional(), revokedPermissions: perms.optional() }).parse(req.body);
  res.json({ success: true, message: 'Member updated.', data: { member: await org.updateMember(req, req.org, req.params.id, body) } });
});
export const setMemberEvents = handle('Could not change this member’s events.', async (req, res) => {
  const { eventIds } = z.object({ eventIds: ids }).parse(req.body);
  res.json({ success: true, message: 'Events updated.', data: { member: await org.setMemberEvents(req, req.org, req.params.id, eventIds) } });
});
const reasonBody = z.object({ reason: z.string().trim().max(500).optional() });
export const deactivateMember = handle('Could not deactivate this member.', async (req, res) => {
  const { reason } = reasonBody.parse(req.body || {});
  res.json({ success: true, message: 'Member deactivated. Their TicketLedger account stays active.', data: { member: await org.deactivateMember(req, req.org, req.params.id, reason) } });
});
export const reactivateMember = handle('Could not reactivate this member.', async (req, res) => {
  res.json({ success: true, message: 'Member reactivated.', data: { member: await org.reactivateMember(req, req.org, req.params.id) } });
});
export const removeMember = handle('Could not remove this member.', async (req, res) => {
  const { reason } = reasonBody.parse(req.body || {});
  res.json({ success: true, message: 'Member removed. Their history is kept.', data: await org.removeMember(req, req.org, req.params.id, reason) });
});
export const transferOwnership = handle('Could not transfer ownership.', async (req, res) => {
  const body = z.object({ memberId: z.string().min(1), password: z.string().min(1, 'Enter your password to confirm.'), stepDown: z.boolean().optional() }).parse(req.body);
  res.json({ success: true, message: 'Ownership transferred.', data: { members: await org.transferOwnership(req, req.org, body) } });
});

export const listInvitations = handle('Could not load invitations.', async (req, res) => {
  const status = z.enum(['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'REVOKED']).optional().parse(req.query.status);
  res.json({ success: true, data: { invitations: await org.listInvitations(req.org, { status }) } });
});
export const createInvitation = handle('Could not send the invitation.', async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email('Invalid email address'), role, eventIds: ids.optional(), grantedPermissions: perms.optional(), revokedPermissions: perms.optional() }).parse(req.body);
  const out = await org.createInvitation(req, req.org, body);
  res.status(201).json({ success: true, message: out.emailSent ? `Invitation sent to ${body.email}.` : `Invitation created, but the email to ${body.email} could not be sent. Try resending.`, data: out });
});
export const resendInvitation = handle('Could not resend the invitation.', async (req, res) => {
  const out = await org.resendInvitation(req, req.org, req.params.id);
  res.json({ success: true, message: out.emailSent ? `Invitation resent to ${out.invite.email}.` : 'The email could not be sent. Please try again.', data: out });
});
export const revokeInvitation = handle('Could not revoke the invitation.', async (req, res) => res.json({ success: true, message: 'Invitation revoked. Its link no longer works.', data: await org.revokeInvitation(req, req.org, req.params.id) }));

export const activity = handle('Could not load activity.', async (req, res) => {
  const q = z.object({ memberId: z.string().optional(), action: z.string().max(60).optional(), from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().optional(), limit: z.coerce.number().optional(), format: z.enum(['json', 'csv']).optional() }).parse(req.query);
  const data = await org.listActivity(req.org, q);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="organization-activity.csv"');
    return res.send(org.activityCsv(data.items));
  }
  res.json({ success: true, data });
});

// ── Profile ────────────────────────────────────────────────────────────────────────────────────────────

const optText = (max) => z.string().trim().max(max).optional().transform((v) => (v === '' ? null : v)).nullable();
const optEmail = z.union([z.literal(''), z.string().trim().toLowerCase().email('Invalid email address')]).optional().nullable().transform((v) => (v === '' ? null : v));
const optUrl = z.union([z.literal(''), z.string().trim().url('Enter a full web address, like https://example.com').max(300)]).optional().nullable().transform((v) => (v === '' ? null : v));
const phone = z.string().trim().regex(/^[+\d][\d\s-]{7,19}$/, 'Enter a valid phone number');

export const getProfile = handle('Could not load the organization profile.', async (req, res) => res.json({ success: true, data: { profile: await profile.getProfile(req.org) } }));
export const updateProfile = handle('Could not save the organization profile.', async (req, res) => {
  const body = z.object({
    companyName: z.string().trim().min(2).max(120).optional(),
    ownerName: z.string().trim().min(2).max(120).optional(),
    ntnCnic: z.string().trim().min(5).max(30).optional(),
    phone: phone.optional(),
    email: z.string().trim().toLowerCase().email('Invalid email address').optional(),
    city: z.string().trim().min(2).max(60).optional(),
    description: optText(2000),
    website: optUrl,
    logoUrl: optUrl,
    address: optText(300),
    supportEmail: optEmail,
    supportPhone: z.union([z.literal(''), phone]).optional().nullable().transform((v) => (v === '' ? null : v)),
  }).parse(req.body || {});
  res.json({ success: true, message: 'Organization profile saved.', data: { profile: await profile.updateProfile(req, req.org, body, req.file) } });
});

// ── Documents ──────────────────────────────────────────────────────────────────────────────────────────

const docType = z.enum(profile.DOCUMENT_TYPES);
const optDate = z.union([z.literal(''), z.coerce.date()]).optional().nullable().transform((v) => (v === '' ? null : v));

export const listDocuments = handle('Could not load documents.', async (req, res) => {
  const archived = req.query.archived === 'true';
  res.json({ success: true, data: { documents: await profile.listDocuments(req.org, { archived }), types: profile.DOCUMENT_TYPES.map((t) => ({ value: t, label: profile.DOCUMENT_TYPE_LABELS[t] })) } });
});
export const uploadDocuments = handle('Could not upload the documents.', async (req, res) => {
  const body = z.object({ type: docType.default('OTHER'), title: z.string().trim().max(120).optional(), expiresAt: optDate, notes: z.string().trim().max(500).optional() }).parse(req.body || {});
  const documents = await profile.uploadDocuments(req, req.org, req.files || [], body);
  res.status(201).json({ success: true, message: `${documents.length} document${documents.length === 1 ? '' : 's'} uploaded.`, data: { documents } });
});
export const updateDocument = handle('Could not update the document.', async (req, res) => {
  const body = z.object({ type: docType.optional(), title: z.string().trim().min(1).max(120).optional(), expiresAt: optDate, notes: optText(500) }).parse(req.body || {});
  res.json({ success: true, message: 'Document updated.', data: { document: await profile.updateDocument(req, req.org, req.params.id, body) } });
});
export const archiveDocument = handle('Could not archive the document.', async (req, res) => res.json({ success: true, message: 'Document archived. You can restore it from Archived.', data: { document: await profile.setDocumentArchived(req, req.org, req.params.id, true) } }));
export const restoreDocument = handle('Could not restore the document.', async (req, res) => res.json({ success: true, message: 'Document restored.', data: { document: await profile.setDocumentArchived(req, req.org, req.params.id, false) } }));

// ── Payout & tax details ───────────────────────────────────────────────────────────────────────────────

export const getFinance = handle('Could not load payout details.', async (req, res) => res.json({ success: true, data: { finance: await profile.getFinance(req, req.org, { reveal: req.query.reveal === 'true' }) } }));
export const updateFinance = handle('Could not save payout details.', async (req, res) => {
  const body = z.object({
    password: z.string().min(1, 'Enter your password to confirm.'),
    payoutMethod: z.enum(profile.PAYOUT_METHODS).optional(),
    payoutSchedule: z.enum(profile.PAYOUT_SCHEDULES).optional(),
    accountTitle: z.string().trim().min(2, 'Enter the account title').max(120).optional(),
    bankName: optText(120),
    bankBranchCode: optText(20),
    iban: z.string().trim().max(40).optional(),
    walletNumber: z.string().trim().max(20).optional(),
    taxNtn: optText(30),
    salesTaxNumber: optText(30),
    taxFiler: z.boolean().optional(),
    billingEmail: optEmail,
    billingAddress: optText(300),
  }).parse(req.body || {});
  const finance = await profile.updateFinance(req, req.org, body);
  res.json({ success: true, message: finance.status === 'PENDING' ? 'Payout details saved. TicketLedger will check them before the next payout.' : 'Payout details saved.', data: { finance } });
});

// ── Branches ───────────────────────────────────────────────────────────────────────────────────────────

const branchBody = (partial) => {
  const shape = z.object({
    name: z.string().trim().min(2, 'Enter the branch name').max(80),
    city: z.string().trim().min(2, 'Enter the city').max(60),
    address: optText(300),
    phone: z.union([z.literal(''), phone]).optional().nullable().transform((v) => (v === '' ? null : v)),
    email: optEmail,
    managerUserId: z.string().max(64).optional().nullable().transform((v) => v || null),
    isHeadOffice: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  });
  return partial ? shape.partial() : shape;
};
export const listBranches = handle('Could not load branches.', async (req, res) => res.json({ success: true, data: { branches: await profile.listBranches(req.org) } }));
export const createBranch = handle('Could not add the branch.', async (req, res) => res.status(201).json({ success: true, message: 'Branch added.', data: { branch: await profile.createBranch(req, req.org, branchBody(false).parse(req.body || {})) } }));
export const updateBranch = handle('Could not update the branch.', async (req, res) => res.json({ success: true, message: 'Branch updated.', data: { branch: await profile.updateBranch(req, req.org, req.params.id, branchBody(true).parse(req.body || {})) } }));
export const deleteBranch = handle('Could not delete the branch.', async (req, res) => res.json({ success: true, message: 'Branch deleted.', data: await profile.deleteBranch(req, req.org, req.params.id) }));
export const setEventBranch = handle('Could not change the event’s branch.', async (req, res) => {
  const { branchId } = z.object({ branchId: z.string().max(64).nullable() }).parse(req.body || {});
  res.json({ success: true, message: branchId ? 'Event assigned to the branch.' : 'Event removed from its branch.', data: await profile.setEventBranch(req, req.org, req.params.eventId, branchId) });
});

// ── Discount codes ─────────────────────────────────────────────────────────────────────────────────────

const discountFields = {
  description: optText(200),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.coerce.number().positive('Enter the discount'),
  maxRedemptions: z.coerce.number().int().min(1).max(1000000).nullable().optional(),
  perUserLimit: z.coerce.number().int().min(1).max(100).optional(),
  minTickets: z.coerce.number().int().min(1).max(10).optional(),
  startsAt: optDate,
  endsAt: optDate,
  active: z.boolean().optional(),
};
export const listDiscounts = handle('Could not load discount codes.', async (req, res) => {
  const q = z.object({ source: z.enum(['MANUAL', 'CART_RECOVERY']).optional(), eventId: z.string().max(64).optional() }).parse(req.query);
  res.json({ success: true, data: { codes: await discounts.listCodes(req.org, q), maxPercent: discounts.MAX_PERCENT } });
});
export const createDiscount = handle('Could not create the code.', async (req, res) => {
  const body = z.object({ code: z.string().trim().min(3, 'Codes are at least 3 characters').max(32), eventId: z.string().max(64).optional().nullable().transform((v) => v || null), ...discountFields }).parse(req.body || {});
  res.status(201).json({ success: true, message: `Code ${discounts.normalizeCode(body.code)} created.`, data: { code: await discounts.createCode(req, req.org, body) } });
});
export const updateDiscount = handle('Could not update the code.', async (req, res) => {
  const body = z.object(discountFields).partial().parse(req.body || {});
  res.json({ success: true, message: 'Code updated.', data: { code: await discounts.updateCode(req, req.org, req.params.id, body) } });
});
export const deleteDiscount = handle('Could not delete the code.', async (req, res) => {
  const out = await discounts.deleteCode(req, req.org, req.params.id);
  res.json({ success: true, message: out.deleted ? 'Code deleted.' : 'This code has been used, so it was turned off instead of deleted.', data: out });
});

// ── Automatic abandoned-checkout reminders ─────────────────────────────────────────────────────────────

export const getRecovery = handle('Could not load reminder settings.', async (req, res) => res.json({ success: true, data: await recovery.getSettings(req.org) }));
export const updateRecovery = handle('Could not save reminder settings.', async (req, res) => {
  const body = z.object({
    recoveryEnabled: z.boolean().optional(),
    recoveryDelayHours: z.coerce.number().int().optional(),
    recoveryDiscountPercent: z.coerce.number().int().optional(),
    recoveryValidHours: z.coerce.number().int().min(1).max(168).optional(),
  }).parse(req.body || {});
  res.json({ success: true, message: 'Reminder settings saved.', data: await recovery.updateSettings(req, req.org, body) });
});

// ── Checkout settings ──────────────────────────────────────────────────────────────────────────────────

export const getCheckout = handle('Could not load checkout settings.', async (req, res) => res.json({ success: true, data: await checkout.getSettings(req.org) }));
export const updateCheckoutFees = handle('Could not save fees and tax.', async (req, res) => {
  const body = z.object({
    serviceFeeType: z.enum(['NONE', 'PERCENT', 'PER_TICKET']).optional(),
    serviceFeeValue: z.coerce.number().min(0).optional(),
    taxPercent: z.coerce.number().min(0).optional(),
    taxLabel: z.string().trim().min(2).max(40).optional(),
    taxRegistrationNumber: optText(40),
  }).parse(req.body || {});
  res.json({ success: true, message: 'Fees and tax saved. They apply to new checkouts.', data: await checkout.updateFees(req, req.org, body) });
});
const optInt = z.union([z.literal(''), z.null(), z.coerce.number().int()]).optional().transform((v) => (v === '' ? null : v));
export const updateEventCheckoutRules = handle('Could not save the event rules.', async (req, res) => {
  const body = z.object({
    maxTicketsPerCustomer: optInt,
    groupMinTickets: optInt,
    groupDiscountPercent: optInt,
    allowSeatChanges: z.boolean().optional(),
    seatChangeCutoffHours: z.coerce.number().int().optional(),
  }).parse(req.body || {});
  res.json({ success: true, message: 'Event checkout rules saved.', data: await checkout.updateEventRules(req, req.org, req.params.eventId, body) });
});

export const listPayouts = handle('Could not load payouts.', async (req, res) => res.json({ success: true, data: await payouts.orgPayouts(req.org) }));

export { effectivePermissions };
