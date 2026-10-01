import prisma from '../config/prisma.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { BLOCKED_STATUSES, MESSAGES } from '../config/auth.js';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  status: true,
  walletAddress: true,
  companyId: true,
  emailVerifiedAt: true,
};

const readBearer = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
};

/**
 * requireAuth: verifies the access token, loads the user and rejects blocked or unverified accounts.
 * The user is re-read on every request, so a ban takes effect immediately.
 */
export const authenticateJWT = async (req, res, next) => {
  try {
    const token = readBearer(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Missing or malformed authentication token.',
      });
    }

    const decoded = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: USER_SELECT });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session. User account no longer exists.',
      });
    }

    if (BLOCKED_STATUSES.includes(user.status)) {
      return res.status(403).json({ success: false, code: 'ACCOUNT_SUSPENDED', message: MESSAGES.ACCOUNT_SUSPENDED });
    }

    if (user.status === 'PENDING_VERIFICATION') {
      return res.status(403).json({
        success: false,
        needsVerification: true,
        message: 'Please verify your email before continuing.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Authentication session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token.',
    });
  }
};

/**
 * Restricts access to specified roles
 * @param  {...string} roles Allowed roles: 'CUSTOMER', 'ORGANIZER', 'GATE_STAFF', 'SUPER_ADMIN'
 */
export const requireRole = (...roles) => {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' lacks permission for this resource. Required: ${allowed.join(', ')}`,
      });
    }

    next();
  };
};

// Convenient alias
export const requireAuth = authenticateJWT;

/**
 * Blocks organizer event routes until the organizer's company is APPROVED.
 * Sets req.company for the route handler. Accounts without a company (including Super Admins) are blocked.
 */
export const requireApprovedCompany = async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({ where: { userId: req.user.id } });
    if (!company || company.status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        code: company ? 'COMPANY_NOT_APPROVED' : 'COMPANY_NOT_REGISTERED',
        companyStatus: company?.status || 'NONE',
        message: MESSAGES.COMPANY_NOT_APPROVED,
      });
    }

    req.company = company;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to verify company approval' });
  }
};

/**
 * Optional authentication: if Bearer token is provided, populates req.user.
 * If not provided or invalid, proceeds as guest (req.user remains undefined).
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const token = readBearer(req);
    if (token) {
      const decoded = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: USER_SELECT });
      if (user && user.status === 'ACTIVE') {
        req.user = user;
      }
    }
  } catch (err) {
    // Silently continue as guest
  }
  next();
};
