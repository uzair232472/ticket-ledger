import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { ADMIN_PERMISSIONS, ADMIN_ROLES, ALL_ADMIN, adminPermissionsOf, hasAdmin } from '../services/adminAccess.js';
import * as config from '../services/systemConfig.js';
import * as actions from '../services/adminActions.js';
import * as broadcasts from '../services/broadcastService.js';
import * as exportsSvc from '../services/exportService.js';
import * as cases from '../services/investigationService.js';
import { overview } from '../services/financeOverviewService.js';

const fail = (res, e, fallback) => {
  if (e instanceof z.ZodError) return res.status(400).json({ success: false, message: e.errors[0]?.message || 'Invalid request' });
  if (e instanceof actions.ConfirmationRequired) return res.status(428).json({ success: false, code: e.code, confirmPhrase: e.phrase, message: e.message });
  if (e?.status) return res.status(e.status).json({ success: false, message: e.message });
  console.error(fallback, e);
  return res.status(500).json({ success: false, message: fallback });
};
const handle = (fallback, fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (e) {
    return fail(res, e, fallback);
  }
};

// ── Me ─────────────────────────────────────────────────────────────────────────────────────────────────
export const me = handle('Could not load your admin access.', async (req, res) => res.json({
  success: true,
  data: { role: req.user.adminRole || 'OWNER', roleLabel: ADMIN_ROLES[req.user.adminRole || 'OWNER'].label, permissions: [...adminPermissionsOf(req.user)], catalog: { permissions: ADMIN_PERMISSIONS, roles: Object.fromEntries(Object.entries(ADMIN_ROLES).map(([k, v]) => [k, v])) } },
}));

// ── Finance ────────────────────────────────────────────────────────────────────────────────────────────
export const finance = handle('Could not load the finance overview.', async (req, res) => {
  const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
  res.json({ success: true, data: await overview(q) });
});

// ── System settings ────────────────────────────────────────────────────────────────────────────────────
export const getConfig = handle('Could not load settings.', async (req, res) => res.json({ success: true, data: { settings: await config.getAllSettings() } }));
export const setConfig = handle('Could not save the setting.', async (req, res) => {
  const key = req.params.key;
  const def = config.SETTINGS[key];
  if (!def) return res.status(404).json({ success: false, message: 'Unknown setting.' });
  const value = config.cleanValue(key, req.body?.value);
  if (def.confirm) actions.assertConfirmed(req.body?.confirm, 'CHANGE', `changing "${def.label}"`);
  const before = await prisma.systemSetting.findUnique({ where: { key } });
  await prisma.$transaction(async (tx) => {
    await config.setSetting(key, value, req.user.id, tx);
    await actions.recordAdminAction(tx, { admin: req.user, action: 'SYSTEM_SETTING', targetType: 'SystemSetting', targetId: key, summary: `Changed "${def.label}"`, before: { value: before?.value ?? null }, after: { value } });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'SYSTEM_SETTING_CHANGED', targetType: 'SystemSetting', targetId: key, details: { before: before?.value ?? def.default, after: value } } });
  });
  config.invalidateConfig();
  res.json({ success: true, message: 'Setting saved.', data: { settings: await config.getAllSettings() } });
});
export const publicConfig = handle('Could not load site settings.', async (req, res) => res.json({ success: true, data: await config.publicConfig() }));

// ── Platform notifications ─────────────────────────────────────────────────────────────────────────────
export const listBroadcasts = handle('Could not load messages.', async (req, res) => res.json({ success: true, data: { broadcasts: await broadcasts.listBroadcasts(), audiences: broadcasts.AUDIENCE_LABELS } }));
export const previewAudience = handle('Could not count the audience.', async (req, res) => {
  const q = z.object({ audience: z.enum(Object.keys(broadcasts.AUDIENCE_LABELS)), city: z.string().trim().max(60).optional() }).parse(req.query);
  res.json({ success: true, data: { recipients: (await broadcasts.audienceIds(q.audience, q.city || null)).length } });
});
export const sendBroadcast = handle('Could not send the message.', async (req, res) => {
  const body = z.object({
    title: z.string().trim().min(3, 'Add a title').max(120),
    message: z.string().trim().min(5, 'Write the message').max(2000),
    link: z.string().trim().max(200).regex(/^\/[\w\-/?=&.#%]*$/, 'Links must be a page of the site, like /events').optional().or(z.literal('').transform(() => undefined)),
    audience: z.enum(Object.keys(broadcasts.AUDIENCE_LABELS)),
    city: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
    sendEmail: z.boolean().default(true),
    scheduledFor: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
    confirm: z.string().optional(),
  }).parse(req.body || {});
  if (body.audience === 'ALL' && !body.city) actions.assertConfirmed(body.confirm, 'SEND TO EVERYONE', 'a message to every user');
  const b = await broadcasts.createBroadcast(req.user, body);
  res.status(201).json({ success: true, message: b.status === 'SCHEDULED' ? `Scheduled for ${new Date(b.scheduledFor).toLocaleString()}.` : `Sent to ${b.recipientCount} ${b.recipientCount === 1 ? 'person' : 'people'}.`, data: { broadcast: b } });
});
export const cancelBroadcast = handle('Could not cancel the message.', async (req, res) => res.json({ success: true, message: 'Cancelled.', data: await broadcasts.cancelBroadcast(req.user, req.params.id) }));

// ── Exports ────────────────────────────────────────────────────────────────────────────────────────────
export const datasets = handle('Could not load exports.', async (req, res) => res.json({ success: true, data: { datasets: Object.entries(exportsSvc.DATASETS).map(([key, d]) => ({ key, label: d.label, columns: d.columns })), maxRows: exportsSvc.MAX_ROWS } }));
export const exportData = handle('Could not export.', async (req, res) => {
  const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
  const csv = await exportsSvc.exportCsv(req.user, req.params.dataset, q);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ticketledger-${req.params.dataset}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ── Investigations ─────────────────────────────────────────────────────────────────────────────────────
export const listCases = handle('Could not load investigations.', async (req, res) => {
  const q = z.object({ status: z.enum(['OPEN', 'MONITORING', 'CLOSED']).optional(), userId: z.string().uuid().optional() }).parse(req.query);
  res.json({ success: true, data: { cases: await cases.listCases(q) } });
});
export const getCase = handle('Could not load the investigation.', async (req, res) => {
  const c = await cases.getCase(req.params.id);
  // An investigation shows bot checks and fraud flags for the account: logged so a later fraud review of this
  // customer by the same admin is recorded as not blind (services/ml/fraudReview.js)
  await prisma.auditLog.create({ data: { userId: req.user.id, action: 'INVESTIGATION_VIEWED', targetType: 'User', targetId: c.userId, details: { investigationId: c.id } } });
  return res.json({ success: true, data: { case: c } });
});
export const openCase = handle('Could not open the investigation.', async (req, res) => {
  const body = z.object({ userId: z.string().uuid(), title: z.string().trim().min(3).max(140), riskLevel: z.enum(cases.RISK).default('MEDIUM'), note: z.string().trim().max(3000).optional() }).parse(req.body || {});
  res.status(201).json({ success: true, message: 'Investigation opened.', data: { case: await cases.openCase(req.user, body) } });
});
export const addCaseNote = handle('Could not add the note.', async (req, res) => {
  const body = z.object({ kind: z.enum(['NOTE', 'EVIDENCE']).default('NOTE'), body: z.string().trim().min(2).max(5000) }).parse(req.body || {});
  res.json({ success: true, message: 'Added.', data: { case: await cases.addNote(req.user, req.params.id, body) } });
});
export const updateCase = handle('Could not update the investigation.', async (req, res) => {
  const body = z.object({ status: z.enum(['OPEN', 'MONITORING', 'CLOSED']).optional(), riskLevel: z.enum(cases.RISK).optional(), outcome: z.string().trim().max(2000).optional() }).parse(req.body || {});
  res.json({ success: true, message: 'Investigation updated.', data: { case: await cases.updateCase(req.user, req.params.id, body) } });
});

// ── Admin actions (undo) ───────────────────────────────────────────────────────────────────────────────
const UNDO_PERMISSION = { USER_STATUS: 'admin.users', COMPANY_STATUS: 'admin.approvals', FINANCE_REVIEW: 'admin.finance', PAYOUT_HOLD: 'admin.finance', SYSTEM_SETTING: 'admin.config' };
export const listActions = handle('Could not load admin actions.', async (req, res) => res.json({ success: true, data: await actions.listActions({ page: req.query.page, reversibleOnly: req.query.reversible === 'true' }) }));
export const undoAction = handle('Could not undo the action.', async (req, res) => {
  const a = await prisma.adminAction.findUnique({ where: { id: req.params.id }, select: { action: true } });
  if (a && UNDO_PERMISSION[a.action] && !hasAdmin(req.user, UNDO_PERMISSION[a.action])) return res.status(403).json({ success: false, message: `Undoing this needs ${UNDO_PERMISSION[a.action]}.` });
  res.json({ success: true, message: 'Undone.', data: await actions.undo(req.user, req.params.id) });
});

// ── Admins and their permissions ───────────────────────────────────────────────────────────────────────
const ADMIN_SELECT = { id: true, name: true, email: true, status: true, adminRole: true, adminPermissions: true, createdAt: true };
const view = (u) => ({ ...u, adminRole: u.adminRole || 'OWNER', roleLabel: ADMIN_ROLES[u.adminRole || 'OWNER'].label, permissions: [...adminPermissionsOf({ ...u, role: 'SUPER_ADMIN' })] });
async function assertAnotherOwner(exceptId) {
  const owners = await prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: exceptId }, OR: [{ adminRole: null }, { adminRole: 'OWNER' }] } });
  if (!owners) throw Object.assign(new Error('There must always be at least one active Owner admin.'), { status: 409 });
}
export const listAdmins = handle('Could not load admins.', async (req, res) => res.json({ success: true, data: { admins: (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: ADMIN_SELECT, orderBy: { name: 'asc' } })).map(view) } }));
export const addAdmin = handle('Could not add the admin.', async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(Object.keys(ADMIN_ROLES)), password: z.string().min(1, 'Enter your password to confirm.'), confirm: z.string().optional() }).parse(req.body || {});
  const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!(await bcrypt.compare(body.password, me.passwordHash))) return res.status(401).json({ success: false, message: 'Your password is incorrect.' });
  const u = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true, role: true, status: true, email: true } });
  if (!u) return res.status(404).json({ success: false, message: 'No account with this email. They must sign up first.' });
  if (u.role === 'SUPER_ADMIN') return res.status(409).json({ success: false, message: 'This account is already an admin.' });
  if (u.status !== 'ACTIVE') return res.status(409).json({ success: false, message: 'Only an active account can become an admin.' });
  if (await prisma.organizationMember.findFirst({ where: { userId: u.id, status: { not: 'REMOVED' } }, select: { id: true } })) return res.status(409).json({ success: false, message: 'This account belongs to an organization. Admins must not be organization members.' });
  actions.assertConfirmed(body.confirm, u.email, 'giving this account admin access');
  const updated = await prisma.$transaction(async (tx) => {
    const x = await tx.user.update({ where: { id: u.id }, data: { role: 'SUPER_ADMIN', adminRole: body.role, adminPermissions: [] }, select: ADMIN_SELECT });
    await actions.recordAdminAction(tx, { admin: req.user, action: 'ADMIN_ADDED', targetType: 'User', targetId: u.id, summary: `Made ${u.email} an admin (${ADMIN_ROLES[body.role].label})`, before: { role: u.role }, after: { role: 'SUPER_ADMIN', adminRole: body.role }, reversible: false });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_ADDED', targetType: 'User', targetId: u.id, details: { email: u.email, adminRole: body.role, previousRole: u.role } } });
    return x;
  });
  res.status(201).json({ success: true, message: `${u.email} is now an admin.`, data: { admin: view(updated) } });
});
export const updateAdmin = handle('Could not update the admin.', async (req, res) => {
  const body = z.object({ role: z.enum(Object.keys(ADMIN_ROLES)).optional(), permissions: z.array(z.enum(ALL_ADMIN)).max(20).optional() }).parse(req.body || {});
  if (req.params.id === req.user.id) return res.status(409).json({ success: false, message: "You can't change your own admin access." });
  const u = await prisma.user.findFirst({ where: { id: req.params.id, role: 'SUPER_ADMIN' }, select: ADMIN_SELECT });
  if (!u) return res.status(404).json({ success: false, message: 'Admin not found.' });
  if ((u.adminRole || 'OWNER') === 'OWNER' && body.role && body.role !== 'OWNER') await assertAnotherOwner(u.id);
  const data = { ...(body.role ? { adminRole: body.role } : {}), ...(body.permissions ? { adminPermissions: body.permissions } : {}) };
  const updated = await prisma.$transaction(async (tx) => {
    const x = await tx.user.update({ where: { id: u.id }, data, select: ADMIN_SELECT });
    await actions.recordAdminAction(tx, { admin: req.user, action: 'ADMIN_ACCESS_CHANGED', targetType: 'User', targetId: u.id, summary: `Changed ${u.email}'s admin access`, before: { adminRole: u.adminRole || 'OWNER', adminPermissions: u.adminPermissions }, after: data, reversible: false });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_ACCESS_CHANGED', targetType: 'User', targetId: u.id, details: { before: { adminRole: u.adminRole || 'OWNER', adminPermissions: u.adminPermissions }, after: data } } });
    return x;
  });
  res.json({ success: true, message: 'Admin access saved.', data: { admin: view(updated) } });
});
export const removeAdmin = handle('Could not remove the admin.', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(409).json({ success: false, message: "You can't remove your own admin access." });
  const u = await prisma.user.findFirst({ where: { id: req.params.id, role: 'SUPER_ADMIN' }, select: ADMIN_SELECT });
  if (!u) return res.status(404).json({ success: false, message: 'Admin not found.' });
  if ((u.adminRole || 'OWNER') === 'OWNER') await assertAnotherOwner(u.id);
  actions.assertConfirmed(req.body?.confirm, u.email, "removing this person's admin access");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { role: 'CUSTOMER', adminRole: null, adminPermissions: [] } });
    await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await actions.recordAdminAction(tx, { admin: req.user, action: 'ADMIN_REMOVED', targetType: 'User', targetId: u.id, summary: `Removed admin access from ${u.email}`, before: { role: 'SUPER_ADMIN', adminRole: u.adminRole }, after: { role: 'CUSTOMER' }, reversible: false });
    await tx.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_REMOVED', targetType: 'User', targetId: u.id, details: { email: u.email } } });
  });
  res.json({ success: true, message: `${u.email} is no longer an admin.` });
});
