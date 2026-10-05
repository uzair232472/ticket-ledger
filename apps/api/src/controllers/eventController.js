import { z } from 'zod';
import prisma from '../config/prisma.js';
import { MediaValidationError, uploadEventImages } from '../services/eventMediaService.js';
import { EVENT_IMAGE_SPECS } from '../config/eventMedia.js';
import { canManageEvent } from '../utils/eventAccess.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';
import mlService from '../services/mlService.js';

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
  ]),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  time: z.string().min(1, 'Event time is required'),
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
  .pick({ name: true, description: true, type: true, date: true, time: true, city: true, venue: true, latitude: true, longitude: true, locationAddress: true, contactEmail: true })
  .partial();

const SINGLE_IMAGE_FIELDS = [
  { field: 'banner', column: 'bannerUrl', kind: 'banner' },
  { field: 'cardImage', column: 'cardImageUrl', kind: 'card' },
  { field: 'galleryWide', column: 'galleryWideUrl', kind: 'galleryWide' },
];

const galleryOrderSchema = z
  .array(z.union([z.object({ id: z.string().min(1) }).strict(), z.object({ upload: z.number().int().min(0) }).strict()]))
  .max(EVENT_IMAGE_SPECS.gallery.maxCount, `Scrolling Gallery Images: at most ${EVENT_IMAGE_SPECS.gallery.maxCount} images.`);


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
      const event = await tx.event.create({
        data: {
          companyId: company.id,
          name: validatedData.name,
          description: validatedData.description,
          type: validatedData.type,
          // Organizers' events start unpublished and go on sale only after admin approval
          status: req.user.role === 'SUPER_ADMIN' ? validatedData.status : validatedData.status === 'PRELAUNCH_ANALYSIS' ? 'PRELAUNCH_ANALYSIS' : 'DRAFT',
          ...(req.user.role === 'SUPER_ADMIN' && validatedData.status === 'PUBLISHED' ? { approvedAt: new Date() } : {}),
          date: new Date(validatedData.date),
          time: validatedData.time,
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
    console.error('Error creating event:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create event',
      error: error.message,
    });
  }
};

/**
 * Public discovery endpoint with multi-criteria filtering
 */
export const getEvents = async (req, res) => {
  try {
    const { type, city, search, startDate, endDate, minPrice, maxPrice, status } = req.query;

    const where = {};

    // Discovery only lists public events (unapproved or draft events stay private)
    where.status = ['PUBLISHED', 'COMPLETED', 'PAUSED'].includes(status) ? status : 'PUBLISHED';

    if (type) {
      where.type = type;
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

    // Compute min and max pricing for quick frontend badge display
    const formattedEvents = events.map((event) => {
      const prices = event.tiers.map((t) => Number(t.price));
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;
      const totalAvailable = event.tiers.reduce((acc, t) => acc + t.availableQuantity, 0);

      return {
        ...event,
        pricing: {
          minPrice: minP,
          maxPrice: maxP,
          totalAvailable,
        },
      };
    });

    if (type) {
      behaviorService.trackBehavior({
        req,
        action: BEHAVIOR_ACTIONS.CATEGORY_VIEW,
        metadata: { category: type, city: city || null },
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

    // "Contact organizer": the event's own contact email, else the organizer's company / account email
    event.organizerContactEmail = event.contactEmail || event.company?.email || event.company?.user?.email || null;
    if (event.company) delete event.company.user;

    // Draft, pending and rejected events: only the organizer and admins can open them (as a preview)
    const isPublic = ['PUBLISHED', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(event.status);
    if (!isPublic) {
      if (!(await canManageEvent(req.user, event))) {
        return res.status(404).json({ success: false, message: 'Event not found' });
      }
      return res.status(200).json({ success: true, data: { event, preview: true } });
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
    let where = {};
    if (req.user.role !== 'SUPER_ADMIN') {
      const company = await prisma.company.findUnique({ where: { userId } });
      if (!company) {
        return res.status(200).json({ success: true, data: { events: [] } });
      }
      where = { companyId: company.id };
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

    // Role check: Only the owning organizer or Super Admin can modify status
    if (req.user.role !== 'SUPER_ADMIN') {
      const company = await prisma.company.findUnique({ where: { userId: req.user.id } });
      if (!company || company.id !== event.companyId) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to modify this event.',
        });
      }
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

    const updated = await prisma.event.update({
      where: { id },
      data: { status, ...(req.user.role === 'SUPER_ADMIN' && status === 'PUBLISHED' && !event.approvedAt ? { approvedAt: new Date() } : {}) },
      include: { tiers: true },
    });

    return res.status(200).json({
      success: true,
      message: `Event status updated to ${status}.`,
      data: { event: updated },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update event status',
      error: error.message,
    });
  }
};

/**
 * MODULE 17: Pre-Launch AI Demand Forecast & Pricing Optimizer
 * Evaluates predicted 48h sales, expected revenue, demand tier, suggested launch time, and pricing warnings
 */
export const getPreLaunchDemandForecast = async (req, res) => {
  try {
    const { id } = req.params;
    const { simulatedPrice, simulatedCapacity, simulatedMarketingTier } = req.query;

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
    if (req.user.role !== 'SUPER_ADMIN') {
      const company = await prisma.company.findUnique({ where: { userId: req.user.id } });
      if (!company || company.id !== event.companyId) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view pre-launch analytics for this event.',
        });
      }
    }

    // 1. Calculate Capacity & Pricing
    const totalTierQty = event.tiers.reduce((acc, t) => acc + t.totalQuantity, 0);
    const capacity = simulatedCapacity ? Number(simulatedCapacity) : Math.max(totalTierQty, 15000);

    const actualAvgPrice = event.tiers.length > 0
      ? event.tiers.reduce((acc, t) => acc + Number(t.price), 0) / event.tiers.length
      : 2500;
    const avgPrice = simulatedPrice ? Number(simulatedPrice) : actualAvgPrice;

    // 2. Day of Week & Weekend Check
    const eventDate = new Date(event.date);
    const dayIndex = eventDate.getDay();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[dayIndex] || 'Saturday';
    const isWeekend = [0, 5, 6].includes(dayIndex) ? 1 : 0;

    // 3. Call ML Inference Engine
    const forecastResult = await mlService.forecastEventDemand({
      eventType: event.type,
      city: event.city,
      marketingTier: simulatedMarketingTier || 'HIGH',
      venueCapacity: capacity,
      avgTicketPrice: avgPrice,
      ticketPrices: avgPrice,
      isWeekend,
      dayOfWeek,
      publishHour: 18,
    });

    // 4. Calculate Suggested Publish Time
    let suggestedPublishTime = '';
    let suggestedWindowReason = '';
    if (event.type.includes('CRICKET') || event.type.includes('FOOTBALL')) {
      suggestedPublishTime = 'Thursday at 6:30 PM PKT';
      suggestedWindowReason = 'Historical sports telemetry indicates ticket purchasing peaks 48 hours prior to match day between 6:00 PM and 9:00 PM.';
    } else if (event.type.includes('MUSIC')) {
      suggestedPublishTime = 'Friday at 7:00 PM PKT';
      suggestedWindowReason = 'Concert audience engagement surges on Friday evenings as weekend plans materialize.';
    } else {
      suggestedPublishTime = 'Wednesday at 5:00 PM PKT';
      suggestedWindowReason = 'Mid-week evening releases generate steady multi-day organic viral momentum.';
    }

    // 5. Intelligent Pricing Warnings & Recommendations
    let benchmarkPrice = 2500;
    if (event.type.includes('CRICKET')) benchmarkPrice = 3000;
    else if (event.type.includes('MUSIC')) benchmarkPrice = 4000;
    else if (event.type.includes('KABADDI')) benchmarkPrice = 1500;

    let pricingWarning = {};
    if (avgPrice > benchmarkPrice * 1.35) {
      const excessPercent = Math.round(((avgPrice - benchmarkPrice) / benchmarkPrice) * 100);
      pricingWarning = {
        level: 'HIGH_PRICE_WARNING',
        severity: 'amber',
        title: 'High Pricing Alert',
        message: `Average tier price of PKR ${Math.round(avgPrice).toLocaleString()} is ${excessPercent}% above historical averages for ${event.city}. Our Gradient Boosting demand model predicts a ~18% deceleration in 48-hour velocity.`,
        recommendation: 'Consider lowering base General Enclosure tier by PKR 500-1,000 to stimulate rapid early-bird sellout.',
      };
    } else if (avgPrice < benchmarkPrice * 0.70 && forecastResult.sellout_probability >= 0.65) {
      pricingWarning = {
        level: 'UNDERPRICED_WARNING',
        severity: 'cyan',
        title: 'Revenue Left on Table',
        message: `High demand projected (${forecastResult.demand_tier}). Your average price of PKR ${Math.round(avgPrice).toLocaleString()} is well below market tolerance.`,
        recommendation: 'You can safely increase premium Pavilion/VIP tiers by 15-20% without impacting volume, maximizing total gross gate revenue.',
      };
    } else {
      pricingWarning = {
        level: 'OPTIMAL_PRICE',
        severity: 'emerald',
        title: 'Optimized Pricing Alignment',
        message: `Current average price of PKR ${Math.round(avgPrice).toLocaleString()} aligns squarely with historical demand and purchasing power in ${event.city}.`,
        recommendation: 'Pricing structure is optimal for 48-hour launch velocity.',
      };
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
        demand_level: forecastResult.demand_level || forecastResult.demand_tier,
        demand_tier: forecastResult.demand_tier,
        sellout_probability: forecastResult.sellout_probability,
        suggested_publish_time: suggestedPublishTime,
        suggested_window_reason: suggestedWindowReason,
        pricing_warning: pricingWarning,
        pricing_recommendation: forecastResult.pricing_recommendation,
        tiers: event.tiers,
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
    if (req.user.role !== 'SUPER_ADMIN') {
      const company = await prisma.company.findUnique({ where: { userId: req.user.id } });
      if (!company || company.id !== event.companyId) {
        return res.status(403).json({ success: false, message: 'Unauthorized to modify pricing' });
      }
    }

    // Update each tier in parallel
    for (const t of tiers) {
      if (t.id && t.price) {
        await prisma.ticketTier.update({
          where: { id: t.id },
          data: { price: Number(t.price) },
        });
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
    if (req.user.role !== 'SUPER_ADMIN') {
      const company = await prisma.company.findUnique({ where: { userId: req.user.id } });
      if (!company || company.id !== event.companyId) {
        return res.status(403).json({ success: false, message: 'Unauthorized to publish event' });
      }
    }

    // If tiers were adjusted, update them
    if (Array.isArray(tiers) && tiers.length > 0) {
      for (const t of tiers) {
        if (t.id && t.price) {
          await prisma.ticketTier.update({
            where: { id: t.id },
            data: { price: Number(t.price) },
          });
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
        ? `Prices for "${published.name}" are saved.`
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
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to edit this event.' });
    }
    return res.status(200).json({ success: true, data: { event } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to load event', error: error.message });
  }
};

/**
 * Organizer updates event details and media in one save.
 *
 * Multipart body:
 * - Detail fields (name, description, type, date, time, city, venue); omitted fields are unchanged.
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

    const detailKeys = Object.keys(updateEventDetailsSchema.shape).filter((k) => req.body[k] !== undefined);
    const details = updateEventDetailsSchema.parse(Object.fromEntries(detailKeys.map((k) => [k, req.body[k]])));

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

    const data = { ...details, ...singleChanges };
    if (details.date) data.date = new Date(details.date);

    const updated = await prisma.$transaction(async (tx) => {
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
          details: { fields: Object.keys(data), galleryCount: galleryPlan ? galleryPlan.length : event.galleryImages.length },
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
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: 'You can only delete your own events.' });
    }

    const [sold, paying] = await Promise.all([
      prisma.order.count({ where: { eventId: event.id, status: 'SUCCESSFUL' } }),
      prisma.order.count({ where: { eventId: event.id, status: 'PENDING' } }),
    ]);
    if (sold || paying) {
      return res.status(409).json({
        success: false,
        message: sold
          ? `This event has ${sold} paid order${sold === 1 ? '' : 's'}, so it can’t be deleted. Cancel the event instead, so ticket holders keep their records.`
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
