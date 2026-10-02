import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Clock,
  RefreshCw,
  User,
  Mail,
  Phone,
  FileText,
  Ban,
  Info,
  TrendingUp,
  Ticket,
} from 'lucide-react';
import { Notice } from '../components/dash/DashShell';
import { StudioHead, ApStat, UnderlineTabs, RecordCard, Badge } from '../components/dash/Studio';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AdminCompanies() {
  const { token } = useAuth();

  const [companies, setCompanies] = useState([]);
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0, rejected: 0, suspended: 0 });
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Rejection modal
  const [rejectModal, setRejectModal] = useState({ open: false, companyId: null, companyName: '', reason: '' });

  const loadCompanies = async () => {
    try {
      setLoading(true);
      const url = filter === 'ALL'
        ? `${API_URL}/api/companies/admin/all`
        : `${API_URL}/api/companies/admin/all?status=${filter}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setCompanies(data.data.companies || []);
        setCounts(data.data.counts || {});
      }
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadCompanies();
    }
  }, [token, filter]);

  // Handle Approve
  const handleApprove = async (companyId, companyName) => {
    if (!window.confirm(`Are you sure you want to approve "${companyName}"? This will allow them to publish live events.`)) return;

    setActionLoading(companyId);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/api/companies/admin/${companyId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'APPROVED' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Approval failed');

      setMessage({ text: data.message, type: 'success' });
      await loadCompanies();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Suspend
  const handleSuspend = async (companyId, companyName) => {
    if (!window.confirm(`Are you sure you want to suspend "${companyName}"?`)) return;

    setActionLoading(companyId);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/api/companies/admin/${companyId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Suspension failed');

      setMessage({ text: data.message, type: 'success' });
      await loadCompanies();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  // Submit Rejection
  const submitRejection = async (e) => {
    e.preventDefault();
    if (!rejectModal.reason.trim()) return;

    setActionLoading(rejectModal.companyId);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/api/companies/admin/${rejectModal.companyId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'REJECTED',
          rejectionReason: rejectModal.reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Rejection failed');

      setMessage({ text: data.message, type: 'success' });
      setRejectModal({ open: false, companyId: null, companyName: '', reason: '' });
      await loadCompanies();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const tabs = [
    { value: 'ALL', label: 'All', count: counts.all || 0 },
    { value: 'PENDING', label: 'Pending', count: counts.pending || 0 },
    { value: 'APPROVED', label: 'Approved', count: counts.approved || 0 },
    { value: 'REJECTED', label: 'Rejected', count: counts.rejected || 0 },
    { value: 'SUSPENDED', label: 'Suspended', count: counts.suspended || 0 },
  ];
  const STATUS_BADGE = {
    PENDING: ['amber', Clock, 'Pending'],
    APPROVED: ['green', CheckCircle2, 'Approved'],
    REJECTED: ['rose', XCircle, 'Rejected'],
    SUSPENDED: ['grey', Ban, 'Suspended'],
  };

  return (
    <div>
      <div className="tl-ap-head-row">
        <StudioHead
          crumbs={['Admin console', 'Approvals']}
          title="Approvals"
          intro="Verify organizer credentials and NTN/CNIC documents, then approve, reject or suspend event hosts."
        />
        <button type="button" className="tl-st-icon-btn" onClick={loadCompanies} aria-label="Refresh list">
          <RefreshCw className={`w-5 h-5 ${loading ? 'tl-dash-spin' : ''}`} />
        </button>
      </div>

      <div className="tl-ap-stats">
        <ApStat icon={Clock} tone="amber" label="Pending review" value={counts.pending || 0} pill="Waiting for a decision" pillIcon={Clock} />
        <ApStat icon={CheckCircle2} tone="green" label="Approved hosts" value={counts.approved || 0} pill="Can publish events" pillIcon={TrendingUp} />
        <ApStat
          icon={Ban}
          tone="blue"
          label="Rejected · suspended"
          value={(counts.rejected || 0) + (counts.suspended || 0)}
          pill={`${counts.suspended || 0} suspended`}
          pillIcon={Ban}
        />
      </div>

      {message.text && (
        <Notice tone={message.type === 'success' ? 'good' : 'bad'} icon={message.type === 'success' ? CheckCircle2 : AlertCircle}>{message.text}</Notice>
      )}

      <section className="tl-ap-section" aria-labelledby="tl-ap-companies">
        <h2 id="tl-ap-companies">Companies</h2>
        <p className="tl-ap-section-sub">{companies.length} shown</p>
        <div className="tl-ap-toolbar">
          <UnderlineTabs label="Filter by status" options={tabs} value={filter} onChange={setFilter} />
        </div>
        <p className="tl-ap-info"><Info className="w-5 h-5" aria-hidden="true" />Review organizer details and supporting documents.</p>

        {loading ? (
          <div className="tl-dash-state"><RefreshCw className="w-6 h-6 tl-dash-spin" /><p>Loading organizer companies…</p></div>
        ) : companies.length === 0 ? (
          <p className="tl-ap-empty">No company registrations in this view.</p>
        ) : (
          <div className="tl-ap-list">
            {companies.map((c) => {
              const [tone, StatusIcon, statusLabel] = STATUS_BADGE[c.status] || ['grey', Info, c.status];
              const busy = actionLoading === c.id;
              return (
                <RecordCard
                  key={c.id}
                  icon={c.status === 'PENDING' ? Ticket : Building2}
                  title={c.companyName}
                  sub={`${c.city} · registered ${new Date(c.createdAt).toLocaleDateString()}`}
                  status={<Badge tone={tone} icon={StatusIcon}>{statusLabel}</Badge>}
                  columns={[
                    { label: 'Owner', content: <p className="tl-rc-line"><User className="w-4 h-4" aria-hidden="true" />{c.ownerName}</p> },
                    {
                      label: 'Contact',
                      content: (
                        <>
                          <p className="tl-rc-line"><Mail className="w-4 h-4" aria-hidden="true" />{c.email}</p>
                          <p className="tl-rc-line"><Phone className="w-4 h-4" aria-hidden="true" />{c.phone}</p>
                        </>
                      ),
                    },
                    {
                      label: 'NTN / CNIC',
                      content: (
                        <>
                          <p className="tl-rc-line"><FileText className="w-4 h-4" aria-hidden="true" />{c.ntnCnic}</p>
                          {c.documentUrl && (
                            <a className="tl-rc-link" href={c.documentUrl.startsWith('http') ? c.documentUrl : `${API_URL}${c.documentUrl}`} target="_blank" rel="noreferrer">
                              View document <ExternalLink className="w-4 h-4" aria-hidden="true" />
                            </a>
                          )}
                        </>
                      ),
                    },
                  ]}
                  actions={
                    <>
                      {c.status !== 'APPROVED' && (
                        <button type="button" className="tl-rc-btn tl-rc-btn--approve" onClick={() => handleApprove(c.id, c.companyName)} disabled={busy}>
                          <CheckCircle2 className="w-4 h-4" /> Approve
                        </button>
                      )}
                      {c.status !== 'REJECTED' && (
                        <button type="button" className="tl-rc-btn tl-rc-btn--reject" onClick={() => setRejectModal({ open: true, companyId: c.id, companyName: c.companyName, reason: '' })} disabled={busy}>
                          <XCircle className="w-4 h-4" /> Reject
                        </button>
                      )}
                      {c.status === 'APPROVED' && (
                        <button type="button" className="tl-rc-btn tl-rc-btn--neutral" onClick={() => handleSuspend(c.id, c.companyName)} disabled={busy}>
                          <Ban className="w-4 h-4" /> Suspend
                        </button>
                      )}
                    </>
                  }
                  footer={c.rejectionReason && <p className="tl-rc-note"><strong>Rejection reason:</strong> {c.rejectionReason}</p>}
                />
              );
            })}
          </div>
        )}
      </section>

      {rejectModal.open && (
        <div className="tl-dash-dialog-backdrop">
          <form onSubmit={submitRejection} className="tl-dash-dialog" role="dialog" aria-modal="true" aria-labelledby="tl-reject-title">
            <h3 id="tl-reject-title">Reject registration</h3>
            <p>Tell <strong>{rejectModal.companyName}</strong> why. The organizer receives this feedback.</p>
            <label htmlFor="tl-reject-reason">Reason</label>
            <textarea
              id="tl-reject-reason"
              required
              rows={3}
              className="tl-dash-textarea"
              value={rejectModal.reason}
              onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
              placeholder="e.g. NTN number does not match FBR record, or CNIC scan is unclear."
            />
            <div className="tl-dash-dialog-actions">
              <button type="button" className="tl-rc-btn tl-rc-btn--neutral" onClick={() => setRejectModal({ open: false, companyId: null, companyName: '', reason: '' })}>Cancel</button>
              <button type="submit" className="tl-rc-btn tl-rc-btn--reject" disabled={actionLoading === rejectModal.companyId || !rejectModal.reason.trim()}>Reject</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
