import prisma from '../config/prisma.js';

/*
 * Wishlist: events a user saved with the heart. Every query is scoped to the signed-in user, so people
 * only ever see and change their own list. Only events the public can see can be saved or listed.
 */
const PUBLIC_STATUSES = ['PUBLISHED', 'PAUSED', 'COMPLETED', 'CANCELLED'];

/** The saved event ids (for filling the hearts across the site). */
export const getWishlistIds = async (req, res) => {
  try {
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user.id, event: { status: { in: PUBLIC_STATUSES } } },
      select: { eventId: true },
    });
    return res.json({ success: true, data: { eventIds: items.map((i) => i.eventId) } });
  } catch (error) {
    console.error('Wishlist ids failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load your wishlist.' });
  }
};

/** Saved events with the same details and pricing summary as the public events list, newest save first. */
export const getWishlist = async (req, res) => {
  try {
    const items = await prisma.wishlistItem.findMany({
      where: { userId: req.user.id, event: { status: { in: PUBLIC_STATUSES } } },
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          include: {
            tiers: { orderBy: { price: 'asc' } },
            company: { select: { id: true, companyName: true, status: true, city: true } },
            _count: { select: { tickets: true, seats: true } },
          },
        },
      },
    });
    const events = items.map(({ event, createdAt }) => {
      const prices = event.tiers.map((t) => Number(t.price));
      return {
        ...event,
        savedAt: createdAt,
        pricing: {
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0,
          totalAvailable: event.tiers.reduce((n, t) => n + t.availableQuantity, 0),
        },
      };
    });
    return res.json({ success: true, data: { events } });
  } catch (error) {
    console.error('Wishlist failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load your wishlist.' });
  }
};

/** Save an event (idempotent). */
export const addToWishlist = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.eventId }, select: { id: true, status: true } });
    if (!event || !PUBLIC_STATUSES.includes(event.status)) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    await prisma.wishlistItem.upsert({
      where: { userId_eventId: { userId: req.user.id, eventId: event.id } },
      update: {},
      create: { userId: req.user.id, eventId: event.id },
    });
    return res.status(201).json({ success: true, message: 'Saved to your wishlist.' });
  } catch (error) {
    console.error('Add to wishlist failed:', error);
    return res.status(500).json({ success: false, message: 'Could not save this event.' });
  }
};

/** Remove an event (idempotent; only ever touches the caller's own item). */
export const removeFromWishlist = async (req, res) => {
  try {
    await prisma.wishlistItem.deleteMany({ where: { userId: req.user.id, eventId: req.params.eventId } });
    return res.json({ success: true, message: 'Removed from your wishlist.' });
  } catch (error) {
    console.error('Remove from wishlist failed:', error);
    return res.status(500).json({ success: false, message: 'Could not remove this event.' });
  }
};
