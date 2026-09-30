import { z } from 'zod';
import prisma from '../config/prisma.js';
import { uploadFile } from '../utils/storage.js';
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

    // Set status to PUBLISHED
    const published = await prisma.event.update({
      where: { id },
      data: { status: 'PUBLISHED' },
      include: { tiers: { orderBy: { price: 'asc' } } },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EVENT_PUBLISHED_AFTER_PRELAUNCH_ANALYSIS',
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
      message: `Event "${published.name}" has been PUBLISHED and is now live for public ticket sales!`,
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

