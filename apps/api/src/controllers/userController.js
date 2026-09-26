import { z } from 'zod';
import prisma from '../config/prisma.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

// Schemas
const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
});

const updateWalletSchema = z.object({
  walletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum / Polygon wallet address format')
    .nullable()
    .or(z.literal('')),
});

const updateNotificationsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
});

/**
 * Get detailed role-specific user profile
 */
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        role: true,
        status: true,
        walletAddress: true,
        isVerified: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
        createdAt: true,
        company: {
          select: {
            id: true,
            companyName: true,
            status: true,
            city: true,
            ntnCnic: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Role-specific stats
    let roleStats = {};

    if (user.role === 'CUSTOMER') {
      const ticketCount = await prisma.ticket.count({ where: { userId } });
      const orderCount = await prisma.order.count({ where: { userId } });
      roleStats = { ticketCount, orderCount };
    } else if (user.role === 'ORGANIZER') {
      const eventCount = user.company 
        ? await prisma.event.count({ where: { companyId: user.company.id } })
        : 0;
      roleStats = {
        companyStatus: user.company?.status || 'NOT_REGISTERED',
        eventsHosted: eventCount,
      };
    } else if (user.role === 'GATE_STAFF') {
      const totalScans = await prisma.gateScan.count({ where: { staffId: userId } });
      roleStats = { totalScans };
    } else if (user.role === 'SUPER_ADMIN') {
      const totalUsers = await prisma.user.count();
      const pendingCompanies = await prisma.company.count({ where: { status: 'PENDING' } });
      roleStats = { totalUsers, pendingCompanies };
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: user,
        stats: roleStats,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch user profile',
      error: error.message,
    });
  }
};

/**
 * Update basic profile fields
 */
export const updateProfile = async (req, res) => {
  try {
    const validated = updateProfileSchema.parse(req.body);
    const userId = req.user.id;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: validated,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        role: true,
        status: true,
        walletAddress: true,
        isVerified: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'PROFILE_UPDATED',
        targetType: 'User',
        targetId: userId,
        details: validated,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || 'Validation error',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
};

/**
 * Connect or update MetaMask wallet address
 */
export const updateWallet = async (req, res) => {
  try {
    const { walletAddress } = updateWalletSchema.parse(req.body);
    const userId = req.user.id;

    const normalizedAddress = walletAddress && walletAddress.trim() !== '' 
      ? walletAddress.toLowerCase() 
      : null;

    if (normalizedAddress) {
      // Check if another account already registered this wallet
      const existing = await prisma.user.findFirst({
        where: {
          walletAddress: normalizedAddress,
          id: { not: userId },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'This MetaMask wallet address is already linked to another account.',
        });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { walletAddress: normalizedAddress },
      select: {
        id: true,
        name: true,
        email: true,
        walletAddress: true,
        role: true,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: normalizedAddress ? 'WALLET_CONNECTED' : 'WALLET_DISCONNECTED',
        targetType: 'User',
        targetId: userId,
        details: { walletAddress: normalizedAddress },
      },
    });

    if (normalizedAddress) {
      behaviorService.trackBehavior({
        req,
        userId,
        action: BEHAVIOR_ACTIONS.WALLET_CONNECTED,
        metadata: { walletAddress: normalizedAddress },
      });
    }

    return res.status(200).json({
      success: true,
      message: normalizedAddress 
        ? 'MetaMask wallet connected and saved successfully.' 
        : 'MetaMask wallet unlinked successfully.',
      data: {
        walletAddress: updatedUser.walletAddress,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || 'Invalid wallet address format',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to update wallet',
      error: error.message,
    });
  }
};

/**
 * Update notification preferences
 */
export const updateNotifications = async (req, res) => {
  try {
    const validated = updateNotificationsSchema.parse(req.body);
    const userId = req.user.id;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: validated,
      select: {
        id: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Notification preferences saved',
      data: updatedUser,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get account history (Audit logs & activity)
 */
export const getAccountHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const logs = await prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return res.status(200).json({
      success: true,
      data: {
        history: logs,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve account history',
      error: error.message,
    });
  }
};
