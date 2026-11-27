import { io } from 'socket.io-client';
import { API_URL, getAccessToken } from './session';

export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_URL;

/**
 * A Socket.io connection signed in with the current access token (read again on every reconnect, so a refreshed
 * token is used). Private rooms (your notifications, an event's live gate data) are only joined when the server
 * accepts the token; without one the socket still receives public broadcasts such as seat-map changes.
 */
export const connectSocket = (options = {}) => io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: getAccessToken() }),
  ...options,
});
