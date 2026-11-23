import { z } from 'zod';
import prisma from '../config/prisma.js';
import { recordShadow } from '../services/ml/shadow.js';
import { demandSnapshot } from '../services/ml/features.js';
import { MediaValidationError, uploadEventImages } from '../services/eventMediaService.js';
import { EVENT_IMAGE_SPECS } from '../config/eventMedia.js';
import { canManageEvent, reviewLocked, REVIEW_LOCK_MESSAGE } from '../utils/eventAccess.js';
import { getMemberCompanyId } from '../services/accessService.js';
import { eventWhereFor, requestContext } from '../services/orgAccess.js';
import { applySeatAvailability } from '../services/venueService.js';
import { isPromotionActive, promotionStartedAt } from '../services/promotionWindow.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import { prelaunchEstimate, priceNote, publishSuggestion, tiersWithPrices } from '../services/demandRules.js';
import { CategoryError, categoryColumns, listCategories, addCustomCategory } from '../services/categoryService.js';
import { ScheduleError, RELEASED_STATUSES, resolveSchedule, assertVenueFree, findScheduleConflicts, occupiedInterval, toPktParts, parseTimeOfDay, venueOf } from '../services/eventScheduleService.js';

// Schemas
const ticketTierSchema = z.object({
  name: z.string().min(1, 'Tier name is required'),
  price: z.number().positive('Price must be greater than 0'),
  totalQuantity: z.number().int().positive('Total quantity must be at least 1'),
});

const createEventSchema = z.object({
  name: z.string().min(3, 'Event name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: z.enum([
    'CRICKET_MATCH',
    'FOOTBALL_MATCH',
    'KABADDI',
    'BOXING',
    'MUSIC_CONCERT',
    'MUSIC_FESTIVAL',
    'HOCKEY_MATCH',
    'QAWWALI',
    'THEATRE',
    'CONFERENCE',
    'GENERAL_ADMISSION',
    'OTHER', // organizer-added category, given by customCategoryId
  ]),
  customCategoryId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().uuid('Choose a valid category').optional()),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  time: z.string().min(1, 'Event time is required'),
  // End of the event in PKT; the end date is the next day for events that run past midnight
  endDate: z.string({ required_error: 'Event end date is required' }).refine((val) => !isNaN(Date.parse(val)), 'Invalid end date format'),
  endTime: z.string({ required_error: 'Event end time is required' }).min(1, 'Event end time is required'),
  city: z.string().min(2, 'City is required'),
  venue: z.string().min(2, 'Venue is required'),
  status: z.enum([
    'DRAFT',
    'PRELAUNCH_ANALYSIS',
    'PUBLISHED',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
  ]).optional().default('PUBLISHED'),
  // Exact location from the organizer's map pick (multipart sends strings; empty means not set)
  latitude: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(-90).max(90).optional()),
  longitude: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(-180).max(180).optional()),
  locationAddress: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().max(300).optional()),
  // Attendee contact email for this event; empty clears it (the organizer's own email is used instead)
  contactEmail: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v),
    z.string().email('Enter a valid contact email').max(200).nullable().optional(),
  ),
  // Only stored image references (absolute http(s) or root-relative paths), never blob:/data: preview URLs
  bannerUrl: z.string().regex(/^(https?:\/\/|\/)/, 'Banner URL must be an http(s) URL or a site path').optional(),
});

// Editable event details (status, tiers and pricing keep their own endpoints)
const updateEventDetailsSchema = createEventSchema
  .pick({ name: true, description: true, type: true, customCategoryId: true, date: true, time: true, endDate: true, endTime: true, city: true, venue: true, latitude: true, longitude: true, locationAddress: true, contactEmail: true })
  .partial();

const SINGLE_IMAGE_FIELDS = [
  { field: 'banner', column: 'bannerUrl', kind: 'banner' },
  { field: 'cardImage', column: 'cardImageUrl', kind: 'card' },
  { field: 'galleryWide', column: 'galleryWideUrl', kind: 'galleryWide' },
];

const galleryOrderSchema = z
  .array(z.union([z.object({ id: z.string().min(1) }).strict(), z.object({ upload: z.number().int().min(0) }).strict()]))
  .max(EVENT_IMAGE_SPECS.gallery.maxCount, `Scrolling Gallery Images: at most ${EVENT_IMAGE_SPECS.gallery.maxCount} images.`);


// Same name once case, spacing and punctuation are ignored ("PSL Final 2026" = "psl final-2026")
const sameNameKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The company's own events with the same name that haven't ended yet: most likely the same event entered
 * twice (or re-entered with a changed date). Cancelled and rejected ones are ignored. Same-day matches come
 * first; `sameDay` and `sameSlot` (same venue and start) say how close each one is.
 */
async function findDuplicateEvents({ companyId, name, startsAt, venue, excludeEventId }) {
  const key = sameNameKey(name);
  if (!companyId || !key || !startsAt) return [];
  const day = toPktParts(startsAt).date;
  const candidates = await prisma.event.findMany({
    where: {
      companyId,
      status: { notIn: RELEASED_STATUSES },
      ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    select: { id: true, name: true, status: true, date: true, time: true, venue: true, city: true, startsAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return candidates
    .filter((e) => sameNameKey(e.name) === key)
    .map((e) => {
      const start = occupiedInterval(e).start;
      return {
        ...e,
        sameDay: toPktParts(start).date === day,
        sameSlot: start.getTime() === startsAt.getTime() && sameNameKey(e.venue) === sameNameKey(venue),
      };
    })
    .sort((a, b) => Number(b.sameDay) - Number(a.sameDay));
}

const companyIdFor = async (user) => (user.role === 'SUPER_ADMIN' ? null : getMemberCompanyId(user, 'event.view'));

/**
 * Organizer creates an event with ticket tiers
 */
export const createEvent = async (req, res) => {
  try {
    const company = req.company; // Injected by requireApprovedOrganizer
    const userId = req.user.id;

    // Parse tiers if sent as a JSON string via multipart/form-data
    let rawTiers = req.body.tiers;
    if (typeof rawTiers === 'string') {
      try {
        rawTiers = JSON.parse(rawTiers);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid tiers JSON format' });
      }
    }

    if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one ticket tier with price and quantity is required.',
      });
    }

    const validatedTiers = z.array(ticketTierSchema).parse(rawTiers);
    const validatedData = createEventSchema.parse(req.body);
    const category = await categoryColumns(validatedData.type, validatedData.customCategoryId);
    const schedule = { ...resolveSchedule(validatedData), city: validatedData.city, venue: validatedData.venue };
    // The same event entered twice by mistake: ask the organizer first (they can still create it on purpose,
    // e.g. a second show of the same name later that day). Checked before the venue so the message is clear.
    if (!['true', true].includes(req.body.allowDuplicate)) {
      const [duplicate] = await findDuplicateEvents({ companyId: company.id, name: validatedData.name, startsAt: schedule.startsAt, venue: validatedData.venue });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          field: 'duplicate',
          message: duplicate.sameSlot
            ? `You already created “${duplicate.name}” at the same venue and time.`
            : `You already have an event called “${duplicate.name}”${duplicate.sameDay ? ' on this date' : ''}.`,
          duplicate,
        });
      }
    }
    // Checked before uploading images, and again under the venue lock when saving
    await assertVenueFree(schedule);

    // Organizer images (validated from their bytes, all optional). With no banner the web app shows the
    // category artwork, so nothing is stored for it.
    const files = req.files || {};
    const galleryFiles = files.galleryImages || [];
    if (galleryFiles.length > EVENT_IMAGE_SPECS.gallery.maxCount) {
      throw new MediaValidationError(`Scrolling Gallery Images: at most ${EVENT_IMAGE_SPECS.gallery.maxCount} images.`);
    }
    const single = (field, kind) => (files[field]?.[0] ? [{ file: files[field][0], kind, field }] : []);
    const uploads = [
      ...single('banner', 'banner'),
      ...single('cardImage', 'card'),
      ...single('galleryWide', 'galleryWide'),
      ...galleryFiles.map((file) => ({ file, kind: 'gallery', field: 'galleryImages' })),
    ];
    const urls = await uploadEventImages(uploads);
    const uploaded = (field) => urls.filter((_, i) => uploads[i].field === field);

    const bannerUrl = uploaded('banner')[0] || validatedData.bannerUrl || null;
    const cardImageUrl = uploaded('cardImage')[0] || null;
    const galleryWideUrl = uploaded('galleryWide')[0] || null;
    const galleryUrls = uploaded('galleryImages');

    // Atomic transaction: create event + ticket tiers
    const createdEvent = await prisma.$transaction(async (tx) => {
      await assertVenueFree(schedule, tx);
      const event = await tx.event.create({
        data: {
          companyId: company.id,
          name: validatedData.name,
          description: validatedData.description,
          ...category,
          // Organizers' events start unpublished and go on sale only after admin approval
          status: req.user.role === 'SUPER_ADMIN' ? validatedData.status : validatedData.status === 'PRELAUNCH_ANALYSIS' ? 'PRELAUNCH_ANALYSIS' : 'DRAFT',
          ...(req.user.role === 'SUPER_ADMIN' && validatedData.status === 'PUBLISHED' ? { approvedAt: new Date() } : {}),
          date: new Date(validatedData.date),
          time: validatedData.time,
          startsAt: schedule.startsAt,
          endsAt: schedule.endsAt,
          city: validatedData.city,
          venue: validatedData.venue,
          latitude: validatedData.latitude ?? null,
          longitude: validatedData.longitude ?? null,
          locationAddress: validatedData.locationAddress ?? null,
          contactEmail: validatedData.contactEmail ?? null,
          bannerUrl,
          cardImageUrl,
          galleryWideUrl,
          galleryImages: {
            create: galleryUrls.map((url, position) => ({ url, position })),
          },
        },
      });
      // Event-scoped members (Event Managers) work on the events they create
      if (req.org?.eventScoped) {
        await tx.staffEventAssignment.create({ data: { staffId: req.user.id, eventId: event.id, assignedById: req.user.id } });
      }

      // Create ticket tiers
      await Promise.all(
        validatedTiers.map((tier) =>
          tx.ticketTier.create({
            data: {
              eventId: event.id,
              name: tier.name,
              price: tier.price,
              totalQuantity: tier.totalQuantity,
              availableQuantity: tier.totalQuantity,
            },
          })
        )
      );

      // Audit log
      await tx.auditLog.create({
        data: {
          userId,
          action: 'EVENT_CREATED',
          targetType: 'Event',
          targetId: event.id,
          details: { name: event.name, type: event.type, city: event.city },
        },
      });

      return tx.event.findUnique({
        where: { id: event.id },
        include: {
          tiers: true,
          galleryImages: { orderBy: { position: 'asc' } },
          company: {
            select: { id: true, companyName: true, city: true },
          },
        },
      });
    });

    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'EVENT_CREATED',
        title: `Event created: ${createdEvent.name}`,
        message: `“${createdEvent.name}” is saved privately. Set up seating, then send it to TicketLedger for approval to put it on sale.`,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Event and ticket tiers created successfully.',
      data: { event: createdEvent },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || 'Validation error',
        errors: error.errors,
      });
    }
    if (error instanceof MediaValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof ScheduleError || error instanceof CategoryError) {
      return res.status(error.status).json({ success: false, message: error.message, ...error.details });
    }
    console.error('Error creating event:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create event',
      error: error.message,
    });
  }
};

/** GET /api/events/categories: the fixed categories plus the ones organizers have added. */
export const getCategories = async (req, res) => {
  try {
    return res.json({ success: true, data: await listCategories() });
  } catch (error) {
    console.error('Error listing categories:', error);
    return res.status(500).json({ success: false, message: 'Could not load categories' });
  }
};

/**
 * POST /api/events/categories { name }: adds a custom category when none of the fixed ones fits. A name
 * that matches a fixed category is refused; one that already exists is returned instead of duplicated.
 */
export const createCategory = async (req, res) => {
  try {
    const { category, created } = await addCustomCategory(req.body?.name, req.user.id);
    return res.status(created ? 201 : 200).json({
      success: true,
      message: created ? `Added “${category.name}”.` : `“${category.name}” already exists, so it was selected.`,
      data: { category, created },
    });
  } catch (error) {
    if (error instanceof CategoryError) return res.status(error.status).json({ success: false, message: error.message, ...error.details });
    console.error('Error adding category:', error);
    return res.status(500).json({ success: false, message: 'Could not add the category' });
  }
};

/**
 * GET /api/events/schedule-check: live venue check for the create / edit form.
 * Query: city, venue, date, time, endDate, endTime (PKT) and, when editing, excludeEventId.
 * Answers { available, field?, message?, conflicts } with the same rules and wording the save uses.
 */
export const checkEventSchedule = async (req, res) => {
  try {
    const { city, venue, date, time, endDate, endTime, excludeEventId, name } = req.query;
    const schedule = resolveSchedule({ date, time, endDate, endTime });
    const conflicts = await findScheduleConflicts({ ...schedule, city, venue, excludeEventId: excludeEventId || undefined });
    // With the event name: the organizer's own events that look like this one (same name, same day)
    const duplicates = name
      ? await findDuplicateEvents({ companyId: await companyIdFor(req.user), name, startsAt: schedule.startsAt, venue, excludeEventId: excludeEventId || undefined })
      : [];
    return res.status(200).json({
      success: true,
      data: {
        duplicates,
        available: conflicts.length === 0,
        ...(conflicts.length ? { field: 'schedule', message: conflicts[0].message } : {}),
        conflicts: conflicts.map((c) => c.message),
      },
    });
  } catch (error) {
    if (error instanceof ScheduleError) {
      return res.status(200).json({ success: true, data: { available: false, field: error.details.field, message: error.message, conflicts: [] } });
    }
    console.error('Error checking event schedule:', error);
    return res.status(500).json({ success: false, message: 'Could not check the venue schedule' });
  }
};

/**
 * Public discovery endpoint with multi-criteria filtering
 */
export const getEvents = async (req, res) => {
  try {
    const { type, category, city, search, startDate, endDate, minPrice, maxPrice, status } = req.query;

    // Dates their organizer keeps hidden stay off discovery (they keep their slot and sold tickets)
    const where = { isHidden: false };

    // Discovery only lists public events (unapproved or draft events stay private)
    where.status = ['PUBLISHED', 'COMPLETED', 'PAUSED'].includes(status) ? status : 'PUBLISHED';

    if (type) {
      where.type = type;
    }
    // One organizer-added category, by its slug
    if (category) {
      where.customCategory = { slug: String(category) };
    }

    if (city) {
      where.city = { equals: city, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { venue: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Price filtering on tiers
    if (minPrice || maxPrice) {
      where.tiers = {
        some: {
          ...(minPrice ? { price: { gte: parseFloat(minPrice) } } : {}),
          ...(maxPrice ? { price: { lte: parseFloat(maxPrice) } } : {}),
        },
      };
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        tiers: {
          orderBy: { price: 'asc' },
        },
        company: {
          select: { id: true, companyName: true, status: true, city: true },
        },
        _count: {
          select: { tickets: true, seats: true },
        },
      },
      orderBy: { date: 'asc' },
    });
    // Ticket counts from the seats, so "sold out" here matches the seat map
    await applySeatAvailability(events);

    // Compute min and max pricing for quick frontend badge display
    const formattedEvents = events.map(({ promotionNote, promotionComment, ...event }) => {
      const prices = event.tiers.map((t) => Number(t.price));
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;
      const totalAvailable = event.tiers.reduce((acc, t) => acc + t.availableQuantity, 0);

      return {
        ...event,
        // "Top of listings" running now: listed before the other events, the latest promotion first
        featured: isPromotionActive(event, 'priority'),
        featuredSince: isPromotionActive(event, 'priority') ? new Date(promotionStartedAt(event, 'priority')).toISOString() : null,
        featuredUntil: isPromotionActive(event, 'priority') ? event.priorityEndsAt : null,
        pricing: {
          minPrice: minP,
          maxPrice: maxP,
          totalAvailable,
        },
      };
    });
    // Featured events first (the latest promotion on top), the rest still in date order (the sort is stable)
    formattedEvents.sort((a, b) => Number(b.featured) - Number(a.featured) || (a.featured ? new Date(b.featuredSince) - new Date(a.featuredSince) : 0));

    if (type) {
      behaviorService.trackBehavior({
        req,
        action: BEHAVIOR_ACTIONS.CATEGORY_VIEW,
        metadata: { category: type, city: city || null },
      });
    }

    // Search activity (normalised text only, at most 80 characters; the results shown, not personal data)
    if (search && String(search).trim()) {
      behaviorService.trackBehavior({
        req,
        action: BEHAVIOR_ACTIONS.SEARCH,
        metadata: {
          query: String(search).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80),
          filters: { type: type || null, city: city || null, category: category || null },
          resultCount: formattedEvents.length,
          resultEventIds: formattedEvents.slice(0, 20).map((e) => e.id),
        },
      });
    }

    return res.status(200).json({
      success: true,
      count: formattedEvents.length,
      data: { events: formattedEvents },
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve events',
      error: error.message,
    });
  }
};

/**
 * Public detailed event info
 */
export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tiers: {
          orderBy: { price: 'asc' },
        },
        galleryImages: {
          orderBy: { position: 'asc' },
          select: { id: true, url: true, position: true },
        },
        company: {
          select: {
            id: true,
            companyName: true,
            ownerName: true,
            email: true,
            phone: true,
            city: true,
            status: true,
            user: { select: { email: true } },
          },
        },
        _count: {
          select: { seats: true, tickets: true },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    // Ticket counts from the seats, so "sold out" on the event page matches the seat map
    await applySeatAvailability(event);

    // "Contact organizer": the event's own contact email, else the organizer's company / account email
    event.organizerContactEmail = event.contactEmail || event.company?.email || event.company?.user?.email || null;
    if (event.company) delete event.company.user;

    // Draft, pending and rejected events: only the organizer and admins can open them (as a preview)
    // Hidden dates: the organizer, admins and people who already hold tickets can still open them
    const holdsTicket = async () =>
      Boolean(req.user) && (await prisma.ticket.count({ where: { eventId: event.id, userId: req.user.id } })) > 0;
    if (event.isHidden && ['PUBLISHED', 'PAUSED', 'COMPLETED'].includes(event.status) && !(await canManageEvent(req.user, event, { permission: 'event.view' })) && !(await holdsTicket())) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    const isPublic = ['PUBLISHED', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(event.status);
    if (!isPublic) {
      if (!(await canManageEvent(req.user, event, { permission: 'event.view' }))) {
        return res.status(404).json({ success: false, message: 'Event not found' });
      }
      return res.status(200).json({ success: true, data: { event, preview: true } });
    }

    // The organizer's promotion message and the admin's reply stay between them
    delete event.promotionNote;
    delete event.promotionComment;

    // "Was / now" banner after a date or venue change
    if (event.rescheduledAt) {
      event.lastScheduleChange = await prisma.eventScheduleChange.findFirst({
        where: { eventId: event.id, status: 'APPROVED' },
        orderBy: { reviewedAt: 'desc' },
        select: { oldDate: true, oldTime: true, oldStartsAt: true, oldVenue: true, oldCity: true, newStartsAt: true, reason: true, minor: true, reviewedAt: true },
      });
    }

    behaviorService.trackBehavior({
      req,
      action: BEHAVIOR_ACTIONS.EVENT_VIEW,
      eventId: event.id,
      metadata: { eventName: event.name, category: event.type, city: event.city },
    });

    return res.status(200).json({
      success: true,
      data: { event },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve event details',
      error: error.message,
    });
  }
};

/**
 * Organizer retrieves their hosted events
 */
export const getOrganizerEvents = async (req, res) => {
  try {
    const userId = req.user.id;

    // Organizers see only their company's events; Super Admins see every event
    // Members see their organization's events (event-scoped roles: only their assigned events)
    let where = {};
    if (req.user.role !== 'SUPER_ADMIN' || req.org) {
      const ctx = req.org ?? (await requestContext(req));
      if (!ctx) {
        return res.status(200).json({ success: true, data: { events: [] } });
      }
      where = eventWhereFor(ctx, 'event.view');
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        tiers: true,
        _count: {
          select: { tickets: true, orders: true, seats: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: { events },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve organizer events',
      error: error.message,
    });
  }
};

/**
 * Update event status (Publish, Pause, Cancel, Complete)
 */
export const updateEventStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = [
      'DRAFT',
      'PRELAUNCH_ANALYSIS',
      'PUBLISHED',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Members holding event.lifecycle for this event, or a Super Admin
    if (!(await canManageEvent(req.user, event, { permission: 'event.lifecycle', req }))) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify this event.',
      });
    }

    // Cancelling refunds every ticket holder: it has its own endpoint (POST /events/:id/cancel)
    if (status === 'CANCELLED' && event.status !== 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Cancel the event from “Cancel or change date”, so ticket holders are refunded and told.' });
    }
    if (event.status === 'CANCELLED' && status !== 'CANCELLED') {
      return res.status(409).json({ success: false, message: 'A cancelled event can’t be reopened: its tickets have been refunded. Create a new event instead.' });
    }
    if (event.postponedAt && status === 'PUBLISHED') {
      return res.status(409).json({ success: false, message: 'This event is postponed. Set its new date with Reschedule; it goes back on sale once the date is confirmed.' });
    }

    // Organizers can pause and resume live sales, cancel or complete, but going on sale needs admin approval
    if (req.user.role !== 'SUPER_ADMIN') {
      if (status === 'PUBLISHED' && event.status !== 'PAUSED') {
        return res.status(403).json({ success: false, message: 'Send the event for approval: it goes on sale once a TicketLedger admin approves it.' });
      }
      if (status === 'PAUSED' && event.status !== 'PUBLISHED') {
        return res.status(400).json({ success: false, message: 'Only an event that is on sale can be paused.' });
      }
      if (['DRAFT', 'PRELAUNCH_ANALYSIS'].includes(status) && !['DRAFT', 'PRELAUNCH_ANALYSIS', 'REJECTED'].includes(event.status)) {
        return res.status(400).json({ success: false, message: 'This event can’t go back to draft.' });
      }
    }

    // A cancelled or rejected event released its venue slot; bringing it back needs the slot to still be free
    const updated = await prisma.$transaction(async (tx) => {
      if (RELEASED_STATUSES.includes(event.status) && !RELEASED_STATUSES.includes(status)) {
        const { start, end } = occupiedInterval(event);
        await assertVenueFree({ ...venueOf(event), startsAt: start, endsAt: end, excludeEventId: id }, tx);
      }
      return tx.event.update({
        where: { id },
        data: { status, ...(req.user.role === 'SUPER_ADMIN' && status === 'PUBLISHED' && !event.approvedAt ? { approvedAt: new Date() } : {}) },
        include: { tiers: true },
      });
    });

    return res.status(200).json({
      success: true,
      message: `Event status updated to ${status}.`,
      data: { event: updated },
    });
  } catch (error) {
    if (error instanceof ScheduleError) {
      return res.status(error.status).json({ success: false, message: error.message, ...error.details });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to update event status',
      error: error.message,
    });
  }
};

/**
 * MODULE 17: Pre-launch demand estimate & pricing notes (RULES, Step 6)
 * A fixed-rule estimate of 48h sales and revenue, a rule-of-thumb launch time and price notes. No model and no
 * historical analysis is involved, and the text says so. Nothing here changes prices or publishes the event.
 */
/** `tierPrices` query: "tierId:price,tierId:price" (what-if prices, never saved). Null when absent or empty. */
function parseTierPrices(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const out = {};
  for (const part of raw.split(',').slice(0, 50)) {
    const [tid, p] = part.split(':');
    const n = Number(p);
    if (tid && Number.isFinite(n) && n > 0 && n <= 1_000_000) out[tid.trim()] = n;
  }
  return Object.keys(out).length ? out : null;
}

const PAID = ['SUCCESSFUL', 'PARTIALLY_REFUNDED'];
const HOURS_48 = 48 * 3600_000;
/**
 * Real sales of an event: tickets sold so far (paid, not cancelled), per tier, and in the first 48 hours after
 * sales opened. `window_complete` is false while those 48 hours are still running.
 */
async function salesActuals(event, now = new Date()) {
  const opened = event.salesOpenAt || event.publishAt || event.approvedAt || null;
  const sold = await prisma.ticket.findMany({
    where: { eventId: event.id, status: { not: 'CANCELLED' }, order: { status: { in: PAID } } },
    select: { price: true, createdAt: true, seat: { select: { tierId: true } } },
  });
  const byTier = {};
  let revenue = 0;
  let first48 = 0;
  for (const t of sold) {
    byTier[t.seat.tierId] = (byTier[t.seat.tierId] || 0) + 1;
    revenue += Number(t.price);
    if (opened && t.createdAt >= opened && t.createdAt < new Date(opened.getTime() + HOURS_48)) first48 += 1;
  }
  const onSale = Boolean(opened) && ['PUBLISHED', 'PAUSED', 'COMPLETED'].includes(event.status) && opened <= now;
  return {
    on_sale: onSale,
    sales_opened_at: opened,
    sold_total: sold.length,
    revenue_so_far_pkr: Math.round(revenue),
    sold_first_48h: onSale ? first48 : null,
    window_complete: onSale ? now.getTime() >= opened.getTime() + HOURS_48 : false,
    by_tier: byTier,
  };
}

export const getPreLaunchDemandForecast = async (req, res) => {
  try {
    const { id } = req.params;
    const { simulatedPrice } = req.query;
    const prices = parseTierPrices(req.query.tierPrices);

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        tiers: { orderBy: { price: 'asc' } },
        company: true,
      },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Permission check
    if (!(await canManageEvent(req.user, event, { permission: 'event.pricing', req }))) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view pre-launch analytics for this event.',
      });
    }

    // 1-3. Rule estimate for THIS event (services/demandRules.js prelaunchEstimate): real capacity, weighted
    // prices against the category benchmark, day and lead time. A what-if only changes prices, never saves them.
    const whatIf = Boolean(prices || Number(simulatedPrice) > 0);
    const tiers = tiersWithPrices(event.tiers, { prices, scalePrice: simulatedPrice });
    const forecastResult = prelaunchEstimate(event, { tiers });
    const capacity = forecastResult.capacity;
    const avgPrice = forecastResult.avg_price;

    // 4. Publish window (rule of thumb; "already on sale" for a live event)
    const publish = publishSuggestion(event);

    // 5. Price note against the category benchmark
    const pricingWarning = priceNote({ avgPrice, benchmark: forecastResult.benchmark_price, share: forecastResult.sellout_probability });

    // 6. Real sales so far (live events): the estimate next to what actually happened
    const actuals = await salesActuals(event);

    // Shadow log (real forecasts only, not "what if" simulations): what the page showed, and what the
    // demand model would say. Runs after the response; never changes the forecast. An event with no ticket
    // tiers has nothing to forecast, so nothing is logged (it used to log a "missing input" skip).
    if (!whatIf && event.tiers.length > 0) {
      const asOf = new Date();
      recordShadow({
        // One per event per day. Step 6 fix: eventId, userId and asOf used to sit inside this comment, so every
        // EVENT_FORECAST snapshot failed to write ("asOf is missing") and was silently dropped.
        name: 'demand', subjectType: 'EVENT_FORECAST', subjectId: `${event.id}|${asOf.toISOString().slice(0, 10)}`,
        eventId: event.id, userId: req.user?.id ?? null, asOf,
        rule: {
          score: forecastResult.projected_48h_sales, decision: forecastResult.demand_tier,
          output: { sellout_probability: forecastResult.sellout_probability, capacity_used: capacity, rule_version: forecastResult.rule_version, fallback: false },
        },
        buildFeatures: () => demandSnapshot({ eventId: event.id, at: asOf }),
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        eventId: event.id,
        eventName: event.name,
        eventType: event.type,
        city: event.city,
        venue: event.venue,
        eventDate: event.date,
        eventTime: event.time,
        status: event.status,
        venueCapacity: capacity,
        avgTicketPrice: Math.round(avgPrice),
        predicted_48h_sales: forecastResult.projected_48h_sales,
        expected_revenue_pkr: forecastResult.projected_revenue_pkr,
        demand_level: forecastResult.demand_level,
        demand_tier: forecastResult.demand_tier,
        sellout_probability: forecastResult.sellout_probability,
        benchmark_price: forecastResult.benchmark_price,
        factors: forecastResult.factors,
        formula: forecastResult.formula,
        rule_version: forecastResult.rule_version,
        what_if: whatIf,
        suggested_publish_time: publish.time,
        suggested_window_reason: publish.reason,
        already_published: publish.already_published,
        pricing_warning: pricingWarning,
        pricing_recommendation: pricingWarning.recommendation,
        prediction_source: forecastResult.prediction_source,
        validated: false,
        prediction_notice: forecastResult.notice,
        actuals,
        // Saved prices (the what-if prices are never stored); each tier with how many tickets it has sold
        tiers: event.tiers.map((t) => ({ ...t, sold: actuals.by_tier[t.id] || 0 })),
      },
    });
  } catch (error) {
    console.error('Error computing pre-launch demand forecast:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to compute pre-launch demand forecast',
      error: error.message,
    });
  }
};

/**
 * Adjust ticket tier prices before publishing
 */
/**
 * The tiers a pricing request may change: every id must be a tier of THIS event. Checked before anything is
 * written, so a request naming another event's tier (another organizer's) changes nothing.
 */
async function foreignTierIds(eventId, tiers) {
  const own = new Set((await prisma.ticketTier.findMany({ where: { eventId }, select: { id: true } })).map((t) => t.id));
  return tiers.filter((t) => t?.id && !own.has(t.id)).map((t) => t.id);
}
const FOREIGN_TIER = { success: false, code: 'TIER_NOT_IN_EVENT', message: 'A ticket tier in this request does not belong to this event.' };

export const updateEventPricing = async (req, res) => {
  try {
    const { id } = req.params;
    const { tiers } = req.body; // Array of { id, price }

    if (!Array.isArray(tiers) || tiers.length === 0) {
      return res.status(400).json({ success: false, message: 'tiers array is required' });
    }

    const event = await prisma.event.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Permission check
    if (!(await canManageEvent(req.user, event, { permission: 'event.pricing', req }))) {
      return res.status(403).json({ success: false, message: 'Unauthorized to modify pricing' });
    }
    if (reviewLocked(req.user, event)) return res.status(409).json({ success: false, code: 'UNDER_REVIEW', message: REVIEW_LOCK_MESSAGE });

    if ((await foreignTierIds(id, tiers)).length) return res.status(400).json(FOREIGN_TIER);
    for (const t of tiers) {
      if (t.id && t.price) {
        await prisma.ticketTier.updateMany({ where: { id: t.id, eventId: id }, data: { price: Number(t.price) } });
      }
    }

    const updatedEvent = await prisma.event.findUnique({
      where: { id },
      include: { tiers: { orderBy: { price: 'asc' } } },
    });

    return res.status(200).json({
      success: true,
      message: 'Ticket tier pricing updated successfully.',
      data: { event: updatedEvent },
    });
  } catch (error) {
    console.error('Error updating event pricing:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update event pricing',
      error: error.message,
    });
  }
};

/**
 * Save adjusted pricing and publish event (transitions status to PUBLISHED)
 */
export const publishEventWithPricing = async (req, res) => {
  try {
    const { id } = req.params;
    const { tiers } = req.body;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { company: true },
    });

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // Permission check
    if (!(await canManageEvent(req.user, event, { permission: 'event.pricing', req }))) {
      return res.status(403).json({ success: false, message: 'Unauthorized to publish event' });
    }
    if (reviewLocked(req.user, event)) return res.status(409).json({ success: false, code: 'UNDER_REVIEW', message: REVIEW_LOCK_MESSAGE });

    // If tiers were adjusted, update them
    if (Array.isArray(tiers) && tiers.length > 0) {
      if ((await foreignTierIds(id, tiers)).length) return res.status(400).json(FOREIGN_TIER);
      for (const t of tiers) {
        if (t.id && t.price) {
          await prisma.ticketTier.updateMany({ where: { id: t.id, eventId: id }, data: { price: Number(t.price) } });
        }
      }
    }

    // Prices are saved; an event goes on sale only through admin approval (a live event stays live)
    const published = await prisma.event.findUnique({
      where: { id },
      include: { tiers: { orderBy: { price: 'asc' } } },
    });
    const live = ['PUBLISHED', 'PAUSED'].includes(published.status);

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: live ? 'EVENT_PRICES_UPDATED' : 'EVENT_PRICES_SET_AFTER_PRELAUNCH_ANALYSIS',
        targetType: 'Event',
        targetId: id,
        details: {
          eventName: event.name,
          city: event.city,
          tiers: published.tiers.map((t) => ({ name: t.name, price: Number(t.price) })),
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: live
        ? `Prices for "${published.name}" are saved. Event is PUBLISHED.`
        : `Prices for "${published.name}" are saved. Set up seating next, then send the event for approval.`,
      data: { event: published },
    });
  } catch (error) {
    console.error('Error publishing event with pricing:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to publish event',
      error: error.message,
    });
  }
};

/**
 * Organizer loads an event for editing (no view tracking, any status)
 */
export const getEventForEdit = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        tiers: { orderBy: { price: 'asc' } },
        galleryImages: { orderBy: { position: 'asc' }, select: { id: true, url: true, position: true } },
      },
    });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    if (!(await canManageEvent(req.user, event, { permission: 'event.view', req }))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit this event.' });
    }
    // The form edits the end as PKT date + time. Older events have no stored end: prefill the end the
    // venue checks already assume for them (start + 3 hours), so the form isn't blocked on an empty field
    const end = toPktParts(occupiedInterval(event).end);
    // With ticket holders, the date and venue change through Reschedule (approval, notices, refunds)
    const ticketsHeld = await prisma.ticket.count({ where: { eventId: event.id, status: { in: ['ACTIVE', 'SCANNED'] } } });
    return res.status(200).json({ success: true, data: { event: { ...event, endDate: end.date, endTime: end.time, ticketsHeld } } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load event', error: error.message });
  }
};

/**
 * POST /api/events/:id/tiers { tiers: [{ name, price, totalQuantity }] }: the first ticket tiers of an event
 * created without any (a prebooked date, once reserved), so it continues through the same Tickets → Seating →
 * Review steps as a registered event. Refused once the event has tiers; those change through seating and pricing.
 */
export const setInitialTiers = async (req, res) => {
  try {
    const tiers = z.array(ticketTierSchema).min(1, 'Add at least one ticket tier.').max(20).parse(req.body.tiers);
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { _count: { select: { tiers: true } } } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event, { requireApproved: true }))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit this event.' });
    }
    if (reviewLocked(req.user, event)) return res.status(409).json({ success: false, code: 'UNDER_REVIEW', message: REVIEW_LOCK_MESSAGE });
    if (event._count.tiers > 0) {
      return res.status(409).json({ success: false, message: 'This event already has ticket tiers. Change them in Venue & seating or Demand forecast.' });
    }
    const created = await prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction, so a double submit can't add the tiers twice
      if (await tx.ticketTier.count({ where: { eventId: event.id } })) return null;
      return Promise.all(
        tiers.map((t) =>
          tx.ticketTier.create({ data: { eventId: event.id, name: t.name.trim(), price: t.price, totalQuantity: t.totalQuantity, availableQuantity: t.totalQuantity } })
        )
      );
    });
    if (!created) return res.status(409).json({ success: false, message: 'This event already has ticket tiers.' });
    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_TIERS_ADDED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, tiers: tiers.map((t) => ({ name: t.name, price: t.price })) } },
    });
    return res.status(201).json({ success: true, message: 'Ticket tiers saved.', data: { tiers: created } });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid tiers' });
    console.error('Set initial tiers failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to save the ticket tiers.' });
  }
};

/**
 * Organizer updates event details and media in one save.
 *
 * Multipart body:
 * - Detail fields (name, description, type, date, time, endDate, endTime, city, venue); omitted fields are
 *   unchanged. Changing the venue or schedule re-checks the venue for clashes (one-hour gap rule).
 * - banner / cardImage / galleryWide: a new file replaces the image; `<field>Action=remove` clears it;
 *   otherwise the saved image is kept.
 * - galleryImages: new files; galleryOrder: JSON list of { id } (saved image) or { upload: n } (nth new
 *   file) giving the final order. Saved images left out are removed. Without galleryOrder, new files
 *   are appended and the existing gallery is unchanged.
 *
 * New files are validated and uploaded before anything is written; the event changes in a single
 * transaction, and previous files are left in storage, so a failed save never breaks the live page.
 */
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: { galleryImages: { orderBy: { position: 'asc' } } },
    });
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    if (!(await canManageEvent(req.user, event, { requireApproved: true }))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit this event.' });
    }
    if (reviewLocked(req.user, event)) return res.status(409).json({ success: false, code: 'UNDER_REVIEW', message: REVIEW_LOCK_MESSAGE });

    const detailKeys = Object.keys(updateEventDetailsSchema.shape).filter((k) => req.body[k] !== undefined);
    const details = updateEventDetailsSchema.parse(Object.fromEntries(detailKeys.map((k) => [k, req.body[k]])));

    // Venue or schedule changes: resolve the full schedule (saved values fill omitted fields) and check the venue
    const scheduleKeys = ['date', 'time', 'endDate', 'endTime', 'city', 'venue'];
    let schedule = null;
    let venueMoved = false;
    if (scheduleKeys.some((k) => details[k] !== undefined)) {
      const savedEnd = toPktParts(occupiedInterval(event).end);
      // Ticket holders must be told about (and can opt out of) a new date or venue: that goes through Reschedule
      const ticketsHeld = await prisma.ticket.count({ where: { eventId: id, status: { in: ['ACTIVE', 'SCANNED'] } } });
      const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
      const moved =
        (details.date !== undefined && String(details.date).slice(0, 10) !== event.date.toISOString().slice(0, 10)) ||
        (details.time !== undefined && parseTimeOfDay(details.time) !== parseTimeOfDay(event.time)) ||
        // Older events have no stored end: adding one isn't a move
        (event.endsAt && details.endDate !== undefined && String(details.endDate).slice(0, 10) !== savedEnd.date) ||
        (event.endsAt && details.endTime !== undefined && parseTimeOfDay(details.endTime) !== parseTimeOfDay(savedEnd.time)) ||
        (details.city !== undefined && !sameText(details.city, event.city)) ||
        (details.venue !== undefined && !sameText(details.venue, event.venue));
      // An approved (or reserved) event keeps the slot an admin approved: moving it is a date-change request the
      // admins approve, and ticket holders are told and can get a refund
      const approved = ['PUBLISHED', 'PAUSED'].includes(event.status);
      if ((ticketsHeld > 0 || approved) && moved && req.user.role !== 'SUPER_ADMIN') {
        return res.status(409).json({
          success: false,
          field: 'schedule',
          code: 'RESCHEDULE_REQUIRED',
          message: ticketsHeld > 0
            ? `${ticketsHeld} ticket${ticketsHeld === 1 ? ' is' : 's are'} already sold, so the date, time and venue can only be changed with a date-change request. A TicketLedger admin approves it, and attendees are told and can get a refund.`
            : 'This event is approved, so a new date, time or venue has to be requested and approved by a TicketLedger admin. Use “Change date or venue”.',
        });
      }
      schedule = {
        ...resolveSchedule({
          date: details.date ?? event.date,
          time: details.time ?? event.time,
          endDate: details.endDate ?? savedEnd.date,
          endTime: details.endTime ?? savedEnd.time,
        }),
        city: details.city ?? event.city,
        venue: details.venue ?? event.venue,
        excludeEventId: id,
      };
      // The place picked on the map stays with the venue; typing a different venue lets go of it
      venueMoved = (details.city !== undefined && !sameText(details.city, event.city)) || (details.venue !== undefined && !sameText(details.venue, event.venue));
      if (!venueMoved) Object.assign(schedule, { venuePlaceId: event.venuePlaceId, venueSpace: event.venueSpace });
      if (event.status !== 'CANCELLED') await assertVenueFree(schedule);
    }

    const files = req.files || {};
    const uploads = [];
    const singleChanges = {};
    for (const { field, column, kind } of SINGLE_IMAGE_FIELDS) {
      const file = files[field]?.[0];
      const action = req.body[`${field}Action`] || 'keep';
      if (!['keep', 'remove', 'replace'].includes(action)) {
        throw new MediaValidationError(`${EVENT_IMAGE_SPECS[kind].label}: unknown action "${action}".`);
      }
      if (file) {
        uploads.push({ file, kind, field });
      } else if (action === 'replace') {
        throw new MediaValidationError(`${EVENT_IMAGE_SPECS[kind].label}: choose a new image to replace the current one.`);
      } else if (action === 'remove') {
        singleChanges[column] = null;
      }
    }

    // Gallery: final ordered list of saved ids and new uploads
    const galleryFiles = files.galleryImages || [];
    let galleryPlan = null;
    if (req.body.galleryOrder !== undefined) {
      let rawOrder;
      try {
        rawOrder = JSON.parse(req.body.galleryOrder);
      } catch {
        throw new MediaValidationError('Invalid gallery order.');
      }
      galleryPlan = galleryOrderSchema.parse(rawOrder);
      const savedIds = new Set(event.galleryImages.map((img) => img.id));
      const seenIds = new Set();
      const seenUploads = new Set();
      for (const item of galleryPlan) {
        if ('id' in item) {
          if (!savedIds.has(item.id) || seenIds.has(item.id)) throw new MediaValidationError('Gallery order refers to an unknown image.');
          seenIds.add(item.id);
        } else {
          if (item.upload >= galleryFiles.length || seenUploads.has(item.upload)) throw new MediaValidationError('Gallery order refers to a missing upload.');
          seenUploads.add(item.upload);
        }
      }
      if (seenUploads.size !== galleryFiles.length) throw new MediaValidationError('Every new gallery image needs a position.');
    } else if (galleryFiles.length) {
      galleryPlan = [...event.galleryImages.map((img) => ({ id: img.id })), ...galleryFiles.map((_, upload) => ({ upload }))];
      if (galleryPlan.length > EVENT_IMAGE_SPECS.gallery.maxCount) {
        throw new MediaValidationError(`Scrolling Gallery Images: at most ${EVENT_IMAGE_SPECS.gallery.maxCount} images.`);
      }
    }
    galleryFiles.forEach((file) => uploads.push({ file, kind: 'gallery', field: 'galleryImages' }));

    const urls = await uploadEventImages(uploads);
    const galleryUploadUrls = [];
    uploads.forEach((u, i) => {
      if (u.field === 'galleryImages') galleryUploadUrls.push(urls[i]);
      else singleChanges[SINGLE_IMAGE_FIELDS.find((f) => f.field === u.field).column] = urls[i];
    });

    const { endDate, endTime, type, customCategoryId, ...detailColumns } = details;
    const data = { ...detailColumns, ...singleChanges };
    if (type !== undefined || customCategoryId !== undefined) {
      Object.assign(data, await categoryColumns(type ?? event.type, customCategoryId ?? event.customCategoryId));
    }
    if (details.date) data.date = new Date(details.date);
    if (schedule) Object.assign(data, { startsAt: schedule.startsAt, endsAt: schedule.endsAt });
    if (venueMoved) Object.assign(data, { venuePlaceId: null, venueSpace: null });

    const updated = await prisma.$transaction(async (tx) => {
      if (schedule && event.status !== 'CANCELLED') await assertVenueFree(schedule, tx);
      await tx.event.update({ where: { id }, data });

      if (galleryPlan) {
        const keptIds = galleryPlan.filter((item) => 'id' in item).map((item) => item.id);
        await tx.eventGalleryImage.deleteMany({ where: { eventId: id, id: { notIn: keptIds } } });
        for (const [position, item] of galleryPlan.entries()) {
          if ('id' in item) {
            await tx.eventGalleryImage.update({ where: { id: item.id }, data: { position } });
          } else {
            await tx.eventGalleryImage.create({ data: { eventId: id, url: galleryUploadUrls[item.upload], position } });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'EVENT_UPDATED',
          targetType: 'Event',
          targetId: id,
          // Before / after of each changed field: the event's change history (Event tools → History)
          details: {
            fields: Object.keys(data),
            galleryCount: galleryPlan ? galleryPlan.length : event.galleryImages.length,
            eventName: event.name,
            before: Object.fromEntries(Object.keys(data).filter((k) => String(event[k] ?? '') !== String(data[k] ?? '')).map((k) => [k, event[k] ?? null])),
            after: Object.fromEntries(Object.keys(data).filter((k) => String(event[k] ?? '') !== String(data[k] ?? '')).map((k) => [k, data[k] ?? null])),
          },
        },
      });

      return tx.event.findUnique({
        where: { id },
        include: {
          tiers: { orderBy: { price: 'asc' } },
          galleryImages: { orderBy: { position: 'asc' }, select: { id: true, url: true, position: true } },
        },
      });
    });

    await prisma.notification.create({
      data: {
        userId: req.user.id,
        type: 'EVENT_UPDATED',
        title: `Event updated: ${updated.name}`,
        message: `Your changes to “${updated.name}” were saved.`,
      },
    });

    return res.status(200).json({ success: true, message: 'Event updated successfully.', data: { event: updated } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Validation error', errors: error.errors });
    }
    if (error instanceof MediaValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof ScheduleError || error instanceof CategoryError) {
      return res.status(error.status).json({ success: false, message: error.message, ...error.details });
    }
    console.error('Error updating event:', error);
    return res.status(500).json({ success: false, message: 'Failed to update event', error: error.message });
  }
};


/**
 * Delete an event (its organizer or a Super Admin). Refused while anyone holds tickets or is mid-payment
 * (paid tickets must not vanish; cancel the event instead). Failed / abandoned orders go with the event;
 * tiers, seats, plans, gallery, wishlists and the rest are removed by the database cascades.
 */
export const deleteEvent = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id }, include: { company: true } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (!(await canManageEvent(req.user, event, { permission: 'event.delete', req }))) {
      return res.status(403).json({ success: false, message: 'You can only delete your own events.' });
    }

    const [sold, paying] = await Promise.all([
      // Any order where money moved (paid, partly or fully refunded) is a record that must be kept
      prisma.order.count({ where: { eventId: event.id, status: { in: ['SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } }),
      prisma.order.count({ where: { eventId: event.id, status: 'PENDING' } }),
    ]);
    if (sold || paying) {
      return res.status(409).json({
        success: false,
        message: sold
          ? `This event has ${sold} paid or refunded order${sold === 1 ? '' : 's'}, so it can’t be deleted. Cancel the event instead: ticket holders are refunded and keep their records.`
          : 'A customer is paying for tickets to this event right now. Try again in a few minutes, or cancel the event instead.',
      });
    }

    await prisma.$transaction(async (tx) => {
      // Abandoned / failed orders (their tickets go with them), then the event and its cascades
      await tx.order.deleteMany({ where: { eventId: event.id } });
      await tx.event.delete({ where: { id: event.id } });
    });

    await prisma.auditLog.create({
      data: { userId: req.user.id, action: 'EVENT_DELETED', targetType: 'Event', targetId: event.id, details: { eventName: event.name, companyId: event.companyId } },
    });
    // The organizer is told (and emailed) when an admin removes their event
    if (event.company && event.company.userId !== req.user.id) {
      await prisma.notification.create({
        data: {
          userId: event.company.userId,
          type: 'EVENT_DELETED',
          title: `Event removed: ${event.name}`,
          message: `“${event.name}” was deleted by a TicketLedger admin. Contact support if you have questions.`,
        },
      });
    }

    return res.json({ success: true, message: `“${event.name}” was deleted.` });
  } catch (error) {
    console.error('Delete event failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete the event.' });
  }
};
