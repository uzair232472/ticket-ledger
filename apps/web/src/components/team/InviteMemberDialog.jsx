import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, RefreshCw, Send, X } from 'lucide-react';
import api from '../../utils/api';
import { ROLE_LABELS } from '../../lib/permissions';
import { validateEmail } from '../../lib/validation';

// Roles limited to the events picked for them
export const SCOPED_ROLES = ['EVENT_MANAGER', 'STAFF', 'GATE_STAFF'];
const OWNER_ONLY = ['OWNER', 'ADMIN'];
const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';

/**
 * "Invite a team member" dialog. Gate Staff go through the gate staff invite (one per event, which also adds an
 * existing staff member to another event straight away); every other role gets an organization invitation.
 * Stays open with the reason when the API refuses, and calls `onSent(message)` once something was sent.
 */
export default function InviteMemberDialog({ open, onClose, onSent, events = [], scope = {}, isOwner = false, myEventIds = null, defaultRole = 'STAFF' }) {
  const [form, setForm] = useState({ email: '', role: defaultRole, eventIds: [] });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const emailRef = useRef(null);
  const roles = Object.keys(ROLE_LABELS).filter((r) => isOwner || !OWNER_ONLY.includes(r));
  const pickable = myEventIds ? events.filter((e) => myEventIds.includes(e.id)) : events;
  const scoped = SCOPED_ROLES.includes(form.role);
  const gate = form.role === 'GATE_STAFF';

  // Fresh form each time it opens, on the role that fits where it was opened from
  useEffect(() => {
    if (!open) return undefined;
    setForm({ email: '', role: defaultRole, eventIds: [] });
    setError('');
    requestAnimationFrame(() => emailRef.current?.focus());
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, defaultRole]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const toggleEvent = (id) => setForm((f) => ({ ...f, eventIds: f.eventIds.includes(id) ? f.eventIds.filter((x) => x !== id) : [...f.eventIds, id] }));

  const submit = async (e) => {
    e.preventDefault();
    const bad = validateEmail(form.email) || (gate && !form.eventIds.length ? 'Choose at least one event for this gate staff member.' : '');
    setError(bad || '');
    if (bad) return;
    const email = form.email.trim().toLowerCase();
    setSending(true);
    try {
      let message;
      if (gate) {
        // One gate invite per event; stop at the first refusal so the reason is shown
        for (const eventId of form.eventIds) {
          const res = await api.post('/staff/invites', { email, eventId });
          message = res?.data?.message;
        }
        message = form.eventIds.length > 1 ? `Gate staff invited to ${form.eventIds.length} events.` : message || 'Gate staff invited.';
      } else {
        const res = await api.post('/org/invitations', { email, role: form.role, eventIds: scoped ? form.eventIds : [] }, { params: scope });
        message = res?.data?.message || 'Invitation sent.';
      }
      onSent?.(message);
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="tl-dash-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} noValidate className="tl-dash-dialog tl-inv-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-inv-title">
        <button type="button" className="tl-inv-close" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        <h3 id="tl-inv-title">Invite a team member</h3>
        <p>{gate ? 'They can scan tickets at the gates of the events you pick.' : 'New and existing TicketLedger accounts. The link works once and expires in 72 hours.'}</p>
        <label htmlFor="tl-inv-email">Email</label>
        <input ref={emailRef} id="tl-inv-email" className="tl-dash-input" type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <label htmlFor="tl-inv-role">Role</label>
        <select id="tl-inv-role" className="tl-dash-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        {scoped && (
          <fieldset className="tl-inv-events">
            <legend><CalendarDays className="w-4 h-4" aria-hidden="true" /> {gate ? 'Events they scan at' : 'Events they can work on'} <span>({form.eventIds.length} selected)</span></legend>
            <div>
              {pickable.map((ev) => (
                <label key={ev.id} className={form.eventIds.includes(ev.id) ? 'is-on' : undefined}>
                  <input type="checkbox" checked={form.eventIds.includes(ev.id)} onChange={() => toggleEvent(ev.id)} />
                  <span>{ev.name}</span>
                </label>
              ))}
              {!pickable.length && <span className="tl-inv-none">No events to assign yet. Create an event first.</span>}
            </div>
          </fieldset>
        )}
        {error && <p className="tl-inv-error" role="alert">{error}</p>}
        <div className="tl-dash-dialog-actions">
          <button type="button" className="tl-dash-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="tl-dash-btn tl-dash-btn--green" disabled={sending}>
            {sending ? <RefreshCw className="w-4 h-4 tl-dash-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />} Send invitation
          </button>
        </div>
      </form>
    </div>
  );
}
