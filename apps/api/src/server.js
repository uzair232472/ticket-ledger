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
import { paymentStartupProblems } from './services/payments/config.js';
import prisma from './config/prisma.js';
import { runLifecycleJobs } from './services/eventLifecycleService.js';
import { escalateOverdue } from './services/supportService.js';
import { runAutoRecovery } from './services/recoveryService.js';
import { runPayouts } from './services/payoutService.js';
import { runScheduledBroadcasts } from './services/broadcastService.js';
import { applyPhases, runScheduledPublishing } from './services/eventToolsService.js';
import { completeEndedEvents } from './services/eventTiming.js';
import { processGateAdvice } from './services/gateAdviceJob.js';
import { runMlJobs } from './services/ml/jobs.js';
import { runEventReminders } from './services/eventReminderJob.js';

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
  // Payment configuration: a live/test mix-up, or live mode without everything it needs, stops the server
  const payments = paymentStartupProblems();
  if (payments.fatal.length) {
    console.error(`❌ Payment configuration refused: ${payments.fatal.join(' | ')}`);
    process.exit(1);
  }
  for (const w of payments.warnings) console.warn(`⚠️ Payments: ${w}`);
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
  // …and events whose end has passed: marked COMPLETED, their open resale listings closed (services/eventTiming.js)
  const eventJobs = () => Promise.all([
    applyPhases().catch((e) => console.error('[Sale phases] failed:', e.message)),
    runScheduledPublishing().catch((e) => console.error('[Scheduled publishing] failed:', e.message)),
    completeEndedEvents().then((r) => r.completed && console.log('[Event end] completed', JSON.stringify(r))).catch((e) => console.error('[Event end] failed:', e.message)),
  ]);
  setTimeout(eventJobs, 45 * 1000).unref();
  setInterval(eventJobs, 5 * 60 * 1000).unref();

  // Every minute: gate advice runs still queued (normally sent right after the request; this picks up runs left
  // by a restart or queued on another server). Each person gets the same advice at most once (gateAdviceJob.js).
  const gateAdvice = () => processGateAdvice().then((r) => r.runs && console.log('[Gate advice]', JSON.stringify(r))).catch((e) => console.error('[Gate advice] failed:', e.message));
  setTimeout(gateAdvice, 20 * 1000).unref();
  setInterval(gateAdvice, 60 * 1000).unref();

  // Every 15 minutes: ML shadow scoring (finished visits, gates before events), blind fraud-review sampling,
  // and attaching real outcomes to past predictions. Logs only: never changes orders, tickets, payments,
  // accounts or gate admission. Safe on several servers (the database rejects duplicates).
  const mlJobs = () => runMlJobs().then((r) => console.log('[ML jobs]', JSON.stringify(r))).catch((e) => console.error('[ML jobs] failed:', e.message));
  setTimeout(mlJobs, 3 * 60 * 1000).unref();
  setInterval(mlJobs, 15 * 60 * 1000).unref();

  // Every 30 minutes: event reminder emails (15, 7, 5, 3 days before and on the day) to ticket holders, and to
  // earlier buyers of the organizer while tickets are available. Sent 9:00–21:00 PKT, never twice to anyone.
  const reminders = () => runEventReminders().then((r) => (r.holders || r.winback) && console.log('[Event reminders]', JSON.stringify(r))).catch((e) => console.error('[Event reminders] failed:', e.message));
  setTimeout(reminders, 2 * 60 * 1000).unref();
  setInterval(reminders, 30 * 60 * 1000).unref();

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

