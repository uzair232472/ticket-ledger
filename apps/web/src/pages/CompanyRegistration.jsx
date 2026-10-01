import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Building2,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  UploadCloud,
  ExternalLink,
  ShieldCheck,
  User,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  RefreshCw,
  Send
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CompanyRegistration() {
  const { token, user, isAuthenticated, loading: authLoading, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [formData, setFormData] = useState({
    companyName: '',
    ownerName: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    city: 'Lahore',
    ntnCnic: '',
    documentUrl: '',
  });

  const [documentFile, setDocumentFile] = useState(null);

  // Load current company status
  const loadCompany = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/companies/my-company`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data.company) {
        setCompany(data.data.company);
        setFormData({
          companyName: data.data.company.companyName,
          ownerName: data.data.company.ownerName,
          phone: data.data.company.phone,
          email: data.data.company.email,
          city: data.data.company.city,
          ntnCnic: data.data.company.ntnCnic,
          documentUrl: data.data.company.documentUrl || '',
        });
      }
    } catch (err) {
      console.error('Failed to load company:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // my-company is restricted to ORGANIZER / SUPER_ADMIN; skip it for other roles to avoid a 403
    if (token && (user?.role === 'ORGANIZER' || user?.role === 'SUPER_ADMIN')) {
      loadCompany();
      // The admin may have approved or rejected the company since this session started
      if (user?.role === 'ORGANIZER') refreshUser();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [token, user?.role, authLoading]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      const formPayload = new FormData();
      formPayload.append('companyName', formData.companyName);
      formPayload.append('ownerName', formData.ownerName);
      formPayload.append('phone', formData.phone);
      formPayload.append('email', formData.email);
      formPayload.append('city', formData.city);
      formPayload.append('ntnCnic', formData.ntnCnic);

      if (documentFile) {
        formPayload.append('document', documentFile);
      } else if (formData.documentUrl) {
        formPayload.append('documentUrl', formData.documentUrl);
      }

      const res = await fetch(`${API_URL}/api/companies/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formPayload,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to submit registration');

      setMessage({ text: data.message, type: 'success' });
      await loadCompany();
      await refreshUser();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  // Company registration belongs to organizer accounts (one account = one role)
  if (!isAuthenticated || user.role !== 'ORGANIZER') {
    return (
      <div className="max-w-xl mx-auto my-8 rounded-3xl bg-white p-6 sm:p-8 border border-slate-200 shadow-sm space-y-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#16a34a] border border-emerald-200 flex items-center justify-center mx-auto">
          <Building2 className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">Host events on TicketLedger</h1>
        {!isAuthenticated ? (
          <>
            <p className="text-sm text-slate-600">
              Create an Event Organizer account, verify your email, then register your company for approval.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/signup" className="btn-eventfrog text-xs px-5 py-2.5">Create organizer account</Link>
              <Link to="/login" className="text-xs font-bold text-[#16a34a] hover:underline self-center">I already have one →</Link>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            You're signed in with a {user.role.replace('_', ' ').toLowerCase()} account. Each account has one role, so to host
            events please sign up for a separate Event Organizer account with a different email.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 text-slate-800">
      {/* Header */}
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/90 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#16a34a] border border-emerald-200 flex items-center justify-center font-bold shadow-sm">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight">
                  Organizer Company Registration
                </h1>
                {company && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${company.status === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : company.status === 'PENDING'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                    {company.status}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-500">
                Verify your organization via NTN or CNIC to publish sports matches and concerts on TicketLedger.
              </p>
            </div>
          </div>

          <button
            onClick={() => { loadCompany(); refreshUser(); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 shadow-sm transition w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#16a34a]" /> Refresh Status
          </button>
        </div>
      </div>

      {/* Feedback Alert */}
      {message.text && (
        <div className={`p-4 rounded-2xl text-xs flex items-center gap-2 border ${message.type === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#16a34a]" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* STATUS BANNER CARDS */}
      {company?.status === 'APPROVED' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-emerald-50 border border-emerald-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 text-[#16a34a]" /> Company Verified & Approved by Administration
          </div>
          <p className="text-slate-700">
            "{company.companyName}" is officially authorized to create events, configure seating plans, and mint NFT tickets.
          </p>
          <div className="pt-2 text-slate-500 text-[11px] flex gap-4">
            <span>Reviewed by: <strong className="text-slate-800">{company.reviewedBy}</strong></span>
            <span>Approved on: <strong className="text-slate-800">{new Date(company.reviewedAt).toLocaleDateString()}</strong></span>
          </div>
          <Link to="/organizer/dashboard" className="inline-flex btn-eventfrog text-xs px-5 py-2.5 mt-2">
            Go to Organizer Dashboard
          </Link>
        </div>
      )}

      {company?.status === 'PENDING' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-amber-50 border border-amber-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
            <Clock className="w-5 h-5 text-amber-600" /> Application Under Review
          </div>
          <p className="text-slate-700">
            Your verification documents for <strong className="text-slate-900">{company.companyName}</strong> have been submitted. Super Admin is reviewing your NTN/CNIC credentials.
          </p>
          <p className="text-[11px] text-amber-800 font-medium">
            ⚠️ Note: As required by TicketLedger governance, organizers cannot publish live events until company approval is granted.
          </p>
          <p className="text-[11px] text-slate-600">
            While you wait you can still update your <Link to="/profile" className="font-bold text-[#16a34a] hover:underline">profile</Link>.
          </p>
        </div>
      )}

      {company?.status === 'REJECTED' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-rose-50 border border-rose-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
            <AlertCircle className="w-5 h-5 text-rose-500" /> Verification Rejected
          </div>
          <p className="text-slate-700">
            Reason: <strong className="text-rose-800">{company.rejectionReason}</strong>
          </p>
          <p className="text-slate-500 text-[11px]">
            Please correct the issues noted above and press <strong>Resubmit</strong> below.
          </p>
        </div>
      )}

      {/* REGISTRATION FORM */}
      {/* Shown before the first submission and after a rejection; PENDING applications are locked while under review */}
      {(!company || company.status === 'REJECTED') && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#16a34a]" />
            {company ? 'Update & Re-Submit Registration' : 'Company Credentials & Document Submission'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company / Organization Name</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="companyName"
                    required
                    value={formData.companyName}
                    onChange={handleChange}
                    placeholder="e.g. PCB Events Management Lahore"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Owner / Authorized Representative</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="ownerName"
                    required
                    value={formData.ownerName}
                    onChange={handleChange}
                    placeholder="e.g. Tariq Mehmood"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Official Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="contact@company.pk"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Phone Number (Pakistan)</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="phone"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+92 300 1234567"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Headquarters City</label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <select
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  >
                    <option value="Lahore">Lahore</option>
                    <option value="Karachi">Karachi</option>
                    <option value="Islamabad">Islamabad</option>
                    <option value="Rawalpindi">Rawalpindi</option>
                    <option value="Peshawar">Peshawar</option>
                    <option value="Multan">Multan</option>
                    <option value="Faisalabad">Faisalabad</option>
                    <option value="Quetta">Quetta</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">NTN (National Tax No.) or CNIC</label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="ntnCnic"
                    required
                    value={formData.ntnCnic}
                    onChange={handleChange}
                    placeholder="e.g. 1234567-8 or 35201-1234567-1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Document Upload Area (Cloudinary Abstraction) */}
            <div className="pt-2">
              <label className="block text-slate-700 font-semibold mb-2">
                Verification Document (NTN Certificate, FBR Registration, or CNIC Scan)
              </label>

              <div className="p-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center hover:border-slate-300 transition">
                <UploadCloud className="w-8 h-8 text-[#16a34a] mx-auto mb-2" />
                <div className="text-xs text-slate-700 font-medium">
                  {documentFile ? documentFile.name : 'Choose a PDF, PNG, or JPG file (Max 10MB)'}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Stored securely using Cloudinary document abstraction
                </div>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg"
                  onChange={(e) => setDocumentFile(e.target.files[0])}
                  className="mt-3 text-xs text-slate-500 file:mr-3 file:py-1 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#16a34a] file:text-white hover:file:bg-[#15803d] cursor-pointer"
                />
              </div>

              {company?.documentUrl && (
                <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
                  <span>Current document on file:</span>
                  <a
                    href={company.documentUrl.startsWith('http') ? company.documentUrl : `${API_URL}${company.documentUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#16a34a] hover:underline flex items-center gap-1 font-mono font-semibold"
                  >
                    View Document <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-eventfrog inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold shadow-sm transition disabled:opacity-50 mt-4"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting Registration...' : company ? 'Resubmit for Verification' : 'Submit for Super Admin Verification'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
