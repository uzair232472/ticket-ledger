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
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-[#e6f4ea] text-[#008459] flex items-center justify-center font-bold shadow-sm">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">
                Company Approvals & Licensing
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Verify Pakistani event organizer credentials, NTN/CNIC tax documents, and manage approval status.
              </p>
            </div>
          </div>

          <button
            onClick={loadCompanies}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition border border-slate-200 w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {message.text && (
        <div className={`p-4 rounded-2xl text-xs flex items-center gap-2.5 border font-medium ${message.type === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 text-xs font-bold overflow-x-auto pb-1">
        <button
          onClick={() => setFilter('ALL')}
          className={`py-2 px-4 rounded-full transition border ${filter === 'ALL' ? 'bg-[#008459] text-white border-[#008459] shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
            }`}
        >
          All Companies ({counts.all})
        </button>

        <button
          onClick={() => setFilter('PENDING')}
          className={`py-2 px-4 rounded-full transition flex items-center gap-1.5 border ${filter === 'PENDING' ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-amber-700 hover:bg-amber-50 border-amber-200'
            }`}
        >
          <Clock className="w-3.5 h-3.5" /> Pending Review ({counts.pending})
        </button>

        <button
          onClick={() => setFilter('APPROVED')}
          className={`py-2 px-4 rounded-full transition flex items-center gap-1.5 border ${filter === 'APPROVED' ? 'bg-[#008459] text-white border-[#008459] shadow-sm' : 'bg-white text-emerald-700 hover:bg-emerald-50 border-emerald-200'
            }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Approved ({counts.approved})
        </button>

        <button
          onClick={() => setFilter('REJECTED')}
          className={`py-2 px-4 rounded-full transition flex items-center gap-1.5 border ${filter === 'REJECTED' ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-white text-rose-700 hover:bg-rose-50 border-rose-200'
            }`}
        >
          <XCircle className="w-3.5 h-3.5" /> Rejected ({counts.rejected})
        </button>

        <button
          onClick={() => setFilter('SUSPENDED')}
          className={`py-2 px-4 rounded-full transition border ${filter === 'SUSPENDED' ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
            }`}
        >
          Suspended ({counts.suspended})
        </button>
      </div>

      {/* Companies List */}
      {loading ? (
        <div className="p-16 text-center bg-white rounded-3xl border border-slate-200/90 shadow-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#008459] mx-auto"></div>
          <p className="text-xs text-slate-500 font-medium mt-3">Loading organizer companies...</p>
        </div>
      ) : companies.length === 0 ? (
        <div className="p-16 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-3xl bg-white shadow-sm">
          No company registrations found matching the "{filter}" filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {companies.map((c) => (
            <div
              key={c.id}
              className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 hover:border-slate-300 transition flex flex-col lg:flex-row lg:items-center justify-between gap-6 shadow-sm hover:shadow-md"
            >
              <div className="space-y-3.5 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-base font-extrabold text-[#212b36] tracking-tight">
                    {c.companyName}
                  </h3>

                  <span className={`text-[10px] px-3 py-0.5 rounded-full font-bold uppercase border ${c.status === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : c.status === 'PENDING'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : c.status === 'REJECTED'
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}>
                    {c.status}
                  </span>

                  <span className="text-[11px] text-slate-400 font-medium">
                    Registered: {new Date(c.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-[#008459]" />
                    <span>Owner: <strong className="text-slate-900">{c.ownerName}</strong></span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-[#008459]" />
                    <span className="truncate">{c.email}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-[#008459]" />
                    <span>{c.phone}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-[#008459]" />
                    <span>City: <strong className="text-slate-900">{c.city}</strong></span>
                  </div>

                  <div className="flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-[#008459]" />
                    <span>NTN / CNIC: <strong className="font-mono text-slate-900">{c.ntnCnic}</strong></span>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={c.documentUrl.startsWith('http') ? c.documentUrl : `${API_URL}${c.documentUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#008459] hover:underline font-bold"
                    >
                      Inspect Legal Document <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {c.rejectionReason && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
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
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-[#008459] hover:bg-[#00704c] text-white font-bold text-xs transition shadow-sm disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                  </button>
                )}

                {c.status !== 'REJECTED' && (
                  <button
                    onClick={() => setRejectModal({ open: true, companyId: c.id, companyName: c.companyName, reason: '' })}
                    disabled={actionLoading === c.id}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs border border-rose-200 transition disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                )}

                {c.status === 'APPROVED' && (
                  <button
                    onClick={() => handleSuspend(c.id, c.companyName)}
                    disabled={actionLoading === c.id}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 sm:p-7 space-y-4 shadow-2xl">
            <h3 className="text-base font-extrabold text-[#212b36] flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <XCircle className="w-4 h-4" />
              </span>
              Reject Company Registration
            </h3>

            <p className="text-xs text-slate-500">
              Provide a clear reason for rejecting <strong className="text-slate-900">"{rejectModal.companyName}"</strong>. The organizer will receive this feedback:
            </p>

            <form onSubmit={submitRejection} className="space-y-4 text-xs">
              <textarea
                required
                rows={3}
                value={rejectModal.reason}
                onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
                placeholder="e.g. NTN number does not match FBR record, or CNIC scan is unclear."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-xs"
              />

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRejectModal({ open: false, companyId: null, companyName: '', reason: '' })}
                  className="px-5 py-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === rejectModal.companyId || !rejectModal.reason.trim()}
                  className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
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
