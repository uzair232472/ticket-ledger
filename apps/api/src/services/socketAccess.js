import prisma from '../config/prisma.js';
import { getIO } from '../config/socket.js';
import { BLOCKED_STATUSES } from '../config/auth.js';
import { verifyAccessToken } from './tokenService.js';
import { canAccessEvent } from './orgAccess.js';

/*
 * Socket.io access control.
 *
 * A connection may be anonymous (public seat-map broadcasts need no account) or signed in with the same access
 * token as the REST API (`io(url, { auth: { token } })`). Private rooms need the right account:
 *   user_<id>                 only that user (notifications, wallet updates, device revocation, exception decisions)
 *   event_<id>                members who scan or view gate stats for the event (live attendance counters)
 *   event_<id>_supervisors    members with gate.supervise for the event (exception requests)
 * The account is re-read on every join, so a suspended user or a removed staff member can't join again, and
 * reauthorizeUserRooms() takes people out of event rooms as soon as their access changes.
 */

export const userRoom = (userId) => `user_${userId}`;
export const eventRoom = (eventId) => `event_${eventId}`;
export const supervisorRoom = (eventId) => `event_${eventId}_supervisors`;

const USER_SELECT = { id: true, name: true, email: true, role: true, status: true, companyId: true };
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length < 64;

async function activeUser(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user || BLOCKED_STATUSES.includes(user.status) || user.status === 'PENDING_VERIFICATION') return null;
  return user;
}

/** What this user may receive for this event: { live, supervise }. */
export async function eventRoomAccess(user, eventId) {
  if (!user || !isId(eventId)) return { live: false, supervise: false };
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, companyId: true } });
  if (!event) return { live: false, supervise: false };
  const can = (permission) => canAccessEvent(user, event, { permission });
  const supervise = await can('gate.supervise');
  const live = supervise || (await can('gate.stats')) || (await can('gate.scan'));
  return { live, supervise };
}

const deny = (socket, room, reason, ack) => {
  socket.emit('room:denied', { room, reason });
  if (typeof ack === 'function') ack({ ok: false, reason });
};

export function installSocketAuth(io) {
  io.use(async (socket, next) => {
    socket.data.userId = null;
    const token = socket.handshake.auth?.token;
    if (typeof token === 'string' && token) {
      try {
        const user = await activeUser(verifyAccessToken(token).userId);
        if (user) socket.data.userId = user.id;
      } catch {
        // Expired or invalid token: the connection stays anonymous (public broadcasts only)
        socket.data.authError = true;
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    // Signed-in sockets always get their own room, so access changes can reach every socket of the user
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));

    socket.on('join_user_room', async (userId, ack) => {
      const user = await activeUser(socket.data.userId).catch(() => null);
      if (!user || userId !== user.id) return deny(socket, userRoom(userId), 'NOT_YOUR_ROOM', ack);
      socket.join(userRoom(user.id));
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('join_event_room', async (eventId, ack) => {
      if (!isId(eventId)) return deny(socket, null, 'BAD_EVENT', ack);
      try {
        const user = await activeUser(socket.data.userId);
        const access = await eventRoomAccess(user, eventId);
        if (!access.live) return deny(socket, eventRoom(eventId), user ? 'NO_EVENT_ACCESS' : 'SIGN_IN_REQUIRED', ack);
        socket.join(eventRoom(eventId));
        if (access.supervise) socket.join(supervisorRoom(eventId));
        if (typeof ack === 'function') ack({ ok: true, supervise: access.supervise });
      } catch (err) {
        console.error('join_event_room failed:', err.message);
        deny(socket, eventRoom(eventId), 'ERROR', ack);
      }
    });

    socket.on('leave_event_room', (eventId) => {
      if (!isId(eventId)) return;
      socket.leave(eventRoom(eventId));
      socket.leave(supervisorRoom(eventId));
    });
  });
}

/**
 * A user's access changed (event unassigned, role or permissions changed, removed from the organization): check
 * every event room their sockets are in again and take them out of the ones they may no longer receive.
 */
export async function reauthorizeUserRooms(userId) {
  const io = getIO();
  if (!io || !userId) return;
  try {
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    if (!sockets.length) return;
    const user = await activeUser(userId);
    const eventIds = [...new Set(sockets.flatMap((s) => [...s.rooms]).filter((r) => r.startsWith('event_')).map((r) => r.replace(/^event_/, '').replace(/_supervisors$/, '')))];
    for (const eventId of eventIds) {
      const access = await eventRoomAccess(user, eventId);
      if (!access.live) io.in(userRoom(userId)).socketsLeave([eventRoom(eventId), supervisorRoom(eventId)]);
      else if (!access.supervise) io.in(userRoom(userId)).socketsLeave(supervisorRoom(eventId));
    }
  } catch (err) {
    console.error('reauthorizeUserRooms failed:', err.message);
  }
}
