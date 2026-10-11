import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { API_URL, setAccessToken, setSessionHandlers } from '../lib/session';

const AuthContext = createContext(null);

// Refresh the access token this long before it expires
const REFRESH_LEAD_MS = 60 * 1000;
// Inactivity sign-out (matches the API's SESSION_IDLE_TIMEOUT_MS). Activity is shared across tabs.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'tl_last_active';
// After signing out, Back must not reopen the pages from before: the history position of the login page
// shown at sign-out is kept for this tab, and going back past it lands on the login page again.
// Pages opened after signing out keep their normal Back. Cleared on the next sign-in.
const SIGNED_OUT_KEY = 'tl_signed_out_at';
const historyIndex = () => window.history.state?.idx;
const readSignedOutAt = () => {
  try {
    const v = sessionStorage.getItem(SIGNED_OUT_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const writeSignedOutAt = (idx) => {
  try {
    if (idx == null) sessionStorage.removeItem(SIGNED_OUT_KEY);
    else sessionStorage.setItem(SIGNED_OUT_KEY, String(idx));
  } catch {
    /* storage unavailable: Back falls back to the route guards */
  }
};
const readLastActive = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeLastActive = (t) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t));
  } catch {
    /* storage unavailable */
  }
};

const tokenExpiry = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return null;
  }
};

/**
 * Calls an /api/auth endpoint with the refresh cookie. Throws an Error carrying the API's
 * `code`, `needsVerification`, `status` and `data` so screens can react to them.
 */
const authRequest = async (path, { method = 'POST', body } = {}) => {
  const res = await fetch(`${API_URL}/api/auth${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    err.code = data.code;
    err.needsVerification = Boolean(data.needsVerification);
    err.data = data.data;
    throw err;
  }
  return data;
};

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshInFlight = useRef(null);

  const applySession = useCallback((session) => {
    writeSignedOutAt(null);
    setAccessToken(session.token);
    setToken(session.token);
    setUser(session.user);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setToken(null);
    setUser(null);
  }, []);

  // Signed out: show the login page in place of the current one and remember where that is in history
  const goToLoginAfterSignOut = useCallback(
    (state) => {
      navigate('/login', { replace: true, state });
      writeSignedOutAt(historyIndex() ?? 0);
    },
    [navigate],
  );

  // Back / Forward to a page from before signing out: the login page instead
  const location = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (user || navigationType !== 'POP') return;
    const boundary = readSignedOutAt();
    const idx = historyIndex();
    if (boundary != null && idx != null && idx < boundary && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [location.key, navigationType, user, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSuspended = useCallback(() => {
    clearSession();
    navigate('/suspended', { replace: true });
  }, [clearSession, navigate]);

  // Single-flight refresh: concurrent callers share one request (the refresh token rotates on use)
  const refreshSession = useCallback(() => {
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        try {
          const res = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            applySession(data.data);
            return data.data.token;
          }
          clearSession();
          if (data.code === 'ACCOUNT_SUSPENDED') navigate('/suspended', { replace: true });
          return null;
        } catch {
          // Network error: keep the current state and let the next request try again
          return null;
        } finally {
          refreshInFlight.current = null;
        }
      })();
    }
    return refreshInFlight.current;
  }, [applySession, clearSession, navigate]);

  useEffect(() => {
    setSessionHandlers({ onRefresh: refreshSession, onSuspended: handleSuspended });
  }, [refreshSession, handleSuspended]);

  // Restore the session from the refresh cookie on startup
  useEffect(() => {
    // Tokens used to be kept in localStorage; remove any leftover
    try {
      localStorage.removeItem('tl_token');
    } catch {
      /* storage unavailable */
    }

    (async () => {
      // Away longer than the idle limit (every tab closed or asleep): end the session instead of restoring it
      const last = readLastActive();
      if (last && Date.now() - last > IDLE_TIMEOUT_MS) {
        try {
          await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
        } catch {
          /* the server ends idle sessions on its own too */
        }
        writeLastActive(Date.now());
        setLoading(false);
        return;
      }
      writeLastActive(Date.now());
      let restored = await refreshSession();
      if (!restored) {
        // Another tab may have rotated the cookie at the same moment; try once more
        await new Promise((r) => setTimeout(r, 300));
        restored = await refreshSession();
      }
      setLoading(false);
    })();
  }, []);

  // Refresh shortly before the 15-minute access token expires
  useEffect(() => {
    if (!token) return undefined;
    const expiresAt = tokenExpiry(token);
    if (!expiresAt) return undefined;
    const timer = setTimeout(refreshSession, Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS));
    return () => clearTimeout(timer);
  }, [token, refreshSession]);

  // Inactivity sign-out: 30 minutes without a click, key, scroll or touch in any tab
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return undefined;
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 15000) {
        lastWrite = now;
        writeLastActive(now);
      }
    };
    const check = async () => {
      if (Date.now() - readLastActive() <= IDLE_TIMEOUT_MS) return;
      try {
        await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch {
        /* the server ends idle sessions on its own too */
      }
      clearSession();
      goToLoginAfterSignOut({ from: window.location.pathname, notice: 'You were signed out after 30 minutes of inactivity. Log in again to continue.' });
    };
    writeLastActive(Date.now());
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(check, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [signedIn, clearSession, goToLoginAfterSignOut]);

  const login = async (email, password) => {
    const data = await authRequest('/login', { body: { email, password } });
    applySession(data.data);
    return data.data;
  };

  const signup = async (form) => authRequest('/signup', { body: form });

  // The unverified signup from this browser (identified by an httpOnly cookie) and its OTP timing
  const getPendingSignup = async () => authRequest('/pending-signup', { method: 'GET' });

  const updatePendingSignup = async (form) => authRequest('/pending-signup', { method: 'PATCH', body: form });

  const verifyOtp = async (email, code) => {
    const data = await authRequest('/verify-otp', { body: { email, code, purpose: 'VERIFY_EMAIL' } });
    applySession(data.data);
    return data.data;
  };

  const resendOtp = async (email, purpose = 'VERIFY_EMAIL') => authRequest('/resend-otp', { body: { email, purpose } });

  const forgotPassword = async (email) => authRequest('/forgot-password', { body: { email } });

  const resetPassword = async (email, code, newPassword) =>
    authRequest('/reset-password', { body: { email, code, newPassword } });

  const getInvite = async (inviteToken) =>
    authRequest(`/invite/${encodeURIComponent(inviteToken)}`, { method: 'GET' });

  const acceptInvite = async (inviteToken, name, password) => {
    const data = await authRequest('/accept-invite', { body: { token: inviteToken, name, password } });
    applySession(data.data);
    return data.data;
  };

  // Re-reads the user (e.g. after a company registration changes companyStatus)
  const refreshUser = async () => {
    if (!token) return null;
    const res = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    setUser(data.data.user);
    return data.data.user;
  };

  const logout = async () => {
    try {
      await authRequest('/logout');
    } catch {
      /* the local session is cleared regardless */
    }
    clearSession();
    goToLoginAfterSignOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        role: user?.role || null,
        login,
        signup,
        getPendingSignup,
        updatePendingSignup,
        verifyOtp,
        resendOtp,
        forgotPassword,
        resetPassword,
        getInvite,
        acceptInvite,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
