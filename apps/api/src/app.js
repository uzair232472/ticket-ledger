import express from 'express';
import cors from 'cors';
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

dotenv.config();

const app = express();

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
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
