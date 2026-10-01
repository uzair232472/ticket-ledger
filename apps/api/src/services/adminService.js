import prisma from '../config/prisma.js';
import { revokeAllRefreshTokens } from './tokenService.js';
import { BLOCKED_STATUSES } from '../config/auth.js';
import { dispatchNotification, NOTIFICATION_TYPES } from './notificationService.js';

/**
 * 1. Super Admin Overview Metrics
 */
export const getSuperAdminMetrics = async () => {
  const [
    totalUsers,
    activeUsers,
    frozenUsers,
    blacklistedUsers,
    totalCompanies,
    pendingCompanies,
    totalEvents,
    publishedEvents,
    totalOrders,
    successfulOrders,
    totalTickets,
    scannedTickets,
    totalGateScans,
    totalAuditLogs,
    revenueAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.user.count({ where: { status: 'BANNED' } }),
    prisma.company.count(),
    prisma.company.count({ where: { status: 'PENDING' } }),
    prisma.event.count(),
    prisma.event.count({ where: { status: 'PUBLISHED' } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'SUCCESSFUL' } }),
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: 'SCANNED' } }),
    prisma.gateScan.count(),
    prisma.auditLog.count(),
    prisma.order.aggregate({
      where: { status: 'SUCCESSFUL' },
      _sum: { totalAmount: true },
    }),
  ]);

  const grossRevenuePkr = Number(revenueAgg._sum.totalAmount || 0);
  const platformFeePkr = Math.round(grossRevenuePkr * 0.05); // 5% platform commission

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
      suspended: frozenUsers,
      banned: blacklistedUsers,
      // Legacy keys (FROZEN/BLACKLISTED were renamed to SUSPENDED/BANNED)
      frozen: frozenUsers,
      blacklisted: blacklistedUsers,
    },
    companies: {
      total: totalCompanies,
      pendingApproval: pendingCompanies,
    },
    events: {
      total: totalEvents,
      published: publishedEvents,
    },
    ticketing: {
      totalOrders,
      successfulOrders,
      totalTickets,
      scannedTickets,
      turnoutRate: totalTickets > 0 ? Math.round((scannedTickets / totalTickets) * 100) : 0,
    },
    financials: {
      grossRevenuePkr,
      platformFeePkr,
    },
    operations: {
      totalGateScans,
      totalAuditLogs,
    },
  };
};

/**
 * 2. Manage Users: Search, Filter, Pagination
 */
export const getUsersList = async ({
  page = 1,
  limit = 20,
  search = '',
  role = null,
  status = null,
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (search && search.trim() !== '') {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
      { walletAddress: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role && role !== 'ALL') {
    where.role = role;
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        role: true,
        status: true,
        walletAddress: true,
        emailVerifiedAt: true,
        createdAt: true,
        company: {
          select: { id: true, companyName: true, status: true },
        },
        _count: {
          select: { orders: true, tickets: true, auditLogs: true },
        },
      },
    }),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    users,
  };
};

/**
 * 3. Update User Status: Freeze, Unfreeze, Blacklist
 */
const ADMIN_SETTABLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED'];

export const updateUserStatus = async ({ userId, status, reason = null, adminUser }) => {
  if (!ADMIN_SETTABLE_STATUSES.includes(status)) {
    const error = new Error(`Invalid account status. Allowed: ${ADMIN_SETTABLE_STATUSES.join(', ')}`);
    error.status = 400;
    throw error;
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, status: true, role: true },
  });

  if (!target) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (target.role === 'SUPER_ADMIN' && adminUser.id !== target.id) {
    const error = new Error('Cannot modify status of another Super Admin account');
    error.status = 403;
    throw error;
  }

  const previousStatus = target.status;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      updatedAt: true,
    },
  });

  // Blocked accounts lose every session; the access-token check rejects them on the next request
  if (BLOCKED_STATUSES.includes(status)) {
    await revokeAllRefreshTokens(userId);
  }

  // Action name for audit log
  let auditAction = 'USER_STATUS_UPDATED';
  if (status === 'SUSPENDED') auditAction = 'USER_SUSPENDED';
  else if (status === 'BANNED') auditAction = 'USER_BANNED';
  else if (status === 'DEACTIVATED') auditAction = 'USER_DEACTIVATED';
  else if (status === 'ACTIVE' && previousStatus !== 'ACTIVE') auditAction = 'USER_REACTIVATED';

  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      action: auditAction,
      targetType: 'User',
      targetId: userId,
      details: {
        previousStatus,
        newStatus: status,
        reason: reason || 'Administrative decision by Super Admin',
        targetEmail: target.email,
        adminEmail: adminUser.email,
      },
    },
  });

  // Dispatch notification to user
  try {
    await dispatchNotification({
      userId,
      type: NOTIFICATION_TYPES.SYSTEM_ALERT || 'SYSTEM_ALERT',
      title: `Account Status Update: ${status}`,
      message: `Your TicketLedger account status has been changed to ${status}. Reason: ${reason || 'Administrative policy review.'}`,
      data: { status, reason },
    });
  } catch (notifErr) {
    console.warn(`Failed to dispatch status notification to user ${userId}:`, notifErr.message);
  }

  return {
    success: true,
    message: `User ${target.name} (${target.email}) status updated to ${status}.`,
    user: updated,
  };
};

/**
 * 4. View All Events (Admin)
 */
export const getAllEventsAdmin = async ({
  page = 1,
  limit = 20,
  search = '',
  status = null,
  city = null,
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (search && search.trim() !== '') {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { venue: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (city && city !== 'ALL') {
    where.city = city;
  }

  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        company: {
          select: { id: true, companyName: true, status: true, ownerName: true, email: true },
        },
        tiers: {
          select: { id: true, name: true, price: true, totalQuantity: true, availableQuantity: true },
        },
        _count: {
          select: { tickets: true, orders: true, seats: true },
        },
      },
    }),
  ]);

  const formatted = events.map((ev) => {
    const totalCapacity = ev.tiers.reduce((acc, t) => acc + t.totalQuantity, 0);
    const availableSeats = ev.tiers.reduce((acc, t) => acc + t.availableQuantity, 0);
    const soldTickets = totalCapacity - availableSeats;
    return {
      ...ev,
      totalCapacity,
      soldTickets,
      availableSeats,
      occupancyRate: totalCapacity > 0 ? Math.round((soldTickets / totalCapacity) * 100) : 0,
    };
  });

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    events: formatted,
  };
};

/**
 * 5. View Global Financial Transactions (Orders)
 */
export const getAllTransactionsAdmin = async ({
  page = 1,
  limit = 20,
  search = '',
  status = null,
  paymentMethod = null,
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (search && search.trim() !== '') {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { paymentTxId: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { event: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (paymentMethod && paymentMethod !== 'ALL') {
    where.paymentMethod = paymentMethod;
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, walletAddress: true } },
        event: { select: { id: true, name: true, city: true, date: true } },
        tickets: {
          select: { id: true, tokenId: true, txHash: true, status: true, price: true },
        },
      },
    }),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    transactions: orders,
  };
};

/**
 * 6. View Blockchain Smart Contract Logs (NFT mints, tokens, on-chain transfers)
 */
export const getBlockchainLogs = async ({
  page = 1,
  limit = 20,
  search = '',
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (search && search.trim() !== '') {
    where.OR = [
      { txHash: { contains: search, mode: 'insensitive' } },
      { contractAddress: { contains: search, mode: 'insensitive' } },
      { ownerWallet: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { event: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, walletAddress: true } },
        event: { select: { id: true, name: true, city: true, date: true } },
        seat: { select: { id: true, section: true, row: true, seatNumber: true } },
        transferHistory: {
          include: {
            fromUser: { select: { id: true, name: true, email: true } },
            toUser: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ]);

  const formattedLogs = tickets.map((t) => ({
    ticketId: t.id,
    tokenId: t.tokenId,
    txHash: t.txHash,
    contractAddress: t.contractAddress || '0x62957777413D3ebB340d87fa06E982F72d34F234',
    network: 'Polygon Amoy Testnet (Chain ID 80002)',
    ownerWallet: t.ownerWallet || t.user?.walletAddress || 'Custodial / Pending Mint',
    status: t.status,
    pricePkr: Number(t.price),
    seatLabel: t.seat ? `${t.seat.section} • Row ${t.seat.row} • #${t.seat.seatNumber}` : 'General',
    event: t.event,
    user: t.user,
    transfersCount: t.transferHistory?.length || 0,
    transferHistory: t.transferHistory,
    mintedAt: t.createdAt,
  }));

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    blockchainLogs: formattedLogs,
  };
};

/**
 * 7. View ML Fraud & Bot Alerts
 */
export const getFraudAlerts = async ({
  page = 1,
  limit = 20,
  minScore = 50,
}) => {
  const skip = (Number(page) - 1) * Number(limit);

  // Fetch behavior events that record fraud / rapid bot activities
  const where = {
    action: {
      in: ['bot_risk_flagged', 'rapid_clicks', 'seat_rapid_click', 'fraud_score_computed', 'checkout_abandoned'],
    },
  };

  const [total, events] = await Promise.all([
    prisma.behaviorEvent.count({ where }),
    prisma.behaviorEvent.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, status: true, role: true, city: true } },
        event: { select: { id: true, name: true, city: true, venue: true } },
      },
    }),
  ]);

  const alerts = events.map((ev) => {
    const meta = ev.metadata || {};
    const fraudScore = meta.fraudScore ? Number(meta.fraudScore) : meta.isBot ? 88 : 65;
    return {
      id: ev.id,
      userId: ev.userId,
      user: ev.user || { name: 'Guest Session', email: null, status: 'UNKNOWN' },
      sessionId: ev.sessionId,
      event: ev.event,
      action: ev.action,
      fraudScore,
      riskLevel: fraudScore >= 75 ? 'CRITICAL' : fraudScore >= 50 ? 'SUSPICIOUS' : 'LOW',
      factors: meta.anomalyFactors || meta.reasons || [ev.action.replace(/_/g, ' ')],
      ipAddress: meta.ip || '127.0.0.1',
      city: ev.user?.city || ev.event?.city || 'Pakistan',
      timestamp: ev.createdAt,
    };
  });

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    alerts,
  };
};

/**
 * 8. View Gate Turnstile Scan Logs
 */
export const getGateScanLogs = async ({
  page = 1,
  limit = 20,
  eventId = null,
  result = null,
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (eventId && eventId !== 'ALL') {
    where.ticket = { eventId };
  }

  if (result && result !== 'ALL') {
    where.result = result;
  }

  const [total, scans] = await Promise.all([
    prisma.gateScan.count({ where }),
    prisma.gateScan.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { scanTime: 'desc' },
      include: {
        staff: { select: { id: true, name: true, email: true } },
        ticket: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
            event: { select: { id: true, name: true, city: true, venue: true } },
            seat: { select: { section: true, row: true, seatNumber: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    scans,
  };
};

/**
 * 9. View System Audit Logs
 */
export const getAuditLogs = async ({
  page = 1,
  limit = 30,
  action = null,
  search = '',
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};

  if (action && action !== 'ALL') {
    where.action = action;
  }

  if (search && search.trim() !== '') {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { targetType: { contains: search, mode: 'insensitive' } },
      { targetId: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
    auditLogs: logs,
  };
};

export default {
  getSuperAdminMetrics,
  getUsersList,
  updateUserStatus,
  getAllEventsAdmin,
  getAllTransactionsAdmin,
  getBlockchainLogs,
  getFraudAlerts,
  getGateScanLogs,
  getAuditLogs,
};
