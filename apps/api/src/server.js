import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import { connectRedis } from './config/redis.js';
import { corsOrigin } from './config/cors.js';
import { setIO } from './config/socket.js';
import { retryRefunds } from './services/refundService.js';
import { runLifecycleJobs } from './services/eventLifecycleService.js';

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io
export const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});
setIO(io);

io.on('connection', (socket) => {
  console.log(`⚡ Socket client connected: ${socket.id}`);

  // Allow client to join personal notification room
  socket.on('join_user_room', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
    }
  });

  // Live gate entry counters for one event (scanners, organizer dashboard)
  socket.on('join_event_room', (eventId) => {
    if (typeof eventId === 'string' && eventId.length < 64) socket.join(`event_${eventId}`);
  });
  socket.on('leave_event_room', (eventId) => {
    if (typeof eventId === 'string') socket.leave(`event_${eventId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket client disconnected: ${socket.id}`);
  });
});

// Start Server
async function startServer() {
  await connectRedis();

  // Hourly: retry failed refunds, cancel events postponed too long, remind holders before refund windows close
  const hourly = async () => {
    try {
      await retryRefunds();
      await runLifecycleJobs();
    } catch (e) {
      console.error('[Lifecycle jobs] failed:', e.message);
    }
  };
  setTimeout(hourly, 60 * 1000).unref();
  setInterval(hourly, 60 * 60 * 1000).unref();

  server.listen(PORT, () => {
    console.log(`🚀 TicketLedger Express API is running on http://localhost:${PORT}`);
    console.log(`📡 Socket.io server ready on port ${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
  });
}

// Process-level resilience guards
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

// Only start when run directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { server };

