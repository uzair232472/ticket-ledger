import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper to get or create persistent client session ID
export const getClientSessionId = () => {
  let sessionId = localStorage.getItem('tl_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('tl_session_id', sessionId);
  }
  return sessionId;
};

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('tl_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Attach persistent session ID for guest and authenticated telemetry
    config.headers['x-session-id'] = getClientSessionId();
    return config;
  },
  (error) => Promise.reject(error)
);

// Client-side telemetry helper
export const trackClientBehavior = async (action, eventId = null, metadata = {}) => {
  try {
    await api.post('/behavior/track', {
      action,
      eventId,
      metadata,
      sessionId: getClientSessionId(),
    });
  } catch (err) {
    // Non-blocking telemetry
    console.debug('Telemetry ping failed:', err.message);
  }
};

export default api;
