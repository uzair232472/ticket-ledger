import prisma from '../config/prisma.js';
import { AccessError } from './orgAccess.js';
import { orgAudit } from './orgService.js';
import { assertVenueFree, resolveSchedule, toPktParts, ScheduleError, venueOf } from './eventScheduleService.js';

/*
 * Event tools for organizers:
 *   - duplicate an event (details, media, ticket types, sale phases, venue plan, gates, checkout rules) into a new
 *     DRAFT with new records; the copy goes through approval like any new event
 *   - dates and sessions: copies of an event at other dates/times, grouped in an EventSeries
 *   - settings: scheduled publication, sales window, capacity, terms / refund policy / age limit, session label
 *   - sale phases per ticket type (early bird → regular → late), applied by applyPhases()
 *   - announcements to ticket holders, event staff, change history and a performance report
 * Every change is in the organization's activity history; event changes keep before/after values.
 */

const startOf = (e) => e.startsAt || e.date;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** The event of the caller's organization (event-scoped roles: only their events). */
export async function orgEvent(ctx, eventId, include = {}) {
  const e = await prisma.event.findFirst({ where: { id: eventId, ...(ctx.superAdmin ? {} : { companyId: ctx.companyId }) }, include });
  if (!e) throw new AccessError(404, 'Event not found in your organization.');
  if (ctx.eventScoped && !ctx.eventIds.includes(eventId)) throw new AccessError(403, 'You can only manage events you are assigned to.');
  return e;
}

// ── Duplicate / dates & sessions ───────────────────────────────────────────────────────────────────────

/** Replace every tierId inside a venue plan with the new tier's id. */
function remapTiers(value, map) {
  if (Array.isArray(value)) return value.map((v) => remapTiers(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'tierId' && map[v] ? map[v] : remapTiers(v, map)]));
  return value;
}

/**
 * Copies `source` into a new DRAFT event at `schedule` ({ startsAt, endsAt }) inside `tx`. Returns the new event.
 * Copied: details, media, category, checkout rules and policies, ticket types (full quantity again) with their
 * sale phases (dates shifted with the event), the venue plan (as a draft, ticket types remapped), gates.
 * Not copied: sales, seats (created when the plan is published), approvals, discount codes, staff.
 */
async function copyEvent(tx, req, source, { schedule, name, seriesId = null, sessionLabel = null }) {
  const shift = schedule.startsAt.getTime() - new Date(startOf(source)).getTime();
  const at = (d) => (d ? new Date(new Date(d).getTime() + shift) : null);
  const parts = toPktParts(schedule.startsAt);
  const event = await tx.event.create({
    data: {
      companyId: source.companyId,
      name: name || source.name,
      description: source.description,
      type: source.type,
      customCategoryId: source.customCategoryId,
      categoryLabel: source.categoryLabel,
      status: 'DRAFT',
      date: new Date(`${parts.date}T00:00:00.000Z`),
      time: parts.time,
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      city: source.city,
      venue: source.venue,
      venuePlaceId: source.venuePlaceId,
      venueSpace: source.venueSpace,
      latitude: source.latitude,
      longitude: source.longitude,
      locationAddress: source.locationAddress,
      contactEmail: source.contactEmail,
      bannerUrl: source.bannerUrl,
      cardImageUrl: source.cardImageUrl,
      galleryWideUrl: source.galleryWideUrl,
      branchId: source.branchId,
      reentryPolicy: source.reentryPolicy,
      maxReentries: source.maxReentries,
      maxTicketsPerCustomer: source.maxTicketsPerCustomer,
      groupMinTickets: source.groupMinTickets,
      groupDiscountPercent: source.groupDiscountPercent,
      allowSeatChanges: source.allowSeatChanges,
      seatChangeCutoffHours: source.seatChangeCutoffHours,
      capacityLimit: source.capacityLimit,
      terms: source.terms,
      refundPolicy: source.refundPolicy,
      ageRestriction: source.ageRestriction,
      salesOpenAt: at(source.salesOpenAt),
      salesCloseAt: at(source.salesCloseAt),
      seriesId,
      sessionLabel,
      clonedFromId: source.id,
      galleryImages: { create: (source.galleryImages || []).map((g) => ({ url: g.url, position: g.position })) },
    },
  });
  const tierMap = {};
  for (const t of source.tiers || []) {
    const nt = await tx.ticketTier.create({ data: { eventId: event.id, name: t.name, price: (t.phases?.[0]?.price ?? t.price), totalQuantity: t.totalQuantity, availableQuantity: t.totalQuantity } });
    tierMap[t.id] = nt.id;
    for (const ph of t.phases || []) {
      await tx.ticketPhase.create({ data: { tierId: nt.id, name: ph.name, price: ph.price, startsAt: at(ph.startsAt), endsAt: at(ph.endsAt), quantity: ph.quantity, sortOrder: ph.sortOrder } });
    }
  }
  const layout = (source.venueLayouts || []).find((l) => l.status === 'PUBLISHED') || (source.venueLayouts || []).find((l) => l.status === 'DRAFT');
  if (layout) await tx.venueLayout.create({ data: { eventId: event.id, status: 'DRAFT', version: 1, template: layout.template, data: remapTiers(layout.data, tierMap), createdById: req.user.id } });
  for (const g of source.gates || []) {
    await tx.eventGate.create({ data: { eventId: event.id, name: g.name, type: g.type, allowedTierIds: g.allowedTierIds.map((id) => tierMap[id]).filter(Boolean), capacityPerHour: g.capacityPerHour, active: g.active, sortOrder: g.sortOrder } });
  }
  if (req.org?.eventScoped) await tx.staffEventAssignment.create({ data: { staffId: req.user.id, eventId: event.id, assignedById: req.user.id } });
  return event;
}

const SOURCE_INCLUDE = { tiers: { include: { phases: { orderBy: { sortOrder: 'asc' } } }, orderBy: { price: 'desc' } }, venueLayouts: { where: { status: { in: ['PUBLISHED', 'DRAFT'] } }, orderBy: { version: 'desc' } }, gates: true, galleryImages: true };

/** Schedule of a copy: given start/end (PKT date + time), or the source's times moved by whole days. */
function scheduleFor(input, source) {
  if (input.date && input.time && input.endDate && input.endTime) return resolveSchedule(input);
  throw new ScheduleError(400, 'Choose the start and end date and time of the copy.', { field: 'date' });
}

/** Duplicate one event. Input: { name?, date, time, endDate, endTime }. */
export async function duplicateEvent(req, ctx, eventId, input) {
  const source = await orgEvent(ctx, eventId, SOURCE_INCLUDE);
  const schedule = scheduleFor(input, source);
  if (schedule.startsAt < new Date()) throw new ScheduleError(400, 'The copy must start in the future.', { field: 'date' });
  const event = await prisma.$transaction(async (tx) => {
    await assertVenueFree({ ...venueOf(source), ...schedule }, tx);
    const e = await copyEvent(tx, req, source, { schedule, name: input.name?.trim() || `${source.name} (copy)` });
    await orgAudit(tx, { req, ctx, action: 'EVENT_DUPLICATED', targetType: 'Event', targetId: e.id, details: { fromEventId: source.id, fromEventName: source.name, eventName: e.name, startsAt: schedule.startsAt } });
    return e;
  });
  return prisma.event.findUnique({ where: { id: event.id }, include: { tiers: true } });
}

/**
 * More dates / sessions of an event: one copy per slot, all in one series with the original. Input: { slots:
 * [{ date, time, endDate, endTime, label? }], seriesName?, label? (the original's session label) }. Slots that
 * clash with another booking of the venue are skipped and reported.
 */
export async function addDates(req, ctx, eventId, { slots, seriesName, label }) {
  const source = await orgEvent(ctx, eventId, SOURCE_INCLUDE);
  if (!slots?.length) throw new AccessError(400, 'Add at least one date.');
  if (slots.length > 52) throw new AccessError(400, 'Add up to 52 dates at a time.');
  let seriesId = source.seriesId;
  if (!seriesId) {
    const s = await prisma.eventSeries.create({ data: { companyId: source.companyId, name: seriesName?.trim() || source.name, createdById: req.user.id } });
    seriesId = s.id;
    await prisma.event.update({ where: { id: source.id }, data: { seriesId, ...(label ? { sessionLabel: label } : {}) } });
  }
  const created = [];
  const skipped = [];
  for (const slot of slots) {
    let schedule;
    try {
      schedule = resolveSchedule(slot);
      if (schedule.startsAt < new Date()) throw new ScheduleError(400, 'This date is in the past.', { field: 'date' });
      const e = await prisma.$transaction(async (tx) => {
        await assertVenueFree({ ...venueOf(source), ...schedule }, tx);
        return copyEvent(tx, req, source, { schedule, name: source.name, seriesId, sessionLabel: slot.label?.trim() || null });
      });
      created.push({ id: e.id, startsAt: e.startsAt, sessionLabel: e.sessionLabel });
    } catch (err) {
      if (err instanceof ScheduleError || err.status === 409) skipped.push({ date: slot.date, time: slot.time, reason: err.message });
      else throw err;
    }
  }
  await orgAudit(prisma, { req, ctx, action: 'EVENT_DATES_ADDED', targetType: 'Event', targetId: source.id, details: { eventName: source.name, seriesId, created: created.length, skipped: skipped.length } });
  return { seriesId, created, skipped };
}

/** Weekly / daily / monthly slots from one start (same time and length as the event). */
export function recurringSlots(event, { frequency, count, interval = 1 }) {
  const start = new Date(startOf(event));
  const length = (event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 3 * 3600000)) - start;
  const out = [];
  for (let i = 1; i <= Math.min(52, count); i++) {
    const s = new Date(start);
    if (frequency === 'DAILY') s.setUTCDate(s.getUTCDate() + i * interval);
    else if (frequency === 'WEEKLY') s.setUTCDate(s.getUTCDate() + 7 * i * interval);
    else s.setUTCMonth(s.getUTCMonth() + i * interval);
    const e = new Date(s.getTime() + length);
    const a = toPktParts(s);
    const b = toPktParts(e);
    out.push({ date: a.date, time: a.time, endDate: b.date, endTime: b.time });
  }
  return out;
}

/** The dates of an event's series (for the event page's date picker and the organizer). */
export async function seriesDates(event) {
  if (!event.seriesId) return [];
  return prisma.event.findMany({ where: { seriesId: event.seriesId, status: { notIn: ['CANCELLED'] } }, select: { id: true, startsAt: true, date: true, time: true, sessionLabel: true, status: true, isHidden: true }, orderBy: [{ startsAt: 'asc' }, { date: 'asc' }] });
}

// ── Settings ───────────────────────────────────────────────────────────────────────────────────────────

const SETTING_FIELDS = ['publishAt', 'salesOpenAt', 'salesCloseAt', 'capacityLimit', 'terms', 'refundPolicy', 'ageRestriction', 'sessionLabel'];

export async function updateSettings(req, ctx, eventId, input) {
  const e = await orgEvent(ctx, eventId);
  const data = pick(input, SETTING_FIELDS);
  const open = data.salesOpenAt !== undefined ? data.salesOpenAt : e.salesOpenAt;
  const close = data.salesCloseAt !== undefined ? data.salesCloseAt : e.salesCloseAt;
  if (open && close && close <= open) throw new AccessError(400, 'Sales must close after they open.');
  if (close && e.endsAt && close > e.endsAt) throw new AccessError(400, 'Sales must close before the event ends.');
  if (data.capacityLimit) {
    const sold = await prisma.ticket.count({ where: { eventId, status: { in: ['ACTIVE', 'SCANNED', 'TRANSFERRED'] }, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'PENDING'] } } } });
    if (data.capacityLimit < sold) throw new AccessError(409, `${sold} tickets are already sold or in checkouts, so the capacity can't be lower.`);
  }
  if (data.publishAt && e.status === 'PUBLISHED' && !e.isHidden) throw new AccessError(409, 'This event is already public.');
  // New terms: a new version (orders keep the version their customer accepted)
  if (data.terms !== undefined && (data.terms || '') !== (e.terms || '')) data.termsVersion = e.termsVersion + 1;
  const before = pick(e, Object.keys(data));
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data });
    // A scheduled publication that is now in the past, or removed, on an approved hidden event: show it now
    await orgAudit(tx, { req, ctx, action: 'EVENT_SETTINGS_CHANGED', targetType: 'Event', targetId: eventId, before, after: data, details: { eventName: e.name } });
  });
  await runScheduledPublishing();
  return prisma.event.findUnique({ where: { id: eventId }, select: { id: true, ...Object.fromEntries([...SETTING_FIELDS, 'termsVersion', 'isHidden', 'status'].map((k) => [k, true])) } });
}

/** May customers hold seats / check out now? Throws a 409 with the reason. */
export function assertOnSale(event, now = new Date()) {
  if (event.salesOpenAt && now < new Date(event.salesOpenAt)) throw Object.assign(new Error(`Ticket sales open ${new Date(event.salesOpenAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' })}.`), { status: 409, code: 'SALES_NOT_OPEN' });
  if (event.salesCloseAt && now >= new Date(event.salesCloseAt)) throw Object.assign(new Error('Ticket sales for this event have closed.'), { status: 409, code: 'SALES_CLOSED' });
}

/** Tickets that still fit under the event's capacity (Infinity without a limit). */
export async function capacityLeft(event, excludeOrderIds = []) {
  if (!event.capacityLimit) return Infinity;
  const used = await prisma.ticket.count({ where: { eventId: event.id, status: { in: ['ACTIVE', 'SCANNED', 'TRANSFERRED'] }, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'PENDING'] }, id: { notIn: excludeOrderIds } } } });
  return Math.max(0, event.capacityLimit - used);
}

/** The job: approved events whose publication time has come are shown. */
export async function runScheduledPublishing(now = new Date()) {
  const due = await prisma.event.findMany({ where: { status: 'PUBLISHED', isHidden: true, publishAt: { lte: now }, approvedAt: { not: null }, OR: [{ prebookDraftId: null }, { launchStatus: 'APPROVED' }] }, select: { id: true, name: true, companyId: true } });
  for (const e of due) {
    await prisma.event.update({ where: { id: e.id }, data: { isHidden: false } });
    await prisma.auditLog.create({ data: { companyId: e.companyId, action: 'EVENT_PUBLISHED_ON_SCHEDULE', targetType: 'Event', targetId: e.id, details: { eventName: e.name } } });
    const owners = await prisma.organizationMember.findMany({ where: { companyId: e.companyId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, select: { userId: true } });
    if (owners.length) await prisma.notification.createMany({ data: owners.map((o) => ({ userId: o.userId, type: 'EVENT_PUBLISHED', title: `${e.name} is live`, message: 'Your event was published at its scheduled time.', link: `/events/${e.id}` })) });
  }
  return { published: due.length };
}

// ── Sale phases ────────────────────────────────────────────────────────────────────────────────────────

/** Replace a ticket type's phases ([] removes them). */
export async function setPhases(req, ctx, eventId, tierId, phases) {
  const e = await orgEvent(ctx, eventId);
  const tier = await prisma.ticketTier.findFirst({ where: { id: tierId, eventId } });
  if (!tier) throw new AccessError(404, 'Ticket type not found.');
  const sorted = phases.map((p, i) => ({ ...p, sortOrder: i }));
  for (const p of sorted) {
    if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) throw new AccessError(400, `${p.name}: it must end after it starts.`);
  }
  const before = await prisma.ticketPhase.findMany({ where: { tierId }, orderBy: { sortOrder: 'asc' } });
  await prisma.$transaction(async (tx) => {
    await tx.ticketPhase.deleteMany({ where: { tierId } });
    for (const p of sorted) await tx.ticketPhase.create({ data: { tierId, name: p.name, price: p.price, startsAt: p.startsAt || null, endsAt: p.endsAt || null, quantity: p.quantity || null, sortOrder: p.sortOrder } });
    await tx.ticketTier.update({ where: { id: tierId }, data: { currentPhaseId: null } });
    await orgAudit(tx, { req, ctx, action: 'EVENT_SALE_PHASES_CHANGED', targetType: 'Event', targetId: eventId, before: { tier: tier.name, phases: before.map((p) => ({ name: p.name, price: Number(p.price), startsAt: p.startsAt, endsAt: p.endsAt, quantity: p.quantity })) }, after: { tier: tier.name, phases: sorted.map((p) => ({ name: p.name, price: p.price, startsAt: p.startsAt, endsAt: p.endsAt, quantity: p.quantity })) }, details: { eventName: e.name } });
  });
  await applyPhases(eventId);
  return prisma.ticketTier.findMany({ where: { eventId }, include: { phases: { orderBy: { sortOrder: 'asc' } } } });
}

/**
 * Moves each ticket type to its current phase: the first phase (in order) that has started and is not over
 * (past its end, or sold its quantity since it became current). Its price becomes the tier's price, so seat
 * maps, checkout and invoices all use it. Runs from the 5-minute job and before every checkout of the event.
 */
export async function applyPhases(eventId = null, now = new Date()) {
  const tiers = await prisma.ticketTier.findMany({ where: { ...(eventId ? { eventId } : {}), phases: { some: {} } }, include: { phases: { orderBy: { sortOrder: 'asc' } } } });
  let changed = 0;
  for (const tier of tiers) {
    let active = null;
    for (const p of tier.phases) {
      if (p.startsAt && p.startsAt > now) break; // later phases wait for this one's start
      if (p.endsAt && p.endsAt <= now) continue;
      if (p.quantity && p.activatedAt) {
        const sold = await prisma.ticket.count({ where: { seat: { tierId: tier.id }, createdAt: { gte: p.activatedAt }, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'PENDING'] } } } });
        if (sold >= p.quantity) continue;
      }
      active = p;
      break;
    }
    if (active && active.id !== tier.currentPhaseId) {
      await prisma.$transaction([
        prisma.ticketTier.update({ where: { id: tier.id }, data: { price: active.price, currentPhaseId: active.id } }),
        prisma.ticketPhase.update({ where: { id: active.id }, data: { activatedAt: active.activatedAt || now } }),
      ]);
      changed++;
    }
  }
  return { changed };
}

// ── Announcements ──────────────────────────────────────────────────────────────────────────────────────

/** People holding a valid ticket for the event. */
const holderIds = async (eventId) => [...new Set((await prisma.ticket.findMany({ where: { eventId, status: { in: ['ACTIVE', 'SCANNED'] }, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED'] } } }, select: { userId: true } })).map((t) => t.userId))];

export async function announce(req, ctx, eventId, { title, body, isPublic = true, notifyHolders = true }) {
  const e = await orgEvent(ctx, eventId);
  const ids = notifyHolders ? await holderIds(eventId) : [];
  const a = await prisma.$transaction(async (tx) => {
    const row = await tx.eventAnnouncement.create({ data: { eventId, title, body, isPublic, notifyHolders, authorId: req.user.id, recipientCount: ids.length } });
    for (let i = 0; i < ids.length; i += 1000) await tx.notification.createMany({ data: ids.slice(i, i + 1000).map((userId) => ({ userId, type: 'EVENT_ANNOUNCEMENT', title: `${e.name}: ${title}`, message: body.slice(0, 500), link: `/events/${eventId}` })) });
    await orgAudit(tx, { req, ctx, action: 'EVENT_ANNOUNCEMENT_SENT', targetType: 'Event', targetId: eventId, details: { eventName: e.name, title, recipients: ids.length, isPublic } });
    return row;
  });
  return a;
}
export async function listAnnouncements(eventId, { publicOnly = false } = {}) {
  return prisma.eventAnnouncement.findMany({ where: { eventId, ...(publicOnly ? { isPublic: true } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 });
}
export async function deleteAnnouncement(req, ctx, eventId, id) {
  await orgEvent(ctx, eventId);
  const { count } = await prisma.eventAnnouncement.deleteMany({ where: { id, eventId } });
  if (!count) throw new AccessError(404, 'Announcement not found.');
  await orgAudit(prisma, { req, ctx, action: 'EVENT_ANNOUNCEMENT_DELETED', targetType: 'Event', targetId: eventId, details: { announcementId: id } });
  return { deleted: true };
}

// ── Staff ──────────────────────────────────────────────────────────────────────────────────────────────

/** Members working on this event: organization-wide roles, and event-scoped ones assigned to it. */
export async function eventStaff(ctx, eventId) {
  const { EVENT_SCOPED_ROLES, ROLE_LABELS } = await import('./orgAccess.js');
  const e = await orgEvent(ctx, eventId);
  const members = await prisma.organizationMember.findMany({ where: { companyId: e.companyId, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true, email: true } } } });
  const assigned = new Set((await prisma.staffEventAssignment.findMany({ where: { eventId }, select: { staffId: true } })).map((a) => a.staffId));
  return members.map((m) => ({ memberId: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, roleLabel: ROLE_LABELS[m.role], scoped: EVENT_SCOPED_ROLES.includes(m.role), assigned: !EVENT_SCOPED_ROLES.includes(m.role) || assigned.has(m.userId) }));
}
export async function setEventStaff(req, ctx, eventId, memberId, assign) {
  const { EVENT_SCOPED_ROLES } = await import('./orgAccess.js');
  const e = await orgEvent(ctx, eventId);
  const m = await prisma.organizationMember.findFirst({ where: { id: memberId, companyId: e.companyId, status: 'ACTIVE' }, include: { user: { select: { email: true } } } });
  if (!m) throw new AccessError(404, 'Member not found.');
  if (!EVENT_SCOPED_ROLES.includes(m.role)) throw new AccessError(409, 'This member works on every event of the organization already.');
  if (assign) await prisma.staffEventAssignment.upsert({ where: { staffId_eventId: { staffId: m.userId, eventId } }, update: {}, create: { staffId: m.userId, eventId, assignedById: req.user.id } });
  else {
    await prisma.staffEventAssignment.deleteMany({ where: { staffId: m.userId, eventId } });
    await prisma.gateAssignment.deleteMany({ where: { staffId: m.userId, eventId } });
  }
  await orgAudit(prisma, { req, ctx, action: assign ? 'EVENT_STAFF_ASSIGNED' : 'EVENT_STAFF_REMOVED', targetType: 'Event', targetId: eventId, details: { eventName: e.name, memberEmail: m.user.email, role: m.role } });
  return eventStaff(ctx, eventId);
}

// ── History and report ─────────────────────────────────────────────────────────────────────────────────

/** Everything recorded about the event: edits (with before/after), reviews, settings, sales changes, staff. */
export async function history(ctx, eventId) {
  await orgEvent(ctx, eventId);
  const [logs, reviews] = await Promise.all([
    prisma.auditLog.findMany({ where: { targetType: 'Event', targetId: eventId }, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.eventReviewMessage.findMany({ where: { eventId }, orderBy: { createdAt: 'desc' }, take: 100 }).catch(() => []),
  ]);
  const ids = [...new Set([...logs.map((l) => l.userId), ...reviews.map((r) => r.authorId)].filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return [
    ...logs.map((l) => ({ id: l.id, at: l.createdAt, kind: 'change', action: l.action, who: l.userId ? name[l.userId] || null : 'System', before: l.details?.before ?? null, after: l.details?.after ?? null, details: l.details })),
    ...reviews.map((r) => ({ id: r.id, at: r.createdAt, kind: 'review', action: r.kind || 'REVIEW_MESSAGE', who: name[r.authorId] || null, details: { message: r.message || r.body || null } })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
}

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Sales, revenue, discounts, fees, tax, refunds, attendance and capacity of one event. */
export async function performance(ctx, eventId) {
  const e = await orgEvent(ctx, eventId, { tiers: true });
  const [orders, tickets, refunds, checkins, views] = await Promise.all([
    prisma.order.findMany({ where: { eventId, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, select: { createdAt: true, totalAmount: true, subtotalAmount: true, discountAmount: true, groupDiscountAmount: true, serviceFeeAmount: true, taxAmount: true } }),
    prisma.ticket.findMany({ where: { eventId, order: { status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } }, select: { price: true, status: true, seat: { select: { tierId: true } } } }),
    prisma.refund.aggregate({ where: { eventId, status: 'SUCCEEDED' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.ticket.count({ where: { eventId, status: 'SCANNED' } }),
    prisma.behaviorEvent.count({ where: { eventId, action: { in: ['event_view', 'EVENT_VIEW', 'view_event'] } } }).catch(() => 0),
  ]);
  const daily = {};
  const totals = { orders: orders.length, collected: 0, ticketSales: 0, discounts: 0, serviceFees: 0, tax: 0 };
  for (const o of orders) {
    const day = o.createdAt.toISOString().slice(0, 10);
    daily[day] = daily[day] || { day, orders: 0, amount: 0 };
    daily[day].orders++;
    daily[day].amount += Number(o.totalAmount);
    totals.collected += Number(o.totalAmount);
    totals.ticketSales += Number(o.subtotalAmount ?? o.totalAmount) - Number(o.discountAmount || 0) - Number(o.groupDiscountAmount || 0);
    totals.discounts += Number(o.discountAmount || 0) + Number(o.groupDiscountAmount || 0);
    totals.serviceFees += Number(o.serviceFeeAmount || 0);
    totals.tax += Number(o.taxAmount || 0);
  }
  const valid = tickets.filter((t) => ['ACTIVE', 'SCANNED', 'TRANSFERRED'].includes(t.status));
  const byTier = e.tiers.map((t) => {
    const mine = valid.filter((x) => x.seat?.tierId === t.id);
    return { tier: t.name, price: Number(t.price), sold: mine.length, capacity: t.totalQuantity, revenue: money(mine.reduce((n, x) => n + Number(x.price), 0)) };
  });
  return {
    event: { id: e.id, name: e.name, startsAt: e.startsAt || e.date, status: e.status, capacityLimit: e.capacityLimit },
    totals: { ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'orders' ? v : money(v)])), ticketsSold: valid.length, refunded: money(refunds._sum.amount), refundsCount: refunds._count._all, checkedIn: checkins, noShows: Math.max(0, valid.length - checkins), views },
    byTier,
    daily: Object.values(daily).sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, amount: money(d.amount) })),
  };
}

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
export function performanceCsv(r) {
  const lines = [['Event', r.event.name], ['Starts', r.event.startsAt], [], ['Totals'], ...Object.entries(r.totals).map(([k, v]) => [k, v]), [], ['Ticket type', 'Price', 'Sold', 'Of', 'Revenue'], ...r.byTier.map((t) => [t.tier, t.price, t.sold, t.capacity, t.revenue]), [], ['Day', 'Orders', 'Amount'], ...r.daily.map((d) => [d.day, d.orders, d.amount])];
  return lines.map((l) => l.map(cell).join(',')).join('\n');
}
