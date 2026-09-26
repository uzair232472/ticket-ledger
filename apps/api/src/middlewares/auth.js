import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'ticketledger_jwt_super_secret_key_2026_fyp';

export const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Missing or malformed authentication token.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch user from DB to ensure they still exist and status is up to date
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        walletAddress: true,
        isVerified: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session. User account no longer exists.',
      });
    }

    // Check account status
    if (user.status === 'BLACKLISTED') {
      return res.status(403).json({
        success: false,
        message: 'Account is blacklisted due to suspicious activity or terms violation.',
      });
    }

    if (user.status === 'FROZEN') {
      return res.status(403).json({
        success: false,
        message: 'Account has been temporarily frozen. Please contact administration.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Authentication session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token.',
      error: error.message,
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
 * Optional authentication: if Bearer token is provided, populates req.user.
 * If not provided or invalid, proceeds as guest (req.user remains undefined).
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          status: true,
        },
      });
      if (user && user.status === 'ACTIVE') {
        req.user = user;
      }
    }
  } catch (err) {
    // Silently continue as guest
  }
  next();
};
