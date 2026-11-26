import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { confirmedFetch } from '../lib/typedConfirm';
import { useAuth } from '../context/AuthContext';
import {
  AlertCircle,
  BadgeCheck,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Info,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react';
import api from '../utils/api';
import { Notice, notifyPendingChanged } from '../components/dash/DashShell';
import { PageHero, AovFooter } from './AdminOverview';
import { getEventVisual, resolveMediaUrl } from '../utils/eventMedia';
import { categoryName } from '../components/home/homeData';
import { useDialog } from '../components/ui/DialogProvider';
import PayoutReviews from '../components/PayoutReviews';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PAGE_SIZE = 8;

const initials = (name = '') => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const docUrl = (url) => (url.startsWith('http') ? url : `${API_URL}${url}`);

/** Page numbers with gaps: 1 2 3 … 9 */
function pageList(page, pages) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (page <= 3) [2, 3].forEach((p) => p <= pages && set.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2].forEach((p) => p >= 1 && set.add(p));
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? ['gap', p] : [p]));
}

// Which kind of event request (same rule as the event review screen)
const kindOf = (event) => {
  if (!event.prebookDraftId) return 'NEW';
  return event.stage === 'LAUNCH' || ['PENDING', 'APPROVED', 'CHANGES_REQUESTED'].includes(event.launchStatus) ? 'FINAL' : 'RESERVATION';
};
const KIND_TAG = { NEW: 'New event', RESERVATION: 'Reservation', FINAL: 'Final approval' };

// Status pill per request status
const STATUS = {
  PENDING: ['warn', Clock, 'Pending'],
  WAITING: ['warn', Clock, 'Waiting for organizer'],
  APPROVED: ['good', Check, 'Approved'],
  REJECTED: ['bad', X, 'Rejected'],
  SUSPENDED: ['neutral', Ban, 'Suspended'],
};
const STATUS_FILTERS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'WAITING', label: 'Waiting for organizer' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUSPENDED', label: 'Suspended' },
];
const GROUPS = [
  { value: 'ALL', label: 'All requests' },
  { value: 'EVENT', label: 'Events' },
  { value: 'ORG', label: 'Organizers' },
  { value: 'OTHER', label: 'Others' },
];

/** Event, organizer, promotion and date-change requests as rows of one list. */
function toRequests({ companies, events, promotions, changes }) {
  const rows = [];
  companies.forEach((c) => rows.push({
    key: `org-${c.id}`,
    group: 'ORG',
    title: c.companyName,
    sub: c.city,
    tag: 'Organizer',
    logo: resolveMediaUrl(c.logoUrl),
    by: { name: c.ownerName, email: c.email },
    at: c.createdAt,
    status: c.status,
    note: c.status === 'REJECTED' ? c.rejectionReason : null,
    company: c,
  }));
  events.forEach((e) => {
    const waiting = e.reviewRequest === 'CHANGES_REQUESTED' || e.launchStatus === 'CHANGES_REQUESTED';
    const status = e.stage ? (waiting ? 'WAITING' : 'PENDING') : e.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    rows.push({
      key: `ev-${e.id}`,
      group: 'EVENT',
      title: e.name,
      sub: categoryName(e.type, e.categoryLabel),
      tag: KIND_TAG[kindOf(e)],
      image: getEventVisual(e).image,
      by: { name: e.company?.companyName || 'Organizer', email: e.company?.email },
      at: e.submittedAt || e.reviewedAt || e.createdAt,
      status,
      event: e,
    });
  });
  promotions.forEach((e) => rows.push({
    key: `promo-${e.id}`,
    group: 'OTHER',
    title: e.name,
    sub: [e.priorityStatus === 'REQUESTED' && 'Priority listing', e.heroStatus === 'REQUESTED' && 'Homepage hero'].filter(Boolean).join(' · ') || 'Promotion',
    tag: 'Promotion',
    image: getEventVisual(e).image,
    by: { name: e.company?.companyName || 'Organizer', email: e.company?.email },
    at: e.heroRequestedAt || e.priorityRequestedAt || e.updatedAt,
    status: 'PENDING',
    reviewTo: '/admin/event-approvals?tab=promotions',
  }));
  changes.forEach((ch) => rows.push({
    key: `chg-${ch.id}`,
    group: 'OTHER',
    title: ch.event?.name || 'Event',
    sub: 'New date requested',
    tag: 'Date change',
    image: getEventVisual(ch.event || {}).image,
    by: { name: ch.event?.company?.companyName || 'Organizer', email: ch.event?.company?.email },
    at: ch.createdAt,
    status: 'PENDING',
    reviewTo: '/admin/event-approvals?tab=changes',
  }));
  // Waiting for a decision first, then the newest
  const rank = (s) => (s === 'PENDING' ? 0 : s === 'WAITING' ? 1 : 2);
  return rows.sort((a, b) => rank(a.status) - rank(b.status) || new Date(b.at) - new Date(a.at));
}

/** Status filter behind the "Filter" button. */
function StatusMenu({ value, onChange, counts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const active = value !== 'ALL';
  return (
    <div ref={ref} className="tl-apv-menu">
      <button type="button" className={`tl-apv-filterbtn${active ? ' is-on' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <Filter className="w-4 h-4" aria-hidden="true" /> {active ? STATUS_FILTERS.find((f) => f.value === value)?.label : 'Filter'}
      </button>
      {open && (
        <ul className="tl-apv-menu-list" role="menu">
          {STATUS_FILTERS.map((f) => (
            <li key={f.value}>
              <button type="button" role="menuitemradio" aria-checked={value === f.value} onClick={() => { onChange(f.value); setOpen(false); }}>
                <span>{f.label}</span>
                {f.value !== 'ALL' && <em>{counts[f.value] || 0}</em>}
                {value === f.value && <Check className="w-4 h-4" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Approvals: one list of what waits for a Super Admin decision: organizer registrations, submitted events,
 * and other event requests (promotions, date changes). Organizers are decided here; events and other
 * requests open their full review screen.
 */
export default function AdminCompanies() {
  const dialog = useDialog();
  const { token } = useAuth();

  const [data, setData] = useState({ companies: [], events: [], promotions: [], changes: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [group, setGroup] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState(null); // organizer shown in the review dialog
  const [rejectModal, setRejectModal] = useState({ open: false, kind: 'org', id: null, name: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const safe = (p) => p.catch(() => null);
    try {
      const [orgRes, ...rest] = await Promise.all([
        safe(fetch(`${API_URL}/api/companies/admin/all`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())),
        ...['PENDING_APPROVAL', 'WAITING_ORGANIZER', 'PUBLISHED', 'REJECTED'].map((s) => safe(api.get(`/admin/event-reviews?status=${s}`))),
        safe(api.get('/admin/promotions?status=REQUESTED')),
        safe(api.get('/admin/schedule-changes?status=PENDING')),
      ]);
      const [p1, p2, p3, p4, promo, chg] = rest;
      setData({
        companies: orgRes?.data?.companies || [],
        events: [p1, p2, p3, p4].flatMap((r) => r?.data?.data?.events || []),
        promotions: promo?.data?.data?.events || [],
        changes: chg?.data?.data?.changes || [],
      });
      notifyPendingChanged(); // the nav badges follow this page's numbers
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // ----- Organizer decisions -----
  const setCompanyStatus = async (company, body, okText) => {
    setBusy(company.id);
    setMessage({ text: '', type: '' });
    try {
      const send = body.status === 'REJECTED' ? fetch : confirmedFetch;
      const res = await send(`${API_URL}/api/companies/admin/${company.id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || okText);
      setMessage({ text: json.message, type: 'success' });
      setDetails(null);
      await load();
      return true;
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const approveCompany = async (c) => {
    if (!(await dialog.confirm({ title: `Approve ${c.companyName}?`, message: 'They will be able to create events and send them for approval.', confirmLabel: 'Approve', tone: 'success' }))) return;
    setCompanyStatus(c, { status: 'APPROVED' }, 'Approval failed');
  };
  const suspendCompany = async (c) => {
    if (!(await dialog.confirm({ title: `Suspend ${c.companyName}?`, message: 'The organizer loses access to the studio until the company is reinstated.', confirmLabel: 'Suspend', tone: 'error' }))) return;
    setCompanyStatus(c, { status: 'SUSPENDED' }, 'Suspension failed');
  };

  // ----- Rejections (organizers and events) -----
  const submitRejection = async (e) => {
    e.preventDefault();
    const reason = rejectModal.reason.trim();
    if (!reason) return;
    if (rejectModal.kind === 'org') {
      const ok = await setCompanyStatus({ id: rejectModal.id }, { status: 'REJECTED', rejectionReason: reason }, 'Rejection failed');
      if (ok) setRejectModal({ open: false, kind: 'org', id: null, name: '', reason: '' });
      return;
    }
    if (reason.length < 5) return;
    setBusy(rejectModal.id);
    try {
      const res = await api.post(`/admin/event-reviews/${rejectModal.id}`, { decision: 'REJECT', comment: reason, suggested: null });
      setMessage({ text: `${res.data.message} The organizer has been emailed.`, type: 'success' });
      setRejectModal({ open: false, kind: 'org', id: null, name: '', reason: '' });
      await load();
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Could not reject the event.', type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // ----- List, counts, filters, pages -----
  const all = useMemo(() => toRequests(data), [data]);
  const groupCounts = useMemo(() => ({
    ALL: all.length,
    EVENT: all.filter((r) => r.group === 'EVENT').length,
    ORG: all.filter((r) => r.group === 'ORG').length,
    OTHER: all.filter((r) => r.group === 'OTHER').length,
  }), [all]);
  const inGroup = useMemo(() => (group === 'ALL' ? all : all.filter((r) => r.group === group)), [all, group]);
  const statusCounts = useMemo(() => inGroup.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}), [inGroup]);
  const summary = useMemo(() => all.reduce((acc, r) => {
    if (r.status === 'PENDING' || r.status === 'WAITING') acc.pending += 1;
    else if (r.status === 'APPROVED') acc.approved += 1;
    else acc.rejected += 1;
    return acc;
  }, { pending: 0, approved: 0, rejected: 0 }), [all]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inGroup.filter((r) => (status === 'ALL' || r.status === status)
      && (!q || [r.title, r.sub, r.tag, r.by.name, r.by.email, r.company?.ntnCnic].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [inGroup, status, query]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [group, status, query]);

  const when = (d) => {
    const x = new Date(d);
    return [x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })];
  };

  // Buttons per row: pending → Review + Reject, everything else → View
  const actionsFor = (r) => {
    const pending = r.status === 'PENDING';
    if (r.company) {
      const c = r.company;
      return pending ? (
        <>
          <button type="button" className="tl-apv-btn is-primary" onClick={() => setDetails(c)} disabled={busy === c.id}>Review</button>
          <button type="button" className="tl-apv-btn" onClick={() => setRejectModal({ open: true, kind: 'org', id: c.id, name: c.companyName, reason: '' })} disabled={busy === c.id}>Reject</button>
        </>
      ) : (
        <button type="button" className="tl-apv-btn is-view" onClick={() => setDetails(c)}><Eye className="w-4 h-4" aria-hidden="true" /> View</button>
      );
    }
    if (r.event) {
      const e = r.event;
      if (pending) {
        return (
          <>
            <Link to="/admin/event-approvals" className="tl-apv-btn is-primary">Review</Link>
            {e.stage !== 'LAUNCH' && (
              <button type="button" className="tl-apv-btn" onClick={() => setRejectModal({ open: true, kind: 'event', id: e.id, name: e.name, reason: '' })} disabled={busy === e.id}>Reject</button>
            )}
          </>
        );
      }
      return (
        <Link to={r.status === 'APPROVED' ? `/events/${e.id}` : '/admin/event-approvals'} className="tl-apv-btn is-view"><Eye className="w-4 h-4" aria-hidden="true" /> View</Link>
      );
    }
    return <Link to={r.reviewTo} className="tl-apv-btn is-primary">Review</Link>;
  };

  return (
    <div className="tl-aov tl-aov-sec tl-apv">
      <PageHero
        icon={BadgeCheck}
        title="Approvals"
        intro="Review and manage pending requests from organizers."
        aside={(
        <div className="tl-apv-summary" role="group" aria-label="Approval summary">
          <div><Clock className="is-warn" aria-hidden="true" /><strong>{summary.pending}</strong><span>Pending</span></div>
          <div><CheckCircle2 className="is-good" aria-hidden="true" /><strong>{summary.approved}</strong><span>Approved</span></div>
          <div><XCircle className="is-bad" aria-hidden="true" /><strong>{summary.rejected}</strong><span>Rejected</span></div>
          <button type="button" className="tl-aov-iconbtn" onClick={load} aria-label="Refresh list" title="Refresh list">
            <RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} />
          </button>
        </div>
        )}
      />

      {message.text && (
        <Notice tone={message.type === 'success' ? 'good' : 'bad'} icon={message.type === 'success' ? CheckCircle2 : AlertCircle} onDismiss={() => setMessage({ text: '', type: '' })}>{message.text}</Notice>
      )}

      {/* New or changed payout accounts waiting for a check */}
      <PayoutReviews />

      <div className="tl-apv-bar">
        <div className="tl-apv-filters" role="group" aria-label="Request type">
          {GROUPS.map((t) => (
            <button key={t.value} type="button" className={`tl-apv-filter${group === t.value ? ' is-active' : ''}`} aria-pressed={group === t.value} onClick={() => setGroup(t.value)}>
              {t.label} <span>{groupCounts[t.value]}</span>
            </button>
          ))}
        </div>
        <div className="tl-apv-tools">
          <label className="tl-apv-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Search requests</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search requests…" />
          </label>
          <StatusMenu value={status} onChange={setStatus} counts={statusCounts} />
        </div>
      </div>

      <section className="tl-apv-table" aria-label="Requests">
        <div className="tl-apv-row tl-apv-row--head" aria-hidden="true">
          <span>Request details</span>
          <span>Submitted by</span>
          <span>Submitted on</span>
          <span>Status</span>
          <span className="is-right">Actions</span>
        </div>

        {loading && all.length === 0 ? (
          <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading requests…</p></div>
        ) : rows.length === 0 ? (
          <div className="tl-dash-state"><Info className="w-7 h-7" /><p>{query || status !== 'ALL' ? 'No requests match these filters.' : 'Nothing in this list.'}</p></div>
        ) : rows.map((r) => {
          const [tone, StatusIcon, label] = STATUS[r.status] || ['neutral', Info, r.status];
          const [day, time] = when(r.at);
          return (
            <article key={r.key} className="tl-apv-row">
              <div className="tl-apv-co">
                <span className="tl-apv-logo" aria-hidden="true">
                  {r.image || r.logo ? <img src={r.image || r.logo} alt="" onError={(e) => e.currentTarget.remove()} /> : null}
                  <span>{initials(r.title)}</span>
                </span>
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.sub}</p>
                  <span className="tl-apv-tag">{r.tag}</span>
                </div>
              </div>

              <div className="tl-apv-who">
                <span className="tl-av" aria-hidden="true">{initials(r.by.name).slice(0, 1)}</span>
                <div>
                  <strong>{r.by.name}</strong>
                  {r.by.email && <span>{r.by.email}</span>}
                </div>
              </div>

              <div className="tl-apv-when">
                <CalendarDays className="w-5 h-5" aria-hidden="true" />
                <div><strong>{day}</strong><span>{time}</span></div>
              </div>

              <div className="tl-apv-state">
                <span className="tl-apv-status" data-tone={tone}><span className="tl-apv-status-dot" aria-hidden="true"><StatusIcon strokeWidth={3} /></span>{label}</span>
                {r.note && <small title={r.note}>{r.note}</small>}
              </div>

              <div className="tl-apv-actions">{actionsFor(r)}</div>
            </article>
          );
        })}
      </section>

      {shown.length > 0 && (
        <nav className="tl-apv-pager" aria-label="Pages">
          <p>Showing <strong>{(current - 1) * PAGE_SIZE + 1} – {Math.min(shown.length, current * PAGE_SIZE)}</strong> of <strong>{shown.length}</strong> requests</p>
          <div>
            <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
            {pageList(current, pages).map((p, i) => (p === 'gap'
              ? <span key={`g${i}`} aria-hidden="true">…</span>
              : <button key={p} type="button" className={p === current ? 'is-active' : undefined} aria-current={p === current ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>))}
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </nav>
      )}


      {/* Organizer review: registration details, documents and the decision */}
      {details && (
        <div className="tl-dash-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setDetails(null)}>
          <div className="tl-dash-dialog tl-apv-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-apv-details-title">
            <button type="button" className="tl-apv-dialog-close" onClick={() => setDetails(null)} aria-label="Close"><X className="w-4 h-4" /></button>
            <div className="tl-apv-dialog-head">
              <span className="tl-apv-logo" aria-hidden="true">
                {resolveMediaUrl(details.logoUrl) ? <img src={resolveMediaUrl(details.logoUrl)} alt="" onError={(e) => e.currentTarget.remove()} /> : null}
                <span>{initials(details.companyName)}</span>
              </span>
              <div>
                <h3 id="tl-apv-details-title">{details.companyName}</h3>
                {(() => { const [t, I, l] = STATUS[details.status] || ['neutral', Info, details.status]; return <span className="tl-apv-status" data-tone={t}><span className="tl-apv-status-dot" aria-hidden="true"><I strokeWidth={3} /></span>{l}</span>; })()}
              </div>
            </div>
            <dl className="tl-apv-facts">
              <div><dt><User className="w-4 h-4" aria-hidden="true" /> Owner</dt><dd>{details.ownerName}</dd></div>
              <div><dt><Mail className="w-4 h-4" aria-hidden="true" /> Email</dt><dd>{details.email}</dd></div>
              <div><dt><Phone className="w-4 h-4" aria-hidden="true" /> Phone</dt><dd>{details.phone}</dd></div>
              <div><dt><MapPin className="w-4 h-4" aria-hidden="true" /> City</dt><dd>{details.city}</dd></div>
              <div><dt><FileText className="w-4 h-4" aria-hidden="true" /> NTN / CNIC</dt><dd className="is-mono">{details.ntnCnic}</dd></div>
              <div><dt><CalendarDays className="w-4 h-4" aria-hidden="true" /> Registered</dt><dd>{new Date(details.createdAt).toLocaleString()}</dd></div>
            </dl>
            <div className="tl-apv-docs-list">
              {(details.documentUrls?.length ? details.documentUrls : [details.documentUrl].filter(Boolean)).map((url, i, list) => (
                <a key={url} href={docUrl(url)} target="_blank" rel="noreferrer">
                  <FileText className="w-4 h-4" aria-hidden="true" /> {list.length > 1 ? `Document ${i + 1}` : 'Verification document'} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              ))}
            </div>
            {details.rejectionReason && details.status === 'REJECTED' && <p className="tl-apv-note"><strong>Rejection reason:</strong> {details.rejectionReason}</p>}
            <div className="tl-dash-dialog-actions">
              {details.status === 'APPROVED' && (
                <button type="button" className="tl-dash-btn tl-dash-btn--danger" onClick={() => { const c = details; setDetails(null); suspendCompany(c); }} disabled={busy === details.id}><Ban className="w-4 h-4" aria-hidden="true" /> Suspend</button>
              )}
              {details.status !== 'REJECTED' && (
                <button type="button" className="tl-dash-btn" onClick={() => { setRejectModal({ open: true, kind: 'org', id: details.id, name: details.companyName, reason: '' }); setDetails(null); }} disabled={busy === details.id}>Reject</button>
              )}
              {details.status !== 'APPROVED' && (
                <button type="button" className="tl-dash-btn tl-dash-btn--green" onClick={() => { const c = details; setDetails(null); approveCompany(c); }} disabled={busy === details.id}><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Approve</button>
              )}
            </div>
          </div>
        </div>
      )}

      {rejectModal.open && (
        <div className="tl-dash-dialog-backdrop">
          <form onSubmit={submitRejection} className="tl-dash-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-reject-title">
            <h3 id="tl-reject-title">{rejectModal.kind === 'org' ? 'Reject registration' : 'Reject event'}</h3>
            <p>Tell <strong>{rejectModal.name}</strong> why. The organizer receives this feedback.</p>
            <label htmlFor="tl-reject-reason">Reason</label>
            <textarea
              id="tl-reject-reason"
              required
              rows={3}
              minLength={rejectModal.kind === 'event' ? 5 : undefined}
              className="tl-dash-textarea"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
              placeholder={rejectModal.kind === 'org' ? 'e.g. NTN number does not match FBR record, or CNIC scan is unclear.' : 'e.g. The venue capacity does not match the seating plan.'}
            />
            <div className="tl-dash-dialog-actions">
              <button type="button" className="tl-dash-btn" onClick={() => setRejectModal({ open: false, kind: 'org', id: null, name: '', reason: '' })}>Cancel</button>
              <button type="submit" className="tl-dash-btn tl-dash-btn--danger" disabled={busy === rejectModal.id || rejectModal.reason.trim().length < (rejectModal.kind === 'event' ? 5 : 1)}>Reject</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
