import express from 'express';
import cors from 'cors';
import { corsOrigin } from './config/cors.js';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { redisConnected } from './config/redis.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import seatRoutes from './routes/seatRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import resaleRoutes from './routes/resaleRoutes.js';
import gateRoutes from './routes/gateRoutes.js';
import mlRoutes from './routes/mlRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import behaviorRoutes from './routes/behaviorRoutes.js';
import intentAnalyticsRoutes from './routes/intentAnalyticsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import venueRoutes from './routes/venueRoutes.js';
import wishlistRoutes from './routes/wishlistRoutes.js';

dotenv.config();

const app = express();

// Middlewares
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
// Venue plans can be larger than the default 100kb body limit (scoped to these routes only)
app.use('/api/venues', express.json({ limit: '2mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// System Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    project: 'TicketLedger API',
    module: 'Module 1 - Project Setup & Architecture',
    timestamp: new Date().toISOString(),
    services: {
      api: 'healthy',
      redis: redisConnected ? 'connected' : 'offline/awaiting_docker',
      environment: process.env.NODE_ENV || 'development',
    },
  });
});

// Static file serving for uploaded documents & media
app.use('/uploads', express.static('uploads'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/seats', seatRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/resale', resaleRoutes);
app.use('/api/gate', gateRoutes);
app.use('/api/ml', mlRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/behavior', behaviorRoutes);
app.use('/api/analytics', intentAnalyticsRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/organizer', adminRoutes);

// Root welcome endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'TicketLedger Monorepo API',
    documentation: '/docs',
    healthCheck: '/api/health',
    version: '1.0.0',
    modules: ['Module 1: Setup', 'Module 2: Authentication & RBAC'],
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `API endpoint ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export default app;
