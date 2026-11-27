import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Building2, FileText, Landmark, MapPin, RefreshCw, Upload, Archive, RotateCcw, Eye, EyeOff, Save, Plus, Trash2, Star } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../components/ui/DialogProvider';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';

/*
 * Organization page: public profile, document library, payout & tax details and branches. Tabs follow the
 * viewer's organization permissions; the API checks every rule again. Super Admins pick an organization first
 * (their requests carry ?companyId= and are recorded in its activity history).
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const fmtSize = (b) => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Field({ label, hint, children, wide }) {
  return (
    <label className={`grid gap-1 text-xs${wide ? ' sm:col-span-2' : ''}`}>
      <span className="font-bold">{label}</span>
      {children}
      {hint && <span className="text-slate-500">{hint}</span>}
    </label>
  );
}

export default function OrganizerOrganization() {
  const { user } = useAuth();
  const dialog = useDialog();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === 'SUPER_ADMIN';
  const [companyId, setCompanyId] = useState(params.get('companyId') || '');
  const [companies, setCompanies] = useState([]);
  const scope = useMemo(() => (isAdmin ? { companyId } : {}), [isAdmin, companyId]);
  const ready = !isAdmin || Boolean(companyId);

  const [me, setMe] = useState(null);
  const [notice, setNotice] = useState(null);
  const perms = useMemo(() => new Set(me?.permissions || []), [me]);
  const has = (p) => isAdmin || perms.has(p);

  const tabs = [
    { value: 'profile', label: 'Profile', icon: Building2 },
    has('org.documents') && { value: 'documents', label: 'Documents', icon: FileText },
    has('finance.view') && { value: 'finance', label: 'Payout details', icon: Landmark },
    has('finance.view') && { value: 'payouts', label: 'Payouts', icon: Wallet },
    { value: 'branches', label: 'Branches', icon: MapPin },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'profile';
  const setTab = (value) => setParams((p) => { p.set('tab', value); return p; }, { replace: true });
  const flash = (tone, text) => setNotice({ tone, text });

  useEffect(() => {
    if (!ready) return;
    api.get('/org/me', { params: scope }).then((r) => setMe(r.data.data)).catch((e) => flash('bad', errText(e)));
  }, [ready, scope]);
  useEffect(() => {
    if (isAdmin) api.get('/companies/admin/all').then((r) => setCompanies(r.data.data?.companies || [])).catch(() => {});
  }, [isAdmin]);

  if (isAdmin && !companyId) {
    return (
      <div className="space-y-6">
        <DashHead eyebrow="Organization" title="Organization" intro="Choose an organization. Your access is recorded in its activity history." />
        <DashCard title="Organization">
          <select className="tl-dash-select w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setParams({ companyId: e.target.value }); }}>
            <option value="">Select an organization…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        </DashCard>
      </div>
    );
  }

  const shared = { scope, has, flash, dialog };
  return (
    <div className="space-y-6">
      <DashHead
        eyebrow={me?.organization?.name || 'Organization'}
        title="Organization"
        intro="Your public profile, documents, payout details and operating locations."
        segment={<Segmented label="Organization sections" options={tabs} value={tab} onChange={setTab} />}
      />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {!me ? <DashState icon={RefreshCw} title="Loading…" /> : (
        <>
          {tab === 'profile' && <Profile {...shared} />}
          {tab === 'documents' && <Documents {...shared} />}
          {tab === 'finance' && <Finance {...shared} />}
          {tab === 'payouts' && <Payouts {...shared} />}
          {tab === 'branches' && <Branches {...shared} />}
        </>
      )}
    </div>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────────────────────────────────

const PROFILE_KEYS = ['description', 'website', 'address', 'supportEmail', 'supportPhone', 'phone', 'email', 'city'];

function Profile({ scope, has, flash }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [logo, setLogo] = useState(null);
  const [saving, setSaving] = useState(false);
  const editable = has('org.settings');

  const load = useCallback(() => api.get('/org/profile', { params: scope }).then((r) => {
    setProfile(r.data.data.profile);
    setForm(Object.fromEntries(PROFILE_KEYS.map((k) => [k, r.data.data.profile[k] || ''])));
  }).catch((e) => flash('bad', errText(e))), [scope]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = new FormData();
      for (const k of PROFILE_KEYS) body.append(k, form[k] ?? '');
      if (logo) body.append('logo', logo);
      const res = await api.patch('/org/profile', body, { params: scope });
      setProfile(res.data.data.profile);
      setLogo(null);
      flash('good', res.data.message);
    } catch (err) {
      flash('bad', errText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <DashState icon={RefreshCw} title="Loading profile…" />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <DashCard title="Verified identity" sub={profile.identityLocked ? 'Checked by TicketLedger. Contact support to change it.' : 'Set in your registration.'} icon={Building2}>
        <dl className="grid gap-2 text-sm">
          <div><dt className="text-xs text-slate-500">Legal name</dt><dd className="font-bold">{profile.companyName}</dd></div>
          <div><dt className="text-xs text-slate-500">Owner</dt><dd>{profile.ownerName}</dd></div>
          {profile.ntnCnic && <div><dt className="text-xs text-slate-500">NTN / CNIC</dt><dd>{profile.ntnCnic}</dd></div>}
          <div><dt className="text-xs text-slate-500">Status</dt><dd><Status value={profile.status} /></dd></div>
          <div><dt className="text-xs text-slate-500">Member since</dt><dd>{fmtDate(profile.createdAt)}</dd></div>
        </dl>
      </DashCard>
      <div className="lg:col-span-2">
        <DashCard title="Public profile" sub={editable ? 'Shown to customers on your events.' : 'Only owners and admins can change this.'}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <fieldset disabled={!editable || saving} className="contents">
              <Field label="About the organization" wide>
                <textarea className="tl-dash-input" rows={4} maxLength={2000} value={form.description} onChange={set('description')} />
              </Field>
              <Field label="Website"><input className="tl-dash-input" type="url" placeholder="https://" value={form.website} onChange={set('website')} /></Field>
              <Field label="City"><input className="tl-dash-input" value={form.city} onChange={set('city')} /></Field>
              <Field label="Address" wide><input className="tl-dash-input" value={form.address} onChange={set('address')} /></Field>
              <Field label="Main phone"><input className="tl-dash-input" type="tel" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Main email"><input className="tl-dash-input" type="email" value={form.email} onChange={set('email')} /></Field>
              <Field label="Customer support email" hint="Shown to ticket buyers"><input className="tl-dash-input" type="email" value={form.supportEmail} onChange={set('supportEmail')} /></Field>
              <Field label="Customer support phone"><input className="tl-dash-input" type="tel" value={form.supportPhone} onChange={set('supportPhone')} /></Field>
              <Field label="Logo" hint="PNG, JPG or WebP, up to 2 MB" wide>
                <div className="flex items-center gap-3">
                  {profile.logoUrl && <img src={profile.logoUrl} alt="Current logo" className="w-12 h-12 object-contain rounded border" />}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] || null)} />
                </div>
              </Field>
            </fieldset>
            {editable && (
              <div className="sm:col-span-2">
                <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={saving}><Save className="w-3.5 h-3.5 inline" /> {saving ? 'Saving…' : 'Save profile'}</button>
              </div>
            )}
          </form>
        </DashCard>
      </div>
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────────────

function Documents({ scope, flash, dialog }) {
  const [archived, setArchived] = useState(false);
  const [docs, setDocs] = useState(null);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ type: 'OTHER', title: '', expiresAt: '', files: [] });
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const load = useCallback(() => api.get('/org/documents', { params: { ...scope, archived } }).then((r) => {
    setDocs(r.data.data.documents);
    setTypes(r.data.data.types);
  }).catch((e) => flash('bad', errText(e))), [scope, archived]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    if (!form.files.length) return flash('bad', 'Choose at least one file.');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('type', form.type);
      if (form.title) body.append('title', form.title);
      if (form.expiresAt) body.append('expiresAt', form.expiresAt);
      for (const f of form.files) body.append('documents', f);
      const res = await api.post('/org/documents', body, { params: scope });
      flash('good', res.data.message);
      setForm({ type: form.type, title: '', expiresAt: '', files: [] });
      setInputKey((k) => k + 1);
      setArchived(false);
      load();
    } catch (err) {
      flash('bad', errText(err));
    } finally {
      setBusy(false);
    }
  };
  const act = async (d, action) => {
    if (action === 'archive' && !(await dialog.confirm({ title: `Archive “${d.title}”?`, message: 'It is hidden from the list but kept, and you can restore it any time.', confirmLabel: 'Archive' }))) return;
    try {
      const res = await api.post(`/org/documents/${d.id}/${action}`, {}, { params: scope });
      flash('good', res.data.message);
      load();
    } catch (err) {
      flash('bad', errText(err));
    }
  };

  return (
    <div className="space-y-6">
      <DashCard title="Upload documents" sub="PDF, PNG, JPG or WebP, up to 10 MB each, 5 at a time." icon={Upload}>
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-4 items-end">
          <Field label="Type">
            <select className="tl-dash-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Title (optional)"><input className="tl-dash-input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Expires (optional)" hint="We flag it 30 days before"><input className="tl-dash-input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
          <Field label="Files"><input key={inputKey} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setForm({ ...form, files: [...(e.target.files || [])] })} /></Field>
          <div className="sm:col-span-4"><button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={busy}><Upload className="w-3.5 h-3.5 inline" /> {busy ? 'Uploading…' : 'Upload'}</button></div>
        </form>
      </DashCard>
      <DashCard
        title={archived ? 'Archived documents' : 'Documents'}
        icon={FileText}
        aside={<button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setArchived(!archived)}>{archived ? 'Show current' : 'Show archived'}</button>}
      >
        {!docs ? <DashState icon={RefreshCw} title="Loading…" /> : !docs.length ? <DashState icon={FileText} title={archived ? 'Nothing archived' : 'No documents yet'} /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Document</th><th>Type</th><th>Expires</th><th>Uploaded</th><th /></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><a href={d.url} target="_blank" rel="noreferrer" className="font-bold underline">{d.title}</a><div className="text-xs text-slate-500">{fmtSize(d.sizeBytes)}</div></td>
                    <td className="text-xs">{d.typeLabel}</td>
                    <td className="text-xs">{d.expiresAt ? <>{fmtDate(d.expiresAt)} {d.expired ? <Status value="EXPIRED" /> : d.expiresSoon ? <Status value="PENDING" label="Expires soon" /> : null}</> : '—'}</td>
                    <td className="text-xs">{fmtDate(d.createdAt)}{d.uploadedBy?.name && <div className="text-slate-500">{d.uploadedBy.name}</div>}</td>
                    <td>
                      {archived
                        ? <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(d, 'restore')}><RotateCcw className="w-3.5 h-3.5 inline" /> Restore</button>
                        : <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(d, 'archive')}><Archive className="w-3.5 h-3.5 inline" /> Archive</button>}
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

// ── Payouts & tax ──────────────────────────────────────────────────────────────────────────────────────

const METHOD_LABELS = { BANK_TRANSFER: 'Bank transfer', JAZZCASH: 'JazzCash wallet', EASYPAISA: 'EasyPaisa wallet' };
const SCHEDULE_LABELS = { AFTER_EVENT: 'After each event', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
const STATUS_TEXT = {
  UNVERIFIED: 'Not set up yet. Add your payout details to receive event revenue.',
  PENDING: 'Waiting for TicketLedger to check these details. Payouts are held until they are verified.',
  VERIFIED: 'Verified by TicketLedger. Payouts go to this account.',
  REJECTED: 'TicketLedger could not verify these details. Correct them and save again.',
};

function Finance({ scope, has, flash }) {
  const [finance, setFinance] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const editable = has('finance.manage');

  const load = useCallback(() => api.get('/org/finance', { params: scope }).then((r) => {
    const f = r.data.data.finance;
    setFinance(f);
    setRevealed(null);
    setForm({
      payoutMethod: f.payoutMethod || 'BANK_TRANSFER',
      payoutSchedule: f.payoutSchedule || 'AFTER_EVENT',
      accountTitle: f.accountTitle || '',
      bankName: f.bankName || '',
      bankBranchCode: f.bankBranchCode || '',
      iban: '',
      walletNumber: '',
      taxNtn: f.taxNtn || '',
      salesTaxNumber: f.salesTaxNumber || '',
      taxFiler: Boolean(f.taxFiler),
      billingEmail: f.billingEmail || '',
      billingAddress: f.billingAddress || '',
      password: '',
    });
  }).catch((e) => flash('bad', errText(e))), [scope]);
  useEffect(() => { load(); }, [load]);

  const reveal = async () => {
    if (revealed) return setRevealed(null);
    try {
      const r = await api.get('/org/finance', { params: { ...scope, reveal: true } });
      setRevealed(r.data.data.finance);
    } catch (err) {
      flash('bad', errText(err));
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form };
      // Account numbers are only sent when a new one was typed (the stored ones are never sent back)
      if (!body.iban) delete body.iban;
      if (!body.walletNumber) delete body.walletNumber;
      const res = await api.put('/org/finance', body, { params: scope });
      flash('good', res.data.message);
      load();
    } catch (err) {
      flash('bad', errText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!finance || !form) return <DashState icon={RefreshCw} title="Loading payout details…" />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const bank = form.payoutMethod === 'BANK_TRANSFER';
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <DashCard title="Status" icon={Landmark}>
        <p className="mb-2"><Status value={finance.status} /></p>
        <p className="text-sm">{STATUS_TEXT[finance.status]}</p>
        {finance.reviewNote && <p className="text-xs mt-2"><b>TicketLedger:</b> {finance.reviewNote}</p>}
        {finance.configured && (
          <dl className="grid gap-2 text-sm mt-4">
            <div><dt className="text-xs text-slate-500">Payout method</dt><dd>{METHOD_LABELS[finance.payoutMethod]} · {SCHEDULE_LABELS[finance.payoutSchedule]}</dd></div>
            <div><dt className="text-xs text-slate-500">Account title</dt><dd>{finance.accountTitle}</dd></div>
            {finance.bankName && <div><dt className="text-xs text-slate-500">Bank</dt><dd>{finance.bankName}{finance.bankBranchCode ? ` (branch ${finance.bankBranchCode})` : ''}</dd></div>}
            {finance.iban && <div><dt className="text-xs text-slate-500">IBAN</dt><dd className="font-mono">{revealed?.iban || finance.iban}</dd></div>}
            {finance.walletNumber && <div><dt className="text-xs text-slate-500">Wallet</dt><dd className="font-mono">{revealed?.walletNumber || finance.walletNumber}</dd></div>}
            <div><dt className="text-xs text-slate-500">Last changed</dt><dd>{fmtDate(finance.updatedAt)}</dd></div>
          </dl>
        )}
        {finance.configured && editable && (
          <button type="button" className="tl-st-btn tl-st-btn--sm mt-3" onClick={reveal}>{revealed ? <><EyeOff className="w-3.5 h-3.5 inline" /> Hide numbers</> : <><Eye className="w-3.5 h-3.5 inline" /> Show full numbers</>}</button>
        )}
        {finance.configured && editable && <p className="text-xs text-slate-500 mt-2">Showing full numbers is recorded in the activity history.</p>}
      </DashCard>
      <div className="lg:col-span-2">
        <DashCard title="Payout & tax details" sub={editable ? 'Changing where payouts go sends the details back to TicketLedger for checking, and the owners are told.' : 'Only owners, admins and finance managers can change these.'}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <fieldset disabled={!editable || saving} className="contents">
              <Field label="Payout method">
                <select className="tl-dash-select" value={form.payoutMethod} onChange={set('payoutMethod')}>
                  {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Payout schedule">
                <select className="tl-dash-select" value={form.payoutSchedule} onChange={set('payoutSchedule')}>
                  {Object.entries(SCHEDULE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Account title" hint="The name the account is registered to" wide><input className="tl-dash-input" value={form.accountTitle} onChange={set('accountTitle')} /></Field>
              {bank ? (
                <>
                  <Field label="Bank name"><input className="tl-dash-input" value={form.bankName} onChange={set('bankName')} /></Field>
                  <Field label="Branch code (optional)"><input className="tl-dash-input" value={form.bankBranchCode} onChange={set('bankBranchCode')} /></Field>
                  <Field label="IBAN" hint={finance.iban ? `Saved: ${finance.iban}. Leave empty to keep it.` : '24 characters, starting with PK'} wide>
                    <input className="tl-dash-input font-mono" autoComplete="off" placeholder="PK36 SCBL 0000 0011 2345 6702" value={form.iban} onChange={set('iban')} />
                  </Field>
                </>
              ) : (
                <Field label="Wallet number" hint={finance.walletNumber ? `Saved: ${finance.walletNumber}. Leave empty to keep it.` : '03XXXXXXXXX'} wide>
                  <input className="tl-dash-input font-mono" autoComplete="off" inputMode="tel" placeholder="03001234567" value={form.walletNumber} onChange={set('walletNumber')} />
                </Field>
              )}
              <Field label="NTN"><input className="tl-dash-input" value={form.taxNtn} onChange={set('taxNtn')} /></Field>
              <Field label="Sales tax number (STRN)"><input className="tl-dash-input" value={form.salesTaxNumber} onChange={set('salesTaxNumber')} /></Field>
              <label className="text-xs flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={form.taxFiler} onChange={set('taxFiler')} /> On FBR's Active Taxpayer List (filer)</label>
              <Field label="Billing email"><input className="tl-dash-input" type="email" value={form.billingEmail} onChange={set('billingEmail')} /></Field>
              <Field label="Billing address"><input className="tl-dash-input" value={form.billingAddress} onChange={set('billingAddress')} /></Field>
              {editable && (
                <Field label="Your password" hint="Needed to save payout details" wide>
                  <input className="tl-dash-input" type="password" autoComplete="current-password" required value={form.password} onChange={set('password')} />
                </Field>
              )}
            </fieldset>
            {editable && (
              <div className="sm:col-span-2">
                <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={saving}><Save className="w-3.5 h-3.5 inline" /> {saving ? 'Saving…' : 'Save payout details'}</button>
              </div>
            )}
          </form>
        </DashCard>
      </div>
    </div>
  );
}

// ── Branches ───────────────────────────────────────────────────────────────────────────────────────────

const EMPTY_BRANCH = { name: '', city: '', address: '', phone: '', email: '', managerUserId: '', isHeadOffice: false };

function Branches({ scope, has, flash, dialog }) {
  const [branches, setBranches] = useState(null);
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(EMPTY_BRANCH);
  const [editing, setEditing] = useState(null); // branch id, or 'new'
  const editable = has('org.settings');
  const canAssign = has('event.edit');

  const load = useCallback(async () => {
    try {
      const [b, m, e] = await Promise.all([
        api.get('/org/branches', { params: scope }),
        has('staff.view') ? api.get('/org/members', { params: { ...scope, status: 'ACTIVE' } }).catch(() => null) : null,
        api.get('/events/organizer/my-events', { params: scope }).catch(() => null),
      ]);
      setBranches(b.data.data.branches);
      setMembers(m?.data.data.members || []);
      setEvents(e?.data.data.events || []);
    } catch (err) {
      flash('bad', errText(err));
    }
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    try {
      const res = await fn();
      flash('good', res.data.message);
      await load();
      return true;
    } catch (err) {
      flash('bad', errText(err));
      return false;
    }
  };
  const startEdit = (b) => {
    setEditing(b ? b.id : 'new');
    setForm(b ? { name: b.name, city: b.city, address: b.address || '', phone: b.phone || '', email: b.email || '', managerUserId: b.managerUserId || '', isHeadOffice: b.isHeadOffice } : EMPTY_BRANCH);
  };
  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, managerUserId: form.managerUserId || null };
    const ok = await run(() => (editing === 'new' ? api.post('/org/branches', body, { params: scope }) : api.patch(`/org/branches/${editing}`, body, { params: scope })));
    if (ok) setEditing(null);
  };
  const remove = async (b) => {
    if (!(await dialog.confirm({ tone: 'error', title: `Delete ${b.name}?`, message: 'Only a branch with no events can be deleted. Deactivate it instead to keep its history.', confirmLabel: 'Delete' }))) return;
    run(() => api.delete(`/org/branches/${b.id}`, { params: scope }));
  };
  const assign = (eventId, branchId) => run(() => api.put(`/org/events/${eventId}/branch`, { branchId: branchId || null }, { params: scope }));

  if (!branches) return <DashState icon={RefreshCw} title="Loading branches…" />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const branchOf = Object.fromEntries(branches.flatMap((b) => (b.events || []).map((ev) => [ev.id, b.id])));
  const active = branches.filter((b) => b.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      <DashCard
        title="Branches & locations"
        sub="Offices and operating locations. Each event can be run by one branch."
        icon={MapPin}
        aside={editable && editing !== 'new' && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => startEdit(null)}><Plus className="w-3.5 h-3.5 inline" /> Add branch</button>}
      >
        {editing && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 mb-6 p-3 border rounded">
            <Field label="Name"><input className="tl-dash-input" required value={form.name} onChange={set('name')} /></Field>
            <Field label="City"><input className="tl-dash-input" required value={form.city} onChange={set('city')} /></Field>
            <Field label="Manager">
              <select className="tl-dash-select" value={form.managerUserId} onChange={set('managerUserId')}>
                <option value="">No manager</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name} ({m.roleLabel})</option>)}
              </select>
            </Field>
            <Field label="Address" wide><input className="tl-dash-input" value={form.address} onChange={set('address')} /></Field>
            <Field label="Phone"><input className="tl-dash-input" type="tel" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="Email"><input className="tl-dash-input" type="email" value={form.email} onChange={set('email')} /></Field>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={form.isHeadOffice} onChange={set('isHeadOffice')} /> Head office</label>
            <div className="flex gap-2 items-end">
              <button type="submit" className="tl-st-btn tl-st-btn--green tl-st-btn--sm"><Save className="w-3.5 h-3.5 inline" /> Save</button>
              <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        {!branches.length ? <DashState icon={MapPin} title="No branches yet" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Branch</th><th>Contact</th><th>Manager</th><th>Events</th><th>Status</th>{editable && <th />}</tr></thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.name}</strong> {b.isHeadOffice && <span className="text-xs"><Star className="w-3 h-3 inline" /> Head office</span>}<div className="text-xs text-slate-500">{[b.address, b.city].filter(Boolean).join(', ')}</div></td>
                    <td className="text-xs">{b.phone}{b.email && <div>{b.email}</div>}</td>
                    <td className="text-xs">{b.manager?.name || '—'}</td>
                    <td className="text-xs">{b.eventCount ? b.events.map((e) => e.name).join(', ') : 'None'}</td>
                    <td><Status value={b.status} /></td>
                    {editable && (
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => startEdit(b)}>Edit</button>
                          {!b.isHeadOffice && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => run(() => api.patch(`/org/branches/${b.id}`, { status: b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }, { params: scope }))}>{b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>}
                          {!b.isHeadOffice && !b.eventCount && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => remove(b)}><Trash2 className="w-3.5 h-3.5 inline" /></button>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>

      {canAssign && events.length > 0 && (
        <DashCard title="Which branch runs each event" icon={Building2}>
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Event</th><th>Date</th><th>Branch</th></tr></thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.name}</td>
                    <td className="text-xs">{fmtDate(ev.date)}</td>
                    <td>
                      <select className="tl-dash-select" value={branchOf[ev.id] || ''} onChange={(e) => assign(ev.id, e.target.value)} aria-label={`Branch for ${ev.name}`}>
                        <option value="">No branch</option>
                        {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        {branchOf[ev.id] && !active.some((b) => b.id === branchOf[ev.id]) && <option value={branchOf[ev.id]}>{branches.find((b) => b.id === branchOf[ev.id])?.name} (inactive)</option>}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}
    </div>
  );
}


// ── Payouts ────────────────────────────────────────────────────────────────────────────────────────────

const PAYOUT_STATUS = { SCHEDULED: ['PENDING', 'Scheduled'], ON_HOLD: ['SUSPENDED', 'On hold'], PROCESSING: ['PENDING', 'Being paid'], PAID: ['APPROVED', 'Paid'], FAILED: ['FAILED', 'Failed'], CANCELLED: ['INACTIVE', 'Cancelled'] };
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function Payouts({ scope, flash }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/org/payouts', { params: scope }).then((r) => setData(r.data.data)).catch((e) => flash('bad', errText(e))); }, [scope]);
  if (!data) return <DashState icon={RefreshCw} title="Loading payouts…" />;
  const pct = Math.round(data.platformFeeRate * 100);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[['Paid out', data.totals.paid], ['On the way', data.totals.onTheWay], ['On hold', data.totals.onHold]].map(([l, v]) => <DashCard key={l} title={l}><p className="text-2xl font-extrabold">{pkr(v)}</p></DashCard>)}
      </div>
      {data.financeStatus !== 'VERIFIED' && <Notice tone="bad">Payouts are held until TicketLedger verifies your payout details (Payout details tab).</Notice>}
      <DashCard title="Payouts" sub={`One per event after it ends: ticket sales after discounts + service fees + tax collected − refunds − the ${pct}% platform fee.`} icon={Wallet}>
        {!data.payouts.length ? <DashState icon={Wallet} title="No payouts yet">They appear after your events end.</DashState> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Event</th><th>Sales</th><th>Fees & tax</th><th>Refunds</th><th>Platform fee</th><th>Payout</th><th>Status</th></tr></thead>
              <tbody>
                {data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.event?.name}</strong><div className="text-xs text-slate-500">{p.status === 'PAID' ? `Paid ${fmtDate(p.paidAt)}` : `Due ${fmtDate(p.scheduledFor)}`}</div></td>
                    <td>{pkr(p.grossSales)}</td>
                    <td className="text-xs">{pkr(p.serviceFees)} + {pkr(p.taxCollected)}</td>
                    <td>−{pkr(p.refunds)}</td>
                    <td>−{pkr(p.platformFee)}</td>
                    <td><strong>{pkr(p.netAmount)}</strong>{p.destination && <div className="text-xs text-slate-500">to {p.destination}</div>}</td>
                    <td><Status value={PAYOUT_STATUS[p.status][0]} label={PAYOUT_STATUS[p.status][1]} />{p.reference && <div className="text-xs">Ref {p.reference}</div>}{(p.holdReason || p.failureReason) && <div className="text-xs text-rose-700">{p.holdReason || p.failureReason}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
      {data.upcoming.length > 0 && (
        <DashCard title="Coming up" sub="Events that haven't ended yet: what they have earned so far.">
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Event</th><th>So far</th><th>Expected payout date</th></tr></thead>
              <tbody>
                {data.upcoming.map((u) => <tr key={u.event.id}><td>{u.event.name}</td><td>{pkr(u.estimate.netAmount)}</td><td className="text-xs">{fmtDate(u.expectedOn)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}
    </div>
  );
}
