import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  Building2, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ExternalLink, 
  Clock, 
  Filter, 
  RefreshCw, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  CreditCard,
  Ban
} from 'lucide-react';

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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 border border-slate-800 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-rose-500/20">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Super Admin Company Approvals
              </h1>
              <p className="text-xs text-slate-400">
                Verify Pakistani event organizer credentials, NTN/CNIC tax documents, and manage approval status.
              </p>
            </div>
          </div>

          <button
            onClick={loadCompanies}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {message.text && (
        <div className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${
          message.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-800 gap-2 text-xs font-semibold overflow-x-auto pb-1">
        <button
          onClick={() => setFilter('ALL')}
          className={`py-2 px-3 rounded-lg transition ${
            filter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All Companies ({counts.all})
        </button>

        <button
          onClick={() => setFilter('PENDING')}
          className={`py-2 px-3 rounded-lg transition flex items-center gap-1.5 ${
            filter === 'PENDING' ? 'bg-amber-950/60 text-amber-300 border border-amber-600/40 font-bold' : 'text-amber-400 hover:text-amber-300'
          }`}
        >
          <Clock className="w-3.5 h-3.5" /> Pending Review ({counts.pending})
        </button>

        <button
          onClick={() => setFilter('APPROVED')}
          className={`py-2 px-3 rounded-lg transition flex items-center gap-1.5 ${
            filter === 'APPROVED' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-600/40 font-bold' : 'text-emerald-400 hover:text-emerald-300'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Approved ({counts.approved})
        </button>

        <button
          onClick={() => setFilter('REJECTED')}
          className={`py-2 px-3 rounded-lg transition flex items-center gap-1.5 ${
            filter === 'REJECTED' ? 'bg-rose-950/60 text-rose-300 border border-rose-600/40 font-bold' : 'text-rose-400 hover:text-rose-300'
          }`}
        >
          <XCircle className="w-3.5 h-3.5" /> Rejected ({counts.rejected})
        </button>

        <button
          onClick={() => setFilter('SUSPENDED')}
          className={`py-2 px-3 rounded-lg transition ${
            filter === 'SUSPENDED' ? 'bg-slate-800 text-slate-300' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Suspended ({counts.suspended})
        </button>
      </div>

      {/* Companies List */}
      {loading ? (
        <div className="p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500 mx-auto"></div>
        </div>
      ) : companies.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
          No company registrations found matching the "{filter}" filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {companies.map((c) => (
            <div
              key={c.id}
              className="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col lg:flex-row lg:items-center justify-between gap-6"
            >
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {c.companyName}
                  </h3>

                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    c.status === 'APPROVED' 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : c.status === 'PENDING'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : c.status === 'REJECTED'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {c.status}
                  </span>

                  <span className="text-[10px] text-slate-500">
                    Registered: {new Date(c.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Owner: <strong>{c.ownerName}</strong></span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{c.email}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{c.phone}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>City: <strong>{c.city}</strong></span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                    <span>NTN / CNIC: <strong className="font-mono text-emerald-300">{c.ntnCnic}</strong></span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <a
                      href={c.documentUrl.startsWith('http') ? c.documentUrl : `${API_URL}${c.documentUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-semibold"
                    >
                      Inspect Document <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {c.rejectionReason && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
                    <strong>Rejection Reason:</strong> {c.rejectionReason}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap lg:flex-col gap-2 justify-end min-w-[140px]">
                {c.status !== 'APPROVED' && (
                  <button
                    onClick={() => handleApprove(c.id, c.companyName)}
                    disabled={actionLoading === c.id}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                  </button>
                )}

                {c.status !== 'REJECTED' && (
                  <button
                    onClick={() => setRejectModal({ open: true, companyId: c.id, companyName: c.companyName, reason: '' })}
                    disabled={actionLoading === c.id}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 font-semibold text-xs border border-rose-800/60 transition disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                )}

                {c.status === 'APPROVED' && (
                  <button
                    onClick={() => handleSuspend(c.id, c.companyName)}
                    disabled={actionLoading === c.id}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" /> Suspend
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* REJECTION REASON MODAL */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-400" />
              Reject Company Registration
            </h3>

            <p className="text-xs text-slate-400">
              Provide a clear reason for rejecting <strong className="text-white">"{rejectModal.companyName}"</strong>. The organizer will receive this feedback:
            </p>

            <form onSubmit={submitRejection} className="space-y-4 text-xs">
              <textarea
                required
                rows={3}
                value={rejectModal.reason}
                onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
                placeholder="e.g. NTN number does not match FBR record, or CNIC scan is unclear."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-rose-500 text-xs"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModal({ open: false, companyId: null, companyName: '', reason: '' })}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === rejectModal.companyId || !rejectModal.reason.trim()}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
