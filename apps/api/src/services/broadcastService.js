import prisma from '../config/prisma.js';

/*
 * Platform-wide notifications: an admin writes a message for an audience (everyone, customers, organizers,
 * organization owners, gate staff, support agents, admins), optionally in one city, now or at a set time. Each
 * recipient gets an in-app notification; with sendEmail it is emailed too (the notification email hook; users who
 * turned email off still get it in-app only). Scheduled ones go out from the 15-minute job.
 */

export const AUDIENCE_LABELS = {
  ALL: 'Everyone',
  CUSTOMERS: 'Customers',
  ORGANIZERS: 'Organizer accounts',
  ORG_OWNERS: 'Organization owners',
  GATE_STAFF: 'Gate staff',
  SUPPORT_AGENTS: 'Support agents',
  ADMINS: 'Admins',
};

/** User ids of an audience (active accounts only). */
export async function audienceIds(audience, city) {
  const base = { status: 'ACTIVE', ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}) };
  let where;
  switch (audience) {
    case 'CUSTOMERS': where = { ...base, role: 'CUSTOMER' }; break;
    case 'ORGANIZERS': where = { ...base, role: 'ORGANIZER' }; break;
    case 'ORG_OWNERS': where = { ...base, memberships: { some: { role: 'OWNER', status: 'ACTIVE' } } }; break;
    case 'GATE_STAFF': where = { ...base, OR: [{ role: 'GATE_STAFF' }, { memberships: { some: { role: 'GATE_STAFF', status: 'ACTIVE' } } }] }; break;
    case 'SUPPORT_AGENTS': where = { ...base, OR: [{ isSupportAgent: true }, { role: 'SUPER_ADMIN' }] }; break;
    case 'ADMINS': where = { ...base, role: 'SUPER_ADMIN' }; break;
    default: where = base;
  }
  return (await prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
}

async function deliver(b) {
  const ids = await audienceIds(b.audience, b.city);
  // In-app only: the _INAPP suffix tells the email hook to skip it (config/prisma.js)
  const type = b.sendEmail ? 'PLATFORM_BROADCAST' : 'PLATFORM_BROADCAST_INAPP';
  for (let i = 0; i < ids.length; i += 1000) {
    await prisma.notification.createMany({ data: ids.slice(i, i + 1000).map((userId) => ({ userId, type, title: b.title, message: b.message, link: b.link || null })) });
  }
  return prisma.broadcast.update({ where: { id: b.id }, data: { status: 'SENT', sentAt: new Date(), recipientCount: ids.length } });
}

export async function createBroadcast(admin, input) {
  const later = input.scheduledFor && new Date(input.scheduledFor) > new Date(Date.now() + 60000);
  const b = await prisma.broadcast.create({
    data: { title: input.title, message: input.message, link: input.link || null, audience: input.audience, city: input.city || null, sendEmail: input.sendEmail !== false, status: later ? 'SCHEDULED' : 'SENT', scheduledFor: later ? new Date(input.scheduledFor) : null, sentById: admin.id },
  });
  await prisma.auditLog.create({ data: { userId: admin.id, action: later ? 'ADMIN_BROADCAST_SCHEDULED' : 'ADMIN_BROADCAST_SENT', targetType: 'Broadcast', targetId: b.id, details: { title: b.title, audience: b.audience, city: b.city, scheduledFor: b.scheduledFor } } });
  return later ? b : deliver(b);
}

export async function cancelBroadcast(admin, id) {
  const { count } = await prisma.broadcast.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', cancelledById: admin.id } });
  if (!count) throw Object.assign(new Error('Only a scheduled message that has not gone out can be cancelled.'), { status: 409 });
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'ADMIN_BROADCAST_CANCELLED', targetType: 'Broadcast', targetId: id } });
  return { cancelled: true };
}

export async function listBroadcasts() {
  const rows = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const admins = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sentById))] } }, select: { id: true, name: true } });
  const name = Object.fromEntries(admins.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ ...r, audienceLabel: AUDIENCE_LABELS[r.audience], sentBy: name[r.sentById] || null }));
}

/** The job: send scheduled messages that are due. */
export async function runScheduledBroadcasts(now = new Date()) {
  const due = await prisma.broadcast.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: now } } });
  for (const b of due) {
    const claimed = await prisma.broadcast.updateMany({ where: { id: b.id, status: 'SCHEDULED' }, data: { status: 'SENT' } });
    if (claimed.count) await deliver(b);
  }
  return { sent: due.length };
}
