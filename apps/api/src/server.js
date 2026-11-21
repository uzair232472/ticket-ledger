import http from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import { connectRedis } from './config/redis.js';
import { corsOrigin } from './config/cors.js';
import { setIO } from './config/socket.js';
import { installSocketAuth } from './services/socketAccess.js';
import { deviceAuthStatus } from './config/gateDeviceAuth.js';
import { pruneSyncBatches } from './services/gateDiagnosticsService.js';
import { retryRefunds } from './services/refundService.js';
import nftService, { MINTABLE } from './services/nftService.js';
import { notifyAdmins } from './services/notificationService.js';
import { assertSecrets } from './config/security.js';
import prisma from './config/prisma.js';
import { runLifecycleJobs } from './services/eventLifecycleService.js';
import { escalateOverdue } from './services/supportService.js';
import { runAutoRecovery } from './services/recoveryService.js';
import { runPayouts } from './services/payoutService.js';
import { runScheduledBroadcasts } from './services/broadcastService.js';
import { applyPhases, runScheduledPublishing } from './services/eventToolsService.js';
import { runMlJobs } from './services/ml/jobs.js';

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

// Authenticated rooms (user, event, supervisors); anonymous sockets only get public broadcasts
installSocketAuth(io);
io.on('connection', (socket) => {
  console.log(`⚡ Socket client connected: ${socket.id}${socket.data.userId ? ' (signed in)' : ''}`);
  socket.on('disconnect', () => {
    console.log(`🔌 Socket client disconnected: ${socket.id}`);
  });
});

// Start Server
async function startServer() {
  // Unsafe secrets stop the server here, not on the first login or ticket
  assertSecrets();
  const gateAuth = deviceAuthStatus();
  console.log(`🔐 Gate device auth: ${gateAuth.mode} (configured: ${gateAuth.configured}; enforced for every device from ${gateAuth.deadline})`);
  await connectRedis();
  // Minting mode (live / simulation / disabled) and the read-only chain checks (config/chain.js)
  const minting = await nftService.configure();
  if (minting.mode === 'disabled') {
    const waiting = await prisma.ticket.count({ where: { ...MINTABLE, mintStatus: 'PENDING' } }).catch(() => 0);
    if (waiting) {
      await notifyAdmins({
        type: 'ADMIN_MINT_DISABLED',
        title: `NFT minting is disabled (${waiting} paid ticket${waiting === 1 ? '' : 's'} waiting)`,
        message: `The tickets are paid and valid at the gate, but no NFTs will be issued until this is fixed: ${minting.problems.join(' ')}`,
        link: '/admin/event-approvals?tab=issuance',
      }).catch(() => {});
    }
  }

  // Hourly: retry failed refunds, cancel events postponed too long, remind holders before refund windows close
  const hourly = async () => {
    try {
      await retryRefunds();
      await runLifecycleJobs();
      await escalateOverdue();
      await runPayouts();
      // Gate upload log older than 90 days (scan records themselves are never removed)
      await pruneSyncBatches();
    } catch (e) {
      console.error('[Lifecycle jobs] failed:', e.message);
    }
  };
  setTimeout(hourly, 60 * 1000).unref();
  setInterval(hourly, 60 * 60 * 1000).unref();

  // Every 2 minutes: mint paid tickets whose NFT failed or is still waiting (backoff per ticket, admins alerted)
  const mints = () => nftService.retryDueMints().catch((e) => console.error('[NFT retry job] failed:', e.message));
  setTimeout(mints, 30 * 1000).unref();
  setInterval(mints, 2 * 60 * 1000).unref();

  // Every 15 minutes: automatic abandoned-checkout reminders (organizations that turned them on)
  const recovery = () => Promise.all([
    runAutoRecovery().catch((e) => console.error('[Recovery job] failed:', e.message)),
    runScheduledBroadcasts().catch((e) => console.error('[Broadcast job] failed:', e.message)),
  ]);
  setTimeout(recovery, 90 * 1000).unref();
  setInterval(recovery, 15 * 60 * 1000).unref();

  // Every 5 minutes: ticket sale phases (early bird → regular…) and events whose scheduled publication has come
  const eventJobs = () => Promise.all([applyPhases().catch((e) => console.error('[Sale phases] failed:', e.message)), runScheduledPublishing().catch((e) => console.error('[Scheduled publishing] failed:', e.message))]);
  setTimeout(eventJobs, 45 * 1000).unref();
  setInterval(eventJobs, 5 * 60 * 1000).unref();

  // Every 15 minutes: ML shadow scoring (finished visits, gates before events), blind fraud-review sampling,
  // and attaching real outcomes to past predictions. Logs only: never changes orders, tickets, payments,
  // accounts or gate admission. Safe on several servers (the database rejects duplicates).
  const mlJobs = () => runMlJobs().then((r) => console.log('[ML jobs]', JSON.stringify(r))).catch((e) => console.error('[ML jobs] failed:', e.message));
  setTimeout(mlJobs, 3 * 60 * 1000).unref();
  setInterval(mlJobs, 15 * 60 * 1000).unref();

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

