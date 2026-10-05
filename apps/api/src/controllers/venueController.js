import { z } from 'zod';
import prisma from '../config/prisma.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import { canManageEvent } from '../utils/eventAccess.js';
import { MediaValidationError, validateEventImage } from '../services/eventMediaService.js';
import { uploadFile } from '../utils/storage.js';
import {
  VenueError,
  activeHoldsForUser,
  getAvailability,
  holdSeat,
  holdTable,
  protectedKeys,
  publishDraft,
  releaseHolds,
  setGaQuantity,
  MAX_TICKETS_PER_BOOKING,
} from '../services/venueService.js';
import { TEMPLATES, TEMPLATE_FOR_EVENT_TYPE, suggestTemplate, validateLayout } from '../../../venue-core/src/index.js';

const fail = (res, error, fallback) => {
  if (error instanceof VenueError) return res.status(error.status).json({ success: false, message: error.message, ...(error.details || {}) });
  if (error instanceof MediaValidationError) return res.status(400).json({ success: false, message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid request' });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

/** Loads the event and checks the caller may manage it (owner with an approved company, or Super Admin). */
async function managedEvent(req, { write = false } = {}) {
  const event = await prisma.event.findUnique({ where: { id: req.params.eventId } });
  if (!event) throw new VenueError(404, 'Event not found');
  if (!(await canManageEvent(req.user, event, { requireApproved: write }))) {
    throw new VenueError(403, 'You are not authorized to manage this event’s venue.');
  }
  return event;
}

export const listTemplates = (req, res) => {
  res.json({
    success: true,
    data: {
      templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, description: t.description })),
      suggestions: TEMPLATE_FOR_EVENT_TYPE,
    },
  });
};

// ---------- Attendee: plan, availability and holds ----------

export const getEventVenue = async (req, res) => {
  try {
    const data = await getAvailability(req.params.eventId, req.user?.id || null);
    res.json({ success: true, data });
  } catch (error) {
    fail(res, error, 'Failed to load the venue plan');
  }
};

export const getMyHolds = async (req, res) => {
  try {
    res.json({ success: true, data: await activeHoldsForUser(req.user.id) });
  } catch (error) {
    fail(res, error, 'Failed to load your reserved seats');
  }
};

const holdSchema = z.union([
  z.object({ key: z.string().min(3).max(200) }),
  z.object({ tableKey: z.string().min(3).max(200) }),
  z.object({ sectionId: z.string().min(3).max(60), quantity: z.number().int().min(0).max(MAX_TICKETS_PER_BOOKING) }),
]);

export const createHold = async (req, res) => {
  try {
    const body = holdSchema.parse(req.body);
    const { eventId } = req.params;
    let holds;
    if ('key' in body) holds = await holdSeat(eventId, body.key, req.user.id);
    else if ('tableKey' in body) holds = await holdTable(eventId, body.tableKey, req.user.id);
    else holds = await setGaQuantity(eventId, body.sectionId, body.quantity, req.user.id);

    // Track behavioral signals in telemetry
    behaviorService.trackBehavior({
      req,
      userId: req.user.id,
      action: BEHAVIOR_ACTIONS.SEAT_SELECTED,
      eventId,
      metadata: { body, holdCount: holds?.length || 1 },
    });
    behaviorService.trackBehavior({
      req,
      userId: req.user.id,
      action: BEHAVIOR_ACTIONS.SEAT_LOCKED,
      eventId,
      metadata: { body, holdCount: holds?.length || 1 },
    });

    res.json({ success: true, data: { holds } });
  } catch (error) {
    fail(res, error, 'Could not hold this selection');
  }
};

export const releaseHold = async (req, res) => {
  try {
    const { keys } = z.object({ keys: z.array(z.string().min(3).max(200)).min(1).max(50) }).parse(req.body);
    const result = await releaseHolds(req.params.eventId, keys, req.user.id);

    // Track checkout abandonment in telemetry when user discards / releases held seats
    behaviorService.trackBehavior({
      req,
      userId: req.user.id,
      action: BEHAVIOR_ACTIONS.CHECKOUT_ABANDONED,
      eventId: req.params.eventId,
      metadata: { releasedKeys: keys, reason: 'seat_hold_released' },
    });

    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, 'Could not release this selection');
  }
};

// ---------- Organizer: editor, drafts, publishing ----------

async function editorPayload(event) {
  const [tiers, draft, published, prot] = await Promise.all([
    prisma.ticketTier.findMany({ where: { eventId: event.id }, orderBy: { price: 'desc' }, select: { id: true, name: true, price: true, totalQuantity: true, availableQuantity: true } }),
    prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'DRAFT' }, orderBy: { updatedAt: 'desc' } }),
    prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'PUBLISHED' }, orderBy: { version: 'desc' } }),
    protectedKeys(event.id),
  ]);
  const legacySeats = await prisma.seat.count({ where: { eventId: event.id, layoutKey: null } });
  const legacyBooked = legacySeats ? await prisma.seat.count({ where: { eventId: event.id, layoutKey: null, OR: [{ status: 'SOLD' }, { ticket: { isNot: null } }] } }) : 0;
  return {
    event: { id: event.id, name: event.name, type: event.type, status: event.status, venue: event.venue, city: event.city },
    suggestedTemplate: suggestTemplate(event.type),
    tiers,
    draft: draft && { id: draft.id, data: draft.data, updatedAt: draft.updatedAt },
    published: published && { id: published.id, version: published.version, publishedAt: published.publishedAt, data: published.data },
    protected: prot,
    legacy: { seats: legacySeats, booked: legacyBooked },
  };
}

export const getEditor = async (req, res) => {
  try {
    const event = await managedEvent(req);
    res.json({ success: true, data: await editorPayload(event) });
  } catch (error) {
    fail(res, error, 'Failed to load the venue editor');
  }
};

const draftSchema = z.object({
  data: z
    .object({
      version: z.number().int(),
      template: z.string().max(40).nullable().optional(),
      coordinate: z.object({ width: z.number().positive().max(5000), height: z.number().positive().max(5000) }),
      background: z.object({ url: z.string().regex(/^(https?:\/\/|\/uploads\/)/), width: z.number().positive(), height: z.number().positive(), opacity: z.number().min(0).max(1).optional() }).nullable().optional(),
      feature: z.record(z.any()).nullable().optional(),
      sections: z.array(z.record(z.any())).max(150),
    })
    .passthrough(),
});

export const saveDraft = async (req, res) => {
  try {
    const event = await managedEvent(req, { write: true });
    const { data } = draftSchema.parse(req.body);
    const tierIds = (await prisma.ticketTier.findMany({ where: { eventId: event.id }, select: { id: true } })).map((t) => t.id);
    const check = validateLayout(data, { tierIds });
    const existing = await prisma.venueLayout.findFirst({ where: { eventId: event.id, status: 'DRAFT' } });
    const draft = existing
      ? await prisma.venueLayout.update({ where: { id: existing.id }, data: { data, template: data.template || null } })
      : await prisma.venueLayout.create({ data: { eventId: event.id, data, template: data.template || null, createdById: req.user.id } });
    res.json({ success: true, message: 'Draft saved.', data: { draft: { id: draft.id, updatedAt: draft.updatedAt }, errors: check.errors, warnings: check.warnings, totals: check.totals } });
  } catch (error) {
    fail(res, error, 'Failed to save the draft');
  }
};

export const discardDraft = async (req, res) => {
  try {
    const event = await managedEvent(req, { write: true });
    await prisma.venueLayout.deleteMany({ where: { eventId: event.id, status: 'DRAFT' } });
    res.json({ success: true, message: 'Unpublished changes discarded.' });
  } catch (error) {
    fail(res, error, 'Failed to discard the draft');
  }
};

export const publish = async (req, res) => {
  try {
    const event = await managedEvent(req, { write: true });
    const result = await publishDraft(event.id, req.user.id);
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'EVENT_SEATING_SAVED',
        title: `Seating saved: ${event.name}`,
        message: `Seating plan version ${result.layout.version} is saved (${result.created} added, ${result.removed} removed, ${result.updated} updated).`,
      },
    });
    res.json({
      success: true,
      message: `Venue plan v${result.layout.version} is live: ${result.created} seat(s) added, ${result.removed} removed, ${result.updated} updated.`,
      data: { ...result, editor: await editorPayload(event) },
    });
  } catch (error) {
    fail(res, error, 'Failed to publish the venue plan');
  }
};

export const uploadPlanImage = async (req, res) => {
  try {
    await managedEvent(req, { write: true });
    const file = req.file;
    if (!file) throw new VenueError(400, 'Choose a plan image to upload.');
    const info = validateEventImage(file, 'venuePlan');
    const uploaded = await uploadFile(file, 'venue_plans', { extension: info.ext });
    res.json({ success: true, data: { url: uploaded.url, width: info.width, height: info.height } });
  } catch (error) {
    fail(res, error, 'Failed to upload the plan image');
  }
};

export const createTier = async (req, res) => {
  try {
    const event = await managedEvent(req, { write: true });
    const { name, price } = z.object({ name: z.string().trim().min(1).max(60), price: z.number().positive().max(10_000_000) }).parse(req.body);
    const tier = await prisma.ticketTier.create({ data: { eventId: event.id, name, price, totalQuantity: 0, availableQuantity: 0 } });
    res.status(201).json({ success: true, data: { tier } });
  } catch (error) {
    fail(res, error, 'Failed to add the pricing tier');
  }
};

/** Published plans from the organizer's other events (Super Admins see the event company's). */
export const listReusable = async (req, res) => {
  try {
    const event = await managedEvent(req);
    const layouts = await prisma.venueLayout.findMany({
      where: { status: 'PUBLISHED', eventId: { not: event.id }, event: { companyId: event.companyId } },
      include: { event: { select: { id: true, name: true, venue: true, city: true, type: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });
    res.json({
      success: true,
      data: {
        layouts: layouts.map((l) => ({
          id: l.id,
          template: l.template,
          version: l.version,
          event: l.event,
          sections: Array.isArray(l.data?.sections) ? l.data.sections.length : 0,
          data: l.data,
        })),
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to load saved layouts');
  }
};
