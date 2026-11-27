import { z } from 'zod';
import * as support from '../services/supportService.js';

const fail = (res, error, fallback) => {
  if (error instanceof support.SupportError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid request' });
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
const optId = z.string().uuid().optional().or(z.literal('').transform(() => undefined));
const body = z.string().trim().min(2, 'Write a message').max(5000, 'Keep the message under 5000 characters');

/** GET /api/support/attachments/:id?exp&sig: a support file, through a signed link only (see supportService). */
export const download = handle('Could not open the file.', async (req, res) => {
  const f = await support.openAttachment(req.params.id, req.query);
  if (f.url) return res.redirect(f.url);
  res.setHeader('Content-Type', f.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Content-Disposition', `${(f.mimeType?.startsWith('image/') || f.mimeType === 'application/pdf') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.fileName)}"`);
  return res.sendFile(f.path);
});

export const meta = handle('Could not load support options.', async (req, res) => res.json({
  success: true,
  data: {
    categories: Object.entries(support.CATEGORIES).map(([value, label]) => ({ value, label })),
    statuses: Object.entries(support.STATUS_LABELS).map(([value, label]) => ({ value, label })),
    priorities: support.PRIORITIES,
    maxAttachments: support.MAX_ATTACHMENTS,
    reopenDays: support.REOPEN_DAYS,
    isAgent: support.isAgent(req.user),
  },
}));

export const create = handle('Could not create the support request.', async (req, res) => {
  const input = z.object({
    category: z.enum(Object.keys(support.CATEGORIES)),
    subject: z.string().trim().min(4, 'Add a short subject').max(140),
    message: body,
    orderId: optId,
    eventId: optId,
  }).parse(req.body || {});
  const data = await support.createTicket(req.user, input, req.files);
  res.status(201).json({ success: true, message: `Request received. Your reference is ${data.ticket.reference}.`, data });
});
export const mine = handle('Could not load your requests.', async (req, res) => res.json({ success: true, data: { tickets: await support.listMyTickets(req.user, { status: req.query.status }) } }));
export const getOne = handle('Could not load this request.', async (req, res) => res.json({ success: true, data: await support.getTicket(req.user, req.params.reference) }));
export const reply = handle('Could not send the reply.', async (req, res) => {
  const input = z.object({
    body,
    internal: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional(),
    status: z.enum(['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED']).optional().or(z.literal('').transform(() => undefined)),
  }).parse(req.body || {});
  res.json({ success: true, message: input.internal ? 'Note added.' : 'Reply sent.', data: await support.reply(req.user, req.params.reference, input, req.files) });
});
export const orgTickets = handle('Could not load support requests.', async (req, res) => {
  const q = z.object({ status: z.enum(['open', 'closed', 'all']).optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
  res.json({ success: true, data: { tickets: await support.listOrgTickets(req.user, q) } });
});
export const closeOwn = handle('Could not close the request.', async (req, res) => res.json({ success: true, message: 'Request closed.', data: await support.closeOwn(req.user, req.params.reference) }));

// Agents
export const queue = handle('Could not load the support queue.', async (req, res) => {
  const q = z.object({
    queue: z.enum(['all', 'mine', 'unassigned', 'escalated', 'waiting', 'closed']).optional(),
    status: z.enum(Object.keys(support.STATUS_LABELS)).optional(),
    category: z.enum(Object.keys(support.CATEGORIES)).optional(),
    priority: z.enum(support.PRIORITIES).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).parse(req.query);
  res.json({ success: true, data: await support.listQueue(req.user, q) });
});
export const agents = handle('Could not load agents.', async (req, res) => res.json({ success: true, data: { agents: await support.listAgents(req.user) } }));
export const update = handle('Could not update the request.', async (req, res) => {
  const input = z.object({
    assigneeId: z.string().uuid().nullable().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']).optional(),
    priority: z.enum(support.PRIORITIES).optional(),
  }).parse(req.body || {});
  res.json({ success: true, message: 'Request updated.', data: await support.updateTicket(req.user, req.params.reference, input) });
});
export const escalate = handle('Could not escalate the request.', async (req, res) => {
  const input = z.object({ reason: z.string().trim().min(3, 'Say why it is escalated').max(500), assigneeId: z.string().uuid().optional() }).parse(req.body || {});
  res.json({ success: true, message: 'Request escalated. The admins were told.', data: await support.escalate(req.user, req.params.reference, input) });
});
export const deescalate = handle('Could not update the request.', async (req, res) => {
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body || {});
  res.json({ success: true, message: 'Escalation handled.', data: await support.deescalate(req.user, req.params.reference, { note }) });
});
export const setAgent = handle('Could not change the agent.', async (req, res) => {
  const input = z.object({ email: z.string().trim().email().optional(), userId: z.string().uuid().optional(), agent: z.boolean() }).parse(req.body || {});
  const agent = await support.setAgent(req.user, input);
  res.json({ success: true, message: input.agent ? `${agent.name} is now a support agent.` : `${agent.name} is no longer a support agent.`, data: { agent } });
});
