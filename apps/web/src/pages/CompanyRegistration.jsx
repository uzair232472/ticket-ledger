import React, { useState, useEffect } from 'react';
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
  const { token, user } = useAuth();
  
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
    if (token) {
      loadCompany();
    }
  }, [token]);

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
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 border border-slate-800 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-emerald-500/20">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Organizer Company Registration
                </h1>
                {company && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    company.status === 'APPROVED' 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : company.status === 'PENDING'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}>
                    {company.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Verify your organization via NTN or CNIC to publish sports matches and concerts on TicketLedger.
              </p>
            </div>
          </div>

          <button
            onClick={loadCompany}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Status
          </button>
        </div>
      </div>

      {/* Feedback Alert */}
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

      {/* STATUS BANNER CARDS */}
      {company?.status === 'APPROVED' && (
        <div className="p-6 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 text-xs space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5" /> Company Verified & Approved by Administration
          </div>
          <p className="text-slate-300">
            "{company.companyName}" is officially authorized to create events, configure seating plans, and mint NFT tickets.
          </p>
          <div className="pt-2 text-slate-400 text-[11px] flex gap-4">
            <span>Reviewed by: <strong className="text-slate-200">{company.reviewedBy}</strong></span>
            <span>Approved on: <strong className="text-slate-200">{new Date(company.reviewedAt).toLocaleDateString()}</strong></span>
          </div>
        </div>
      )}

      {company?.status === 'PENDING' && (
        <div className="p-6 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-xs space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <Clock className="w-5 h-5" /> Application Under Review
          </div>
          <p className="text-slate-300">
            Your verification documents for <strong className="text-white">{company.companyName}</strong> have been submitted. Super Admin is reviewing your NTN/CNIC credentials.
          </p>
          <p className="text-[11px] text-amber-300/80">
            ⚠️ Note: As required by TicketLedger governance, organizers cannot publish live events until company approval is granted.
          </p>
        </div>
      )}

      {company?.status === 'REJECTED' && (
        <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-xs space-y-2">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <AlertCircle className="w-5 h-5" /> Verification Rejected
          </div>
          <p className="text-slate-300">
            Reason: <strong className="text-rose-300">{company.rejectionReason}</strong>
          </p>
          <p className="text-slate-400 text-[11px]">
            Please correct the issues noted above and re-submit your registration below.
          </p>
        </div>
      )}

      {/* REGISTRATION FORM */}
      {(company?.status !== 'APPROVED') && (
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800">
          <h2 className="text-base font-bold text-white mb-6 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            {company ? 'Update & Re-Submit Registration' : 'Company Credentials & Document Submission'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Company / Organization Name</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    name="companyName"
                    required
                    value={formData.companyName}
                    onChange={handleChange}
                    placeholder="e.g. PCB Events Management Lahore"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Owner / Authorized Representative</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    name="ownerName"
                    required
                    value={formData.ownerName}
                    onChange={handleChange}
                    placeholder="e.g. Tariq Mehmood"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Official Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="contact@company.pk"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Phone Number (Pakistan)</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    name="phone"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+92 300 1234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Headquarters City</label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <select
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
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
                <label className="block text-slate-300 font-medium mb-1">NTN (National Tax No.) or CNIC</label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    name="ntnCnic"
                    required
                    value={formData.ntnCnic}
                    onChange={handleChange}
                    placeholder="e.g. 1234567-8 or 35201-1234567-1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Document Upload Area (Cloudinary Abstraction) */}
            <div className="pt-2">
              <label className="block text-slate-300 font-medium mb-2">
                Verification Document (NTN Certificate, FBR Registration, or CNIC Scan)
              </label>
              
              <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-950 text-center hover:border-slate-700 transition">
                <UploadCloud className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <div className="text-xs text-slate-300 font-medium">
                  {documentFile ? documentFile.name : 'Choose a PDF, PNG, or JPG file (Max 10MB)'}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Stored securely using Cloudinary document abstraction
                </div>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg"
                  onChange={(e) => setDocumentFile(e.target.files[0])}
                  className="mt-3 text-xs text-slate-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-slate-950 hover:file:bg-emerald-500 cursor-pointer"
                />
              </div>

              {company?.documentUrl && (
                <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                  <span>Current document on file:</span>
                  <a
                    href={company.documentUrl.startsWith('http') ? company.documentUrl : `${API_URL}${company.documentUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline flex items-center gap-1 font-mono"
                  >
                    View Document <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition shadow-lg shadow-emerald-600/20 disabled:opacity-50 mt-4"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting Registration...' : 'Submit for Super Admin Verification'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
