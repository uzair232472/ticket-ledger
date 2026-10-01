import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../lib/session';
import { validateEmail } from '../lib/validation';
import { UserPlus, Send, RefreshCw, XCircle, UserX, Mail, Users, AlertCircle, CheckCircle2 } from 'lucide-react';

const STATUS_STYLES = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
  EXPIRED: 'bg-slate-100 text-slate-500 border-slate-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DEACTIVATED: 'bg-rose-50 text-rose-700 border-rose-200',
  SUSPENDED: 'bg-rose-50 text-rose-700 border-rose-200',
  BANNED: 'bg-rose-50 text-rose-700 border-rose-200',
};

const Badge = ({ status }) => (
  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[status] || STATUS_STYLES.CANCELLED}`}>
    {status}
  </span>
);

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * "Invite Staff + Staff List" (brief, section 4). One component for both panels:
 * organizers see their own events and staff; the Super Admin sees everything with a company filter.
 * The API enforces the same scoping, so this only shapes the UI.
 */
export default function StaffManager() {
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

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-[#16a34a]" /> Gate Staff
        </h2>
        {isAdmin && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
            aria-label="Filter by company"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {notice && !error && (
        <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {notice}
        </div>
      )}

      {/* Invite form */}
      <form onSubmit={handleInvite} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2" noValidate>
        <div className="relative">
          <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@email.com"
            aria-label="Staff email"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-[#22c55e]"
          />
        </div>
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          aria-label="Event to assign"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#22c55e]"
        >
          <option value="">Event to assign…</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name} · {formatDate(ev.date)}{isAdmin ? ` · ${ev.company.companyName}` : ''}
            </option>
          ))}
        </select>
        <button type="submit" disabled={sending} className="btn-eventfrog text-xs px-4 py-2 inline-flex items-center justify-center gap-1.5">
          {sending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Send invite
        </button>
      </form>
      {!loading && events.length === 0 && (
        <p className="text-[11px] text-slate-500">No events yet. Create an event first, then invite staff to it.</p>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-[#16a34a]" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Staff accounts */}
          <div>
            <h3 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" /> Staff accounts ({staff.length})
            </h3>
            {staff.length === 0 ? (
              <p className="text-xs text-slate-500">No gate staff yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                {staff.map((s) => (
                  <li key={s.id} className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        <span className="truncate">{s.name}</span> <Badge status={s.status} />
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{s.email}</div>
                      {isAdmin && s.memberOfCompany && (
                        <div className="text-[11px] text-slate-400">{s.memberOfCompany.companyName}</div>
                      )}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {s.staffAssignments.map((a) => a.event.name).join(', ') || 'No events'}
                      </div>
                    </div>
                    {s.status === 'ACTIVE' && (
                      <button
                        type="button"
                        disabled={busyId === s.id}
                        onClick={() => run(s.id, () => request(`/${s.id}/deactivate`, { method: 'PATCH' }))}
                        className="text-[11px] font-bold text-rose-600 hover:underline inline-flex items-center gap-1 flex-shrink-0"
                      >
                        <UserX className="w-3.5 h-3.5" /> Deactivate
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Invites */}
          <div>
            <h3 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> Invites ({openInvites.length} open)
            </h3>
            {invites.length === 0 ? (
              <p className="text-xs text-slate-500">No invites sent yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                {invites.map((inv) => (
                  <li key={inv.id} className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                        <span className="truncate">{inv.email}</span> <Badge status={inv.status} />
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{inv.event.name}</div>
                      <div className="text-[11px] text-slate-400">
                        Invited by {inv.invitedBy.name}
                        {inv.status === 'PENDING' ? ` · expires ${formatDate(inv.expiresAt)}` : ''}
                      </div>
                    </div>
                    {['PENDING', 'EXPIRED'].includes(inv.status) && (
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => run(inv.id, () => request(`/invites/${inv.id}/resend`, { method: 'POST' }))}
                          className="text-[11px] font-bold text-[#16a34a] hover:underline inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Resend
                        </button>
                        <button
                          type="button"
                          disabled={busyId === inv.id}
                          onClick={() => run(inv.id, () => request(`/invites/${inv.id}`, { method: 'DELETE' }), 'Invite cancelled.')}
                          className="text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:underline inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
