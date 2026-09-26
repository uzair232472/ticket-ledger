import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import { connectRedis } from './config/redis.js';
import { setIO } from './config/socket.js';

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io
export const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

  socket.on('disconnect', () => {
    console.log(`🔌 Socket client disconnected: ${socket.id}`);
  });
});

// Start Server
async function startServer() {
  await connectRedis();

  server.listen(PORT, () => {
    console.log(`🚀 TicketLedger Express API is running on http://localhost:${PORT}`);
    console.log(`📡 Socket.io server ready on port ${PORT}`);
    console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
  });
}

// Only start when run directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { server };
