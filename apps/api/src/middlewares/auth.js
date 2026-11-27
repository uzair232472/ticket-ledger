import prisma from '../config/prisma.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { BLOCKED_STATUSES, MESSAGES } from '../config/auth.js';
import { ALL_PERMISSIONS, requestContext } from '../services/orgAccess.js';

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
  isSupportAgent: true,
  adminRole: true,
  adminPermissions: true,
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
 * Sets req.org: the organization the request acts for.
 *   Members: their ACTIVE membership (role, permissions, event scope). No membership = req.org null.
 *   Super Admins: only with an explicit ?companyId= (or X-Company-Id header) naming an existing company; every
 *   such request is written to the audit log. Without one, req.org stays null (platform-wide admin routes).
 */
export const loadOrgContext = async (req, res, next) => {
  try {
    req.org = null;
    if (!req.user) return next();
    if (req.user.role === 'SUPER_ADMIN') {
      const companyId = String(req.query.companyId || req.headers['x-company-id'] || '').trim();
      if (!companyId) return next();
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, companyName: true, status: true, userId: true, email: true } });
      if (!company) return res.status(404).json({ success: false, message: 'Organization not found.' });
      req.org = { superAdmin: true, companyId, company, role: 'SUPER_ADMIN', permissions: new Set(ALL_PERMISSIONS), eventScoped: false, eventIds: null };
      await prisma.auditLog.create({
        data: { userId: req.user.id, companyId, actorRole: 'SUPER_ADMIN', action: 'SUPER_ADMIN_ORG_ACCESS', targetType: 'Company', targetId: companyId, ipAddress: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) || null, details: { method: req.method, path: req.originalUrl.split('?')[0] } },
      });
      return next();
    }
    req.org = await requestContext(req);
    return next();
  } catch (error) {
    console.error('loadOrgContext error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load organization access' });
  }
};

/**
 * Requires an organization context holding every listed permission. Super Admins pass when they named an
 * organization (loadOrgContext) or when `allowPlatformAdmin` is set for routes that work across organizations.
 */
export const requirePermission = (permissions, { allowPlatformAdmin = true } = {}) => {
  const needed = [permissions].flat();
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (req.org === undefined) req.org = req.user.role === 'SUPER_ADMIN' ? null : await requestContext(req);
    if (req.user.role === 'SUPER_ADMIN' && (req.org || allowPlatformAdmin)) return next();
    if (!req.org) {
      return res.status(403).json({ success: false, code: 'NO_ORGANIZATION', message: 'You are not an active member of an organization.' });
    }
    const missing = needed.filter((p) => !req.org.permissions.has(p));
    if (missing.length) {
      return res.status(403).json({ success: false, code: 'MISSING_PERMISSION', missing, message: `You don't have permission to do this (${missing.join(', ')}).` });
    }
    return next();
  };
};

/** Route guard bundle: signed in + organization context + permissions. */
export const orgGuard = (permissions, options) => [authenticateJWT, loadOrgContext, requirePermission(permissions, options)];

/**
 * Blocks organizer routes until the member's organization is APPROVED, and checks `permission` (event.create
 * by default). Sets req.company. Super Admins without a company are blocked (they have no organization).
 */
export const requireApprovedCompany = (permission = 'event.create') => async (req, res, next) => {
  try {
    const ctx = req.org ?? (req.user.role === 'SUPER_ADMIN' ? null : await requestContext(req));
    const company = ctx?.company ? await prisma.company.findUnique({ where: { id: ctx.companyId } }) : null;
    if (!company || company.status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        code: company ? 'COMPANY_NOT_APPROVED' : 'COMPANY_NOT_REGISTERED',
        companyStatus: company?.status || 'NONE',
        message: MESSAGES.COMPANY_NOT_APPROVED,
      });
    }
    if (permission && !ctx.permissions.has(permission)) {
      return res.status(403).json({ success: false, code: 'MISSING_PERMISSION', missing: [permission], message: `You don't have permission to do this (${permission}).` });
    }
    req.org = ctx;
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
