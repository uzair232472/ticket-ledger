import { z } from 'zod';
import prisma from '../config/prisma.js';
import { uploadFile } from '../utils/storage.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

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
  bannerUrl: z.string().optional(),
});

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

    // Handle banner upload
    let bannerUrl = validatedData.bannerUrl;
    if (req.file) {
      const uploadRes = await uploadFile(req.file, 'event_banners');
      bannerUrl = uploadRes.url;
    }

    if (!bannerUrl) {
      // Default Pakistani event banner placeholder
      bannerUrl = validatedData.type.includes('CRICKET')
        ? 'https://images.unsplash.com/photo-1531415074868-036b1c57e3b0?auto=format&fit=crop&w=1200&q=80'
        : 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80';
    }

    // Atomic transaction: create event + ticket tiers
    const createdEvent = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          companyId: company.id,
          name: validatedData.name,
          description: validatedData.description,
          type: validatedData.type,
          status: validatedData.status,
          date: new Date(validatedData.date),
          time: validatedData.time,
          city: validatedData.city,
          venue: validatedData.venue,
          bannerUrl,
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
          company: {
            select: { id: true, companyName: true, city: true },
          },
        },
      });
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

    // By default, public users discover PUBLISHED events
    if (status) {
      where.status = status;
    } else {
      where.status = 'PUBLISHED';
    }

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
        company: {
          select: {
            id: true,
            companyName: true,
            ownerName: true,
            email: true,
            phone: true,
            city: true,
            status: true,
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

    const company = await prisma.company.findUnique({
      where: { userId },
    });

    if (!company) {
      return res.status(200).json({ success: true, data: { events: [] } });
    }

    const events = await prisma.event.findMany({
      where: { companyId: company.id },
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

    const updated = await prisma.event.update({
      where: { id },
      data: { status },
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
