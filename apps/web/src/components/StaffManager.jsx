import { useDialog } from './ui/DialogProvider';
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../lib/session';
import { validateEmail } from '../lib/validation';
import { Plus, Send, RefreshCw, XCircle, UserX, UserCheck, Mail, AlertCircle, CheckCircle2, Users, UserPlus, CalendarDays, Info } from 'lucide-react';
import { DashCard, Notice, Status } from './dash/DashShell';

const Badge = ({ status }) => <Status value={status} />;

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * "Invite Staff + Staff List" (brief, section 4). One component for both panels:
 * organizers see their own events and staff; the Super Admin sees everything with a company filter.
 * The API enforces the same scoping, so this only shapes the UI.
 */
export default function StaffManager({ layout } = {}) {
  const dialog = useDialog();
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';

  const [events, setEvents] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(
    async (path, options = {}) => {
      const res = await fetch(`${API_URL}/api/staff${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Request failed');
      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const companyQuery = isAdmin && companyFilter ? `?companyId=${companyFilter}` : '';
      const [eventsData, staffData] = await Promise.all([
        request(`/events${companyQuery}`),
        request(`/${companyQuery}`),
      ]);
      setEvents(eventsData.data.events);
      if (isAdmin) setCompanies(eventsData.data.companies);
      setStaff(staffData.data.staff);
      setInvites(staffData.data.invites);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request, isAdmin, companyFilter]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // Take one event away from a staff member: their scanner stops working for it, online and offline
  const revokeEvent = async (s, ev) => {
    const ok = await dialog.confirm({
      tone: 'error',
      title: `Remove ${s.name} from ${ev.name}?`,
      message: 'They will no longer be able to scan tickets for this event, online or offline. The event’s offline ticket list is deleted from their scanner the next time it connects.',
      confirmLabel: 'Revoke access',
      cancelLabel: 'Keep access',
    });
    if (!ok) return;
    run(`${s.id}:${ev.id}`, () => request(`/${s.id}/events/${ev.id}`, { method: 'DELETE' }));
  };

  const run = async (id, action, successMessage) => {
    setError('');
    setNotice('');
    setBusyId(id);
    try {
      const data = await action();
      setNotice(data?.message || successMessage);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const invalid = validateEmail(email) || (!eventId && 'Choose an event to assign');
    if (invalid) {
      setError(invalid);
      return;
    }
    setSending(true);
    await run('new', () => request('/invites', { method: 'POST', body: JSON.stringify({ email: email.trim(), eventId }) }));
    setSending(false);
    setEmail('');
  };

  const openInvites = invites.filter((i) => i.status !== 'ACCEPTED');

  const initials = (name = '') => name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || '?';

  // Full-page layout (admin console "Gate staff" tab): filter bar, staff cards, invite + invitations column
  if (layout === 'full') {
    const activeStaff = staff.filter((s) => s.status === 'ACTIVE');
    const pendingInvites = invites.filter((i) => i.status === 'PENDING');
    return (
      <div className="tl-sf">
        <div className="tl-sf-bar">
          {isAdmin ? (
            <label className="tl-ss tl-sf-company">
              <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="Filter by company">
                <option value="">All companies</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </label>
          ) : <span />}
          <div className="tl-sf-stats">
            <div><span className="tl-sf-stat-icon" aria-hidden="true"><Users className="w-5 h-5" /></span><p><small>Active staff</small><strong>{activeStaff.length}</strong></p></div>
            <div><span className="tl-sf-stat-icon" aria-hidden="true"><Mail className="w-5 h-5" /></span><p><small>Open invitations</small><strong>{pendingInvites.length}</strong></p></div>
          </div>
        </div>

        {error && <Notice tone="bad" icon={AlertCircle} onDismiss={() => setError('')}>{error}</Notice>}
        {notice && !error && <Notice tone="good" icon={CheckCircle2} onDismiss={() => setNotice('')}>{notice}</Notice>}

        <div className="tl-sf-grid">
          <section className="tl-sf-card" aria-labelledby="tl-sf-active">
            <h2 id="tl-sf-active">Active staff ({activeStaff.length})</h2>
            <p className="tl-sf-sub">Staff members who can scan tickets at your events’ gates.</p>
            {loading ? (
              <div className="tl-dash-state"><RefreshCw className="w-5 h-5 tl-dash-spin" /></div>
            ) : staff.length === 0 ? (
              <div className="tl-sf-empty"><Users className="w-7 h-7" aria-hidden="true" /><strong>No gate staff yet</strong><span>Invite someone to an event to add them here.</span></div>
            ) : (
              <div className="tl-sf-list">
                {staff.map((s) => (
                  <article key={s.id} className="tl-sf-person">
                    <header>
                      <span className="tl-sf-avatar" aria-hidden="true">{initials(s.name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <h3>{s.name} <Badge status={s.status} /></h3>
                        <p>{s.email}</p>
                        {s.memberOfCompany && <p>{s.memberOfCompany.companyName}</p>}
                      </div>
                    </header>
                    <div className="tl-sf-assigned">
                      <h4>Assigned events ({s.staffAssignments.length})</h4>
                      <p className="tl-sf-sub">Events this staff member can scan tickets for.</p>
                      {s.staffAssignments.length === 0 ? (
                        <p className="tl-sf-none">No events assigned.</p>
                      ) : (
                        <ul>
                          {s.staffAssignments.map((a) => (
                            <li key={a.event.id || a.event.name}>
                              <span aria-hidden="true"><CalendarDays className="w-4 h-4" /></span>
                              <span className="tl-sf-event-name">{a.event.name}</span>
                              <button
                                type="button"
                                className="tl-sf-revoke"
                                disabled={busyId === `${s.id}:${a.event.id}`}
                                onClick={() => revokeEvent(s, a.event)}
                                aria-label={`Revoke ${s.name}'s access to ${a.event.name}`}
                                title="Revoke access to this event"
                              >
                                {busyId === `${s.id}:${a.event.id}` ? <RefreshCw className="w-3.5 h-3.5 tl-dash-spin" /> : <XCircle className="w-3.5 h-3.5" />} Revoke
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {s.status === 'ACTIVE' && (
                      <button
                        type="button"
                        className="tl-sf-deactivate"
                        disabled={busyId === s.id}
                        onClick={() => run(s.id, () => request(`/${s.id}/deactivate`, { method: 'PATCH' }))}
                      >
                        {busyId === s.id ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <UserX className="w-4 h-4" />} Deactivate staff
                      </button>
                    )}
                    {s.status === 'DEACTIVATED' && (
                      <button
                        type="button"
                        className="tl-sf-deactivate tl-sf-reactivate"
                        disabled={busyId === s.id}
                        onClick={() => run(s.id, () => request(`/${s.id}/reactivate`, { method: 'PATCH' }))}
                      >
                        {busyId === s.id ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <UserCheck className="w-4 h-4" />} Reactivate staff
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="tl-sf-side">
            <section className="tl-sf-card" aria-labelledby="tl-sf-invite">
              <div className="tl-sf-card-head">
                <span className="tl-sf-head-icon" aria-hidden="true"><UserPlus className="w-6 h-6" /></span>
                <div>
                  <h2 id="tl-sf-invite">Invite gate staff</h2>
                  <p className="tl-sf-sub">Give staff access to scan tickets for an event.</p>
                </div>
              </div>
              <form onSubmit={handleInvite} noValidate className="tl-sf-form">
                <label htmlFor="tl-sf-email">Staff email</label>
                <div className="tl-dash-search">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  <input id="tl-sf-email" type="email" className="tl-dash-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@email.com" />
                </div>
                <label htmlFor="tl-sf-event">Event to assign</label>
                <select id="tl-sf-event" className="tl-dash-select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value="">Select an event</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.name} · {formatDate(ev.date)}{isAdmin ? ` · ${ev.company.companyName}` : ''}</option>
                  ))}
                </select>
                <button type="submit" className="tl-sf-invite-btn" disabled={sending}>
                  {sending ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Plus className="w-4 h-4" />} Invite staff
                </button>
                <p className="tl-sf-hint"><Info className="w-4 h-4" aria-hidden="true" />{events.length === 0 ? 'Create an event first, then invite staff to it.' : 'Select an event before sending the invitation.'}</p>
              </form>
            </section>

            <section className="tl-sf-card" aria-labelledby="tl-sf-invites">
              <div className="tl-sf-card-head">
                <span className="tl-sf-head-icon" aria-hidden="true"><Mail className="w-6 h-6" /></span>
                <div>
                  <h2 id="tl-sf-invites">Open invitations ({pendingInvites.length})</h2>
                  <p className="tl-sf-sub">Invitations you’ve sent to join your gate team.</p>
                </div>
              </div>
              {invites.filter((i) => i.status !== 'ACCEPTED').length === 0 ? (
                <div className="tl-sf-empty">
                  <Mail className="w-7 h-7" aria-hidden="true" />
                  <strong>No pending invitations</strong>
                  <span>Invitations will appear here after you send them.</span>
                </div>
              ) : (
                <ul className="tl-sf-invites">
                  {invites.filter((i) => i.status !== 'ACCEPTED').map((inv) => (
                    <li key={inv.id}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{inv.email} <Badge status={inv.status} /></strong>
                        <span>{inv.event.name}</span>
                        <span>Invited by {inv.invitedBy.name}{inv.status === 'PENDING' ? ` · expires ${formatDate(inv.expiresAt)}` : ''}</span>
                      </div>
                      {['PENDING', 'EXPIRED'].includes(inv.status) && (
                        <div className="tl-staff-actions">
                          <button type="button" className="tl-staff-icon" disabled={busyId === inv.id} onClick={() => run(inv.id, () => request(`/invites/${inv.id}/resend`, { method: 'POST' }))} aria-label={`Resend invite to ${inv.email}`} title="Resend">
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button type="button" className="tl-staff-icon is-danger" disabled={busyId === inv.id} onClick={() => run(inv.id, () => request(`/invites/${inv.id}`, { method: 'DELETE' }), 'Invite cancelled.')} aria-label={`Cancel invite to ${inv.email}`} title="Cancel invite">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashCard
      title="Gate staff"
      sub="Invite staff to scan at an event's gates"
      aside={isAdmin && (
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="tl-dash-select" aria-label="Filter by company">
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </select>
      )}
    >
      {error && <Notice tone="bad" icon={AlertCircle}>{error}</Notice>}
      {notice && !error && <Notice tone="good" icon={CheckCircle2}>{notice}</Notice>}

      {/* Invite form */}
      <form onSubmit={handleInvite} className="tl-staff-form" noValidate>
        <div className="tl-dash-search">
          <Mail className="w-4 h-4" aria-hidden="true" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@email.com" aria-label="Staff email" className="tl-dash-input" />
        </div>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event to assign" className="tl-dash-select">
          <option value="">Event to assign…</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name} · {formatDate(ev.date)}{isAdmin ? ` · ${ev.company.companyName}` : ''}
            </option>
          ))}
        </select>
        <button type="submit" disabled={sending} className="tl-st-btn tl-st-btn--green tl-st-btn--sm">
          {sending ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Plus className="w-4 h-4" />}
          Invite staff
        </button>
      </form>
      {!loading && events.length === 0 && (
        <p className="tl-dash-card-sub">No events yet. Create an event first, then invite staff to it.</p>
      )}

      {loading ? (
        <div className="tl-dash-state"><RefreshCw className="w-5 h-5 tl-dash-spin" /></div>
      ) : (
        <>
          <section className="tl-staff-group" aria-labelledby="tl-staff-active">
            <h3 id="tl-staff-active">Active staff ({staff.filter((s) => s.status === 'ACTIVE').length})</h3>
            {staff.length === 0 ? (
              <p className="tl-dash-card-sub">No gate staff yet.</p>
            ) : (
              staff.map((s) => (
                <div key={s.id} className="tl-staff-row">
                  <span className="tl-staff-avatar" aria-hidden="true">{initials(s.name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="tl-staff-name"><span>{s.name}</span><Badge status={s.status} /></div>
                    <p>{s.email}{isAdmin && s.memberOfCompany ? ` · ${s.memberOfCompany.companyName}` : ''}</p>
                    {s.staffAssignments.length ? (
                      <ul className="tl-staff-events" aria-label={`Events ${s.name} can scan`}>
                        {s.staffAssignments.map((a) => (
                          <li key={a.event.id}>
                            {a.event.name}
                            <button
                              type="button"
                              onClick={() => revokeEvent(s, a.event)}
                              disabled={busyId === `${s.id}:${a.event.id}`}
                              aria-label={`Revoke ${s.name}'s access to ${a.event.name}`}
                              title="Revoke access to this event"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Gate staff · No events</p>
                    )}
                  </div>
                  {s.status === 'ACTIVE' && (
                    <div className="tl-staff-actions">
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => run(s.id, () => request(`/${s.id}/deactivate`, { method: 'PATCH' }))}
                        className="tl-staff-icon is-danger"
                        aria-label={`Deactivate ${s.name}`}
                        title="Deactivate"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {s.status === 'DEACTIVATED' && (
                    <div className="tl-staff-actions">
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => run(s.id, () => request(`/${s.id}/reactivate`, { method: 'PATCH' }))}
                        className="tl-staff-icon is-good"
                        aria-label={`Reactivate ${s.name}`}
                        title="Reactivate"
                      >
                        <UserCheck className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="tl-staff-group" aria-labelledby="tl-staff-invites">
            <h3 id="tl-staff-invites">Invites ({openInvites.length} open)</h3>
            {invites.length === 0 ? (
              <p className="tl-dash-card-sub">No invites sent yet.</p>
            ) : (
              invites.map((inv) => (
                <div key={inv.id} className="tl-staff-row">
                  <span className="tl-staff-avatar" aria-hidden="true"><Send className="w-4 h-4" /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="tl-staff-name"><span>{inv.email}</span><Badge status={inv.status} /></div>
                    <p>{inv.event.name}</p>
                    <p>
                      Invited by {inv.invitedBy.name}
                      {inv.status === 'PENDING' ? ` · expires ${formatDate(inv.expiresAt)}` : ''}
                    </p>
                  </div>
                  {['PENDING', 'EXPIRED'].includes(inv.status) && (
                    <div className="tl-staff-actions">
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => run(inv.id, () => request(`/invites/${inv.id}/resend`, { method: 'POST' }))}
                        className="tl-staff-icon"
                        aria-label={`Resend invite to ${inv.email}`}
                        title="Resend"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => run(inv.id, () => request(`/invites/${inv.id}`, { method: 'DELETE' }), 'Invite cancelled.')}
                        className="tl-staff-icon is-danger"
                        aria-label={`Cancel invite to ${inv.email}`}
                        title="Cancel invite"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </DashCard>
  );
}
