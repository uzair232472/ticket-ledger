import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { readRefreshCookie, sha256 } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import { uploadFile } from '../utils/storage.js';
import behaviorService, { BEHAVIOR_ACTIONS } from '../services/behaviorService.js';

// Schemas
const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  salutation: z.enum(['Mr', 'Ms', 'Mrs', 'Dr', 'Prof', '']).optional(),
  organisation: z.string().trim().max(120, 'Organisation must be 120 characters or fewer').optional(),
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
        emailVerifiedAt: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
        avatarUrl: true,
        salutation: true,
        organisation: true,
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

    // Everyone can hold tickets (organizers and admins buy tickets too)
    const [ticketCount, orderCount] = await Promise.all([
      prisma.ticket.count({ where: { userId, status: { not: 'CANCELLED' } } }),
      prisma.order.count({ where: { userId } }),
    ]);
    roleStats = { ...roleStats, ticketCount, orderCount };

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
        emailVerifiedAt: true,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: true,
        avatarUrl: true,
        salutation: true,
        organisation: true,
      },
    });

    await prisma.notification.create({
      data: {
        userId,
        type: 'PROFILE_UPDATED',
        title: 'Your profile was updated',
        message: `Your TicketLedger account details were changed (${Object.keys(validated).join(', ') || 'details'}). If this wasn’t you, change your password right away.`,
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
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must contain at least 1 letter')
      .regex(/\d/, 'Password must contain at least 1 number'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'Choose a password different from your current one.', path: ['newPassword'] });

/**
 * Change password while signed in: checks the current password, then signs out every other device
 * (this session stays signed in). The user is notified in the app and by email.
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, passwordHash: true } });
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ success: false, message: 'Your current password is incorrect.' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });

    // End other sessions; keep the one making this request
    const current = readRefreshCookie(req);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null, ...(current ? { tokenHash: { not: sha256(current) } } : {}) },
      data: { revokedAt: new Date() },
    });

    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_CHANGED',
        title: 'Your password was changed',
        message: 'Your TicketLedger password was changed and other devices were signed out. If this wasn’t you, reset your password now and contact support.',
      },
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: 'PASSWORD_CHANGED', targetType: 'User', targetId: user.id, details: {} } });

    return res.status(200).json({ success: true, message: 'Password changed. Other devices have been signed out.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message || 'Invalid password' });
    }
    console.error('Change password failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to change the password.' });
  }
};

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

    await prisma.notification.create({
      data: {
        userId,
        type: 'WALLET_UPDATED',
        title: normalizedAddress ? 'Wallet linked to your account' : 'Wallet unlinked from your account',
        message: normalizedAddress
          ? `The wallet ${normalizedAddress.slice(0, 6)}…${normalizedAddress.slice(-4)} is now linked to your TicketLedger account.`
          : 'Your wallet was unlinked. Your tickets stay in your TicketLedger custodial vault.',
      },
    });

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
        avatarUrl: true,
        salutation: true,
        organisation: true,
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

/**
 * Upload (or replace) the signed-in user's profile picture: multipart field `avatar`, PNG/JPG/WebP up to 2 MB
 * (checked by the route's multer filter). Stored with the account, so it never leaks to another user.
 */
export const updateAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Choose a PNG, JPG or WebP image.' });
    }
    const { url } = await uploadFile(req.file, 'avatars');
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: url },
      select: { id: true, avatarUrl: true },
    });
    return res.status(200).json({ success: true, message: 'Profile picture updated', data: { avatarUrl: user.avatarUrl } });
  } catch (error) {
    console.error('Error updating avatar:', error);
    return res.status(500).json({ success: false, message: 'Failed to update the profile picture' });
  }
};

/** Remove the signed-in user's profile picture. */
export const removeAvatar = async (req, res) => {
  try {
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
    return res.status(200).json({ success: true, message: 'Profile picture removed', data: { avatarUrl: null } });
  } catch (error) {
    console.error('Error removing avatar:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove the profile picture' });
  }
};
