import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Mail, ShieldCheck, ScanLine, History, Send, RefreshCw, XCircle, UserX, UserCheck, Trash2, KeyRound, Download, Crown } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ui/DialogProvider';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';
import StaffManager from '../components/StaffManager';
import { can, ROLE_LABELS } from '../lib/permissions';
import { validateEmail } from '../lib/validation';

/*
 * Organizer Team page: members, invitations, roles & permissions, gate staff and activity. What is shown follows
 * the viewer's organization permissions; the API enforces every rule again (scope, last owner, grants).
 * Super Admins pick an organization first (their requests carry ?companyId= and are audited).
 */

const SCOPED = ['EVENT_MANAGER', 'STAFF', 'GATE_STAFF'];
const OWNER_ONLY = ['OWNER', 'ADMIN'];
const fmt = (v) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';

export default function OrganizerTeam() {
  const { user, refreshUser } = useAuth();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [companyId, setCompanyId] = useState(params.get('companyId') || '');
  const [companies, setCompanies] = useState([]);
  const scope = isAdmin ? { companyId } : {};
  const ready = !isAdmin || Boolean(companyId);

  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState({ roles: [], permissions: [] });
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [events, setEvents] = useState([]);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

  const perms = useMemo(() => new Set(me?.permissions || []), [me]);
  const has = (p) => isAdmin || perms.has(p);
  const isOwner = isAdmin || me?.role === 'OWNER';

  const tabs = [
    has('staff.view') && { value: 'members', label: 'Members', icon: Users, count: members.length },
    has('staff.view') && { value: 'invitations', label: 'Invitations', icon: Mail, count: invites.filter((i) => i.status === 'PENDING').length },
    { value: 'roles', label: 'Roles & permissions', icon: ShieldCheck },
    has('staff.view') && { value: 'gate', label: 'Gate staff', icon: ScanLine },
    has('audit.view') && { value: 'activity', label: 'Activity', icon: History },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  const setTab = (value) => setParams((p) => { p.set('tab', value); return p; }, { replace: true });

  const flash = (tone, text) => setNotice({ tone, text });

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const [meRes, rolesRes] = await Promise.all([api.get('/org/me', { params: scope }), api.get('/org/roles', { params: scope })]);
      const mine = meRes.data.data;
      setMe(mine);
      setCatalog(rolesRes.data.data);
      const p = new Set(mine?.permissions || []);
      const [m, i, e] = await Promise.all([
        isAdmin || p.has('staff.view') ? api.get('/org/members', { params: scope }) : null,
        isAdmin || p.has('staff.view') ? api.get('/org/invitations', { params: scope }) : null,
        api.get('/events/organizer/my-events', { params: scope }).catch(() => null),
      ]);
      setMembers(m?.data.data.members || []);
      setInvites(i?.data.data.invitations || []);
      setEvents(e?.data.data.events || []);
    } catch (err) {
      flash('bad', errText(err));
    } finally {
      setLoading(false);
    }
  }, [ready, companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin) api.get('/companies/admin/all').then((r) => setCompanies(r.data.data?.companies || r.data.data || [])).catch(() => {});
  }, [isAdmin]);

  const run = async (fn, okText) => {
    try {
      const res = await fn();
      flash('good', res?.data?.message || okText);
      await load();
      if (!isAdmin) refreshUser?.();
    } catch (err) {
      flash('bad', errText(err));
    }
  };

  if (isAdmin && !companyId) {
    return (
      <div className="space-y-6">
        <DashHead eyebrow="Organization" title="Team" intro="Choose an organization. Your access is recorded in its activity history." />
        <DashCard title="Organization">
          <select className="tl-dash-select w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setParams({ companyId: e.target.value }); }}>
            <option value="">Select an organization…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        </DashCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashHead
        eyebrow={me?.organization?.name || 'Organization'}
        title="Team"
        intro={me ? `You are ${me.roleLabel}${me.eventScoped ? ' (assigned events only)' : ''}.` : undefined}
        segment={<Segmented label="Team sections" options={tabs} value={tab} onChange={setTab} />}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {loading && !me ? <DashState icon={RefreshCw} title="Loading team…" /> : null}

      {tab === 'members' && <Members {...{ members, events, catalog, me, has, isOwner, scope, run, dialog }} />}
      {tab === 'invitations' && <Invitations {...{ invites, events, has, isOwner, scope, run, dialog, myEventIds: me?.eventScoped ? me.eventIds : null }} />}
      {tab === 'roles' && <RolesMatrix catalog={catalog} />}
      {tab === 'gate' && <StaffManager />}
      {tab === 'activity' && <Activity members={members} scope={scope} />}
    </div>
  );
}

// ── Members ────────────────────────────────────────────────────────────────────────────────────────────

function Members({ members, events, catalog, me, has, isOwner, scope, run, dialog }) {
  const [open, setOpen] = useState(null);
  const [transfer, setTransfer] = useState({ memberId: '', password: '', stepDown: true });
  const others = members.filter((m) => m.status === 'ACTIVE' && m.userId !== me?.memberId && m.id !== me?.memberId);

  const act = async (m, action) => {
    const labels = { deactivate: 'Deactivate', reactivate: 'Reactivate', remove: 'Remove' };
    if (action !== 'reactivate') {
      const ok = await dialog.confirm({
        tone: 'error',
        title: `${labels[action]} ${m.name}?`,
        message: action === 'remove'
          ? 'They leave the organization and lose access at once. Their past actions stay in the activity history. Their TicketLedger account is not affected.'
          : 'They lose access to the organization at their next request. Their TicketLedger account and tickets are not affected.',
        confirmLabel: labels[action],
      });
      if (!ok) return;
    }
    if (action === 'remove') return run(() => api.delete(`/org/members/${m.id}`, { params: scope }), 'Member removed.');
    return run(() => api.post(`/org/members/${m.id}/${action}`, {}, { params: scope }), 'Done.');
  };

  return (
    <div className="space-y-6">
      <DashCard title="Members" sub="People with access to this organization" icon={Users}>
        {!members.length ? <DashState icon={Users} title="No members yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Events</th><th>Actions</th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const manageable = !OWNER_ONLY.includes(m.role) || isOwner;
                  return (
                    <React.Fragment key={m.id}>
                      <tr>
                        <td><strong>{m.name}</strong><div className="text-xs text-slate-500">{m.email}</div></td>
                        <td>
                          {has('staff.roles') && manageable && m.status !== 'REMOVED' ? (
                            <select className="tl-dash-select" value={m.role} onChange={(e) => run(() => api.patch(`/org/members/${m.id}`, { role: e.target.value }, { params: scope }), 'Role changed.')}>
                              {catalog.roles.filter((r) => isOwner || !r.ownerOnly).map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                            </select>
                          ) : ROLE_LABELS[m.role]}
                        </td>
                        <td><Status value={m.status} /></td>
                        <td className="text-xs">{SCOPED.includes(m.role) ? (m.events.length ? m.events.map((e) => e.name).join(', ') : 'None assigned') : 'All events'}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            {(has('staff.roles') || has('staff.manage')) && manageable && (
                              <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setOpen(open === m.id ? null : m.id)}><KeyRound className="w-3.5 h-3.5 inline" /> Access</button>
                            )}
                            {has('staff.manage') && manageable && m.status === 'ACTIVE' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(m, 'deactivate')}><UserX className="w-3.5 h-3.5 inline" /> Deactivate</button>}
                            {has('staff.manage') && manageable && m.status === 'DEACTIVATED' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(m, 'reactivate')}><UserCheck className="w-3.5 h-3.5 inline" /> Reactivate</button>}
                            {has('staff.manage') && manageable && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(m, 'remove')}><Trash2 className="w-3.5 h-3.5 inline" /> Remove</button>}
                          </div>
                        </td>
                      </tr>
                      {open === m.id && (
                        <tr><td colSpan={5}><MemberAccess member={m} events={events} catalog={catalog} has={has} scope={scope} run={run} /></td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>

      {me?.role === 'OWNER' && (
        <DashCard title="Transfer ownership" sub="Make another active member an owner. An organization always keeps at least one owner." icon={Crown}>
          <form
            className="grid gap-3 sm:grid-cols-4 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.post('/org/ownership/transfer', transfer, { params: scope }), 'Ownership transferred.').then(() => setTransfer({ memberId: '', password: '', stepDown: true }));
            }}
          >
            <select className="tl-dash-select" required value={transfer.memberId} onChange={(e) => setTransfer({ ...transfer, memberId: e.target.value })}>
              <option value="">New owner…</option>
              {others.filter((m) => m.role !== 'OWNER').map((m) => <option key={m.id} value={m.id}>{m.name} ({ROLE_LABELS[m.role]})</option>)}
            </select>
            <input className="tl-dash-input" type="password" required placeholder="Your password" autoComplete="current-password" value={transfer.password} onChange={(e) => setTransfer({ ...transfer, password: e.target.value })} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={transfer.stepDown} onChange={(e) => setTransfer({ ...transfer, stepDown: e.target.checked })} /> I become an Organization Admin</label>
            <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm">Transfer</button>
          </form>
        </DashCard>
      )}
    </div>
  );
}

function MemberAccess({ member, events, catalog, has, scope, run }) {
  const defaults = new Set(catalog.roles.find((r) => r.role === member.role)?.permissions || []);
  const [granted, setGranted] = useState(member.grantedPermissions);
  const [revoked, setRevoked] = useState(member.revokedPermissions);
  const [eventIds, setEventIds] = useState(member.events.map((e) => e.id));
  const effective = (p) => (defaults.has(p) && !revoked.includes(p)) || granted.includes(p);
  const toggle = (p) => {
    if (effective(p)) {
      if (defaults.has(p)) setRevoked([...revoked, p]);
      setGranted(granted.filter((x) => x !== p));
    } else {
      if (!defaults.has(p)) setGranted([...granted, p]);
      setRevoked(revoked.filter((x) => x !== p));
    }
  };
  return (
    <div className="grid gap-6 md:grid-cols-2 p-2">
      {has('staff.roles') && (
        <div>
          <h4 className="font-bold text-sm mb-2">Permissions</h4>
          <div className="space-y-1 max-h-72 overflow-auto">
            {catalog.permissions.map((p) => (
              <label key={p.key} className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={effective(p.key)} disabled={p.reserved && !['OWNER', 'ADMIN'].includes(member.role)} onChange={() => toggle(p.key)} />
                <span><code>{p.key}</code> — {p.description}{defaults.has(p.key) ? '' : ' (custom)'}</span>
              </label>
            ))}
          </div>
          <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm mt-3" onClick={() => run(() => api.patch(`/org/members/${member.id}`, { grantedPermissions: granted, revokedPermissions: revoked }, { params: scope }), 'Permissions saved.')}>Save permissions</button>
        </div>
      )}
      {has('staff.manage') && SCOPED.includes(member.role) && (
        <div>
          <h4 className="font-bold text-sm mb-2">Assigned events</h4>
          <div className="space-y-1 max-h-72 overflow-auto">
            {events.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={eventIds.includes(e.id)} onChange={() => setEventIds(eventIds.includes(e.id) ? eventIds.filter((x) => x !== e.id) : [...eventIds, e.id])} />
                {e.name}
              </label>
            ))}
          </div>
          <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm mt-3" onClick={() => run(() => api.put(`/org/members/${member.id}/events`, { eventIds }, { params: scope }), 'Events saved.')}>Save events</button>
        </div>
      )}
    </div>
  );
}

// ── Invitations ────────────────────────────────────────────────────────────────────────────────────────

function Invitations({ invites, events, has, isOwner, scope, run, dialog, myEventIds }) {
  const [form, setForm] = useState({ email: '', role: 'STAFF', eventIds: [] });
  const [error, setError] = useState('');
  const pickable = myEventIds ? events.filter((e) => myEventIds.includes(e.id)) : events;
  const roles = Object.keys(ROLE_LABELS).filter((r) => isOwner || !OWNER_ONLY.includes(r));

  const submit = async (e) => {
    e.preventDefault();
    const bad = validateEmail(form.email);
    setError(bad || '');
    if (bad) return;
    await run(() => api.post('/org/invitations', { email: form.email.trim().toLowerCase(), role: form.role, eventIds: SCOPED.includes(form.role) ? form.eventIds : [] }, { params: scope }), 'Invitation sent.');
    setForm({ email: '', role: form.role, eventIds: [] });
  };

  return (
    <div className="space-y-6">
      {has('staff.invite') && (
        <DashCard title="Invite someone" sub="New and existing TicketLedger accounts. The link works once and expires in 72 hours." icon={Send}>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="tl-dash-input" type="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" />
              <select className="tl-dash-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm">Send invitation</button>
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            {SCOPED.includes(form.role) && (
              <div>
                <p className="text-xs font-bold mb-1">Events they can work on</p>
                <div className="flex flex-wrap gap-3">
                  {pickable.map((ev) => (
                    <label key={ev.id} className="text-xs flex items-center gap-1">
                      <input type="checkbox" checked={form.eventIds.includes(ev.id)} onChange={() => setForm({ ...form, eventIds: form.eventIds.includes(ev.id) ? form.eventIds.filter((x) => x !== ev.id) : [...form.eventIds, ev.id] })} />
                      {ev.name}
                    </label>
                  ))}
                  {!pickable.length && <span className="text-xs text-slate-500">No events to assign yet.</span>}
                </div>
              </div>
            )}
          </form>
        </DashCard>
      )}
      <DashCard title="Invitations" icon={Mail}>
        {!invites.length ? <DashState icon={Mail} title="No invitations" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th>Invited by</th><th /></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.roleLabel}</td>
                    <td><Status value={i.status} /></td>
                    <td className="text-xs">{fmt(i.expiresAt)}</td>
                    <td className="text-xs">{i.invitedBy?.name}</td>
                    <td>
                      {has('staff.invite') && ['PENDING', 'EXPIRED'].includes(i.status) && (
                        <div className="flex gap-2">
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.post(`/org/invitations/${i.id}/resend`, {}, { params: scope }), 'Invitation resent.')}><RefreshCw className="w-3.5 h-3.5 inline" /> Resend</button>
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={async () => { if (await dialog.confirm({ tone: 'error', title: `Revoke the invitation to ${i.email}?`, message: 'The link stops working at once.', confirmLabel: 'Revoke' })) run(() => api.delete(`/org/invitations/${i.id}`, { params: scope }), 'Invitation revoked.'); }}><XCircle className="w-3.5 h-3.5 inline" /> Revoke</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
    </div>
  );
}

// ── Roles & permissions ────────────────────────────────────────────────────────────────────────────────

function RolesMatrix({ catalog }) {
  return (
    <DashCard title="Roles & permissions" sub="Defaults for each role. Owners and admins can add or remove permissions for one member under Members → Access. Event Managers, Staff and Gate Staff only see their assigned events." icon={ShieldCheck}>
      <div className="tl-dash-table-wrap">
        <table className="tl-dash-table">
          <thead><tr><th>Permission</th>{catalog.roles.map((r) => <th key={r.role}>{r.label}</th>)}</tr></thead>
          <tbody>
            {catalog.permissions.map((p) => (
              <tr key={p.key}>
                <td><code className="text-xs">{p.key}</code><div className="text-xs text-slate-500">{p.description}</div></td>
                {catalog.roles.map((r) => <td key={r.role} className="text-center">{r.permissions.includes(p.key) ? '✓' : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashCard>
  );
}

// ── Activity ───────────────────────────────────────────────────────────────────────────────────────────

function Activity({ members, scope }) {
  const [filters, setFilters] = useState({ memberId: '', action: '', page: 1 });
  const [data, setData] = useState({ items: [], total: 0, limit: 50 });
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/org/activity', { params: { ...scope, ...filters, memberId: filters.memberId || undefined, action: filters.action || undefined } })
      .then((r) => { setData(r.data.data); setError(''); })
      .catch((e) => setError(errText(e)));
  }, [filters, scope.companyId]);

  const exportCsv = async () => {
    const res = await api.get('/org/activity', { params: { ...scope, ...filters, memberId: filters.memberId || undefined, action: filters.action || undefined, format: 'csv', limit: 500 }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organization-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  return (
    <DashCard title="Activity" sub="Invitations, role, permission and status changes, and actions members take on events" icon={History} aside={<button type="button" className="tl-st-btn tl-st-btn--sm" onClick={exportCsv}><Download className="w-3.5 h-3.5 inline" /> CSV</button>}>
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <select className="tl-dash-select" value={filters.memberId} onChange={(e) => setFilters({ ...filters, memberId: e.target.value, page: 1 })} aria-label="Member">
          <option value="">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input className="tl-dash-input" placeholder="Action starts with… (e.g. ORG_, EVENT_)" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })} aria-label="Action" />
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {!data.items.length ? <DashState icon={History} title="No activity" /> : (
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Change</th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="text-xs whitespace-nowrap">{fmt(i.at)}</td>
                  <td className="text-xs">{i.actor?.name || 'System'}{i.actorRole && <div className="text-slate-500">{ROLE_LABELS[i.actorRole] || i.actorRole}</div>}</td>
                  <td className="text-xs"><code>{i.action}</code></td>
                  <td className="text-xs">
                    {i.details?.before || i.details?.after ? (
                      <span><span className="text-slate-500">{JSON.stringify(i.details.before ?? {})}</span> → {JSON.stringify(i.details.after ?? {})}</span>
                    ) : (i.details?.email || i.details?.eventName || '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Previous</button>
          <span>Page {filters.page} of {pages}</span>
          <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={filters.page >= pages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</button>
        </div>
      )}
    </DashCard>
  );
}
