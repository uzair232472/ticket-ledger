// In-memory session shared by AuthContext, the axios instances and fetch.
// The access token is never written to localStorage; a page reload restores it from the
// httpOnly refresh cookie (POST /api/auth/refresh).
import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

let accessToken = null;
let refreshHandler = null;
let suspendedHandler = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => {
  accessToken = token;
};

/** AuthContext registers how to refresh the session and what to do when the account is suspended. */
export const setSessionHandlers = ({ onRefresh, onSuspended }) => {
  refreshHandler = onRefresh;
  suspendedHandler = onSuspended;
};

const refreshAccessToken = () => (refreshHandler ? refreshHandler() : Promise.resolve(null));

const isApiRequest = (url) => typeof url === 'string' && url.startsWith(API_URL) && !url.includes('/api/auth/');

/**
 * Retries a request once with a fresh access token when the API reports TOKEN_EXPIRED, and sends the
 * user to /suspended when the account was blocked. Applied to window.fetch and to axios instances so
 * the existing pages (which pass `token` from useAuth) keep working across the 15-minute expiry.
 */
let fetchInstalled = false;
export const installFetchInterceptor = () => {
  if (fetchInstalled) return;
  fetchInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const response = await originalFetch(input, init);
    if (!isApiRequest(typeof input === 'string' ? input : input?.url)) return response;
    if (response.status !== 401 && response.status !== 403) return response;

    const body = await response.clone().json().catch(() => null);
    if (response.status === 403 && body?.code === 'ACCOUNT_SUSPENDED') {
      suspendedHandler?.();
      return response;
    }
    if (response.status === 401 && body?.code === 'TOKEN_EXPIRED' && typeof input === 'string') {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) return response;
      const newToken = await refreshAccessToken();
      if (!newToken) return response;
      headers.set('Authorization', `Bearer ${newToken}`);
      return originalFetch(input, { ...init, headers });
    }
    return response;
  };
};

const installedAxios = new WeakSet();
export const installAxiosInterceptor = (instance) => {
  if (installedAxios.has(instance)) return;
  installedAxios.add(instance);

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const { response, config } = error;
      const code = response?.data?.code;
      if (response?.status === 403 && code === 'ACCOUNT_SUSPENDED') {
        suspendedHandler?.();
      } else if (
        response?.status === 401 &&
        code === 'TOKEN_EXPIRED' &&
        config &&
        !config._retried &&
        config.headers?.Authorization
      ) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          config._retried = true;
          config.headers.Authorization = `Bearer ${newToken}`;
          return instance(config);
        }
      }
      return Promise.reject(error);
    }
  );
};

installFetchInterceptor();
installAxiosInterceptor(axios);

/** Where each role lands after login (brief, section 4). */
export const getHomeRoute = (user) => {
  switch (user?.role) {
    case 'SUPER_ADMIN':
      return '/admin/dashboard';
    case 'ORGANIZER':
      return user.companyStatus === 'APPROVED' ? '/organizer/dashboard' : '/company';
    case 'GATE_STAFF':
      return '/staff/events';
    default:
      return '/events';
  }
};
