import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UserRoundPen, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../ui/DialogProvider';
import api from '../../utils/api';
import './profileGate.css';

export const PROFILE_INCOMPLETE_EVENT = 'tl:profile-incomplete';
const PROFILE_FORM = '/profile?tab=my-data';
const STRICT = new Set(['ORGANIZER', 'GATE_STAFF']);
const listOf = (missing = []) => missing.map((m) => m.label.toLowerCase()).join(', ');

const seen = (key) => {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return true; // no storage: don't nag
  }
};
const markSeen = (key) => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable */
  }
};

/**
 * Profile completeness, app-wide:
 * - an approval request refused with PROFILE_INCOMPLETE (organizers and gate staff) opens a dialog that names
 *   what is missing and leads to the profile form;
 * - customers get one suggestion, once per account, to complete their (optional) profile;
 * - organizers and gate staff with a missing field get the same card once per session, saying it is required.
 */
export default function ProfileGate() {
  const { user, isAuthenticated } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [nudge, setNudge] = useState(null); // { missing, required }

  // Refused approval request
  useEffect(() => {
    const onIncomplete = async (e) => {
      const missing = e.detail?.missing || [];
      const go = await dialog.confirm({
        tone: 'warning',
        title: 'Complete your profile first',
        message: `Organizers and gate staff need a complete profile, including a profile picture, before requesting any approval.${missing.length ? ` Still missing: ${listOf(missing)}.` : ''}`,
        confirmLabel: 'Complete profile',
        cancelLabel: 'Later',
      });
      if (go) navigate(PROFILE_FORM);
    };
    window.addEventListener(PROFILE_INCOMPLETE_EVENT, onIncomplete);
    return () => window.removeEventListener(PROFILE_INCOMPLETE_EVENT, onIncomplete);
  }, [dialog, navigate]);

  // One suggestion after signing in
  useEffect(() => {
    if (!isAuthenticated || !user?.id || user.role === 'SUPER_ADMIN') return undefined;
    const strict = STRICT.has(user.role);
    const key = `tl_profile_nudge_${user.id}`;
    if (strict) {
      try {
        if (sessionStorage.getItem(key)) return undefined;
      } catch {
        return undefined;
      }
    } else if (seen(key)) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      api.get('/users/profile-status')
        .then((r) => {
          const s = r.data?.data;
          if (!alive || !s || s.complete) return;
          if (strict) {
            try { sessionStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
          } else markSeen(key);
          setNudge({ missing: s.missing, required: strict });
        })
        .catch(() => {});
    }, 2500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [isAuthenticated, user?.id, user?.role]);

  // Not on the form itself, and never over seat picking, checkout or the gate scanner
  const busyPage = pathname === '/profile' || /\/(seats|checkout)$/.test(pathname) || pathname === '/checkout' || pathname.startsWith('/scanner');
  if (!nudge || !isAuthenticated || busyPage) return null;
  const close = () => setNudge(null);
  return (
    <aside className={`tl-pnudge${nudge.required ? ' is-required' : ''}`} role="status" aria-label="Complete your profile">
      <span className="tl-pnudge-ico" aria-hidden="true"><UserRoundPen className="w-5 h-5" /></span>
      <div className="tl-pnudge-body">
        <b>{nudge.required ? 'Your profile is incomplete' : 'Complete your profile'}</b>
        <p>
          {nudge.required
            ? `A complete profile with a picture is required before you can request event or organization approval. Missing: ${listOf(nudge.missing)}.`
            : `Add ${listOf(nudge.missing)} so organizers and support can recognise you. It is optional.`}
        </p>
        <div className="tl-pnudge-actions">
          <button type="button" className="tl-pnudge-go" onClick={() => { close(); navigate(PROFILE_FORM); }}>Complete profile</button>
          <button type="button" className="tl-pnudge-later" onClick={close}>Not now</button>
        </div>
      </div>
      <button type="button" className="tl-pnudge-x" onClick={close} aria-label="Dismiss"><X className="w-4 h-4" aria-hidden="true" /></button>
    </aside>
  );
}
